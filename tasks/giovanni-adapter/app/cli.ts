import yargs from 'yargs';
import DataOperation from '../../../app/models/data-operation';
import { createEncrypter, createDecrypter } from '../../../app/util/crypto';
import logger from '../../../app/util/log';
import Catalog from './stac/catalog';
import StacItem from './stac/item';
import { BoundingBox } from '../../../app/util/bounding-box';
import { resolve } from '../../../app/util/url';
import { objectStoreForProtocol } from '../../../app/util/object-store';

// giovanni globals
import giovanni_datafield_config from '../config/giovanni-datafield.json';

interface HarmonyArgv {
  harmonyMetadataDir?: string;
  harmonyInput?: object;
}

/**
 * Builds and returns the CLI argument parser
 * @returns the CLI argument parser
 */
export function parser(): yargs.Argv<unknown> {
  return yargs
    .usage('Usage: --harmony-metadata-dir <dir> --harmony-input <message>')
    .option('harmony-metadata-dir', {
      alias: 'o',
      describe: 'the directory where output files should be placed',
      type: 'string',
      demandOption: true,
    })
    .option('harmony-input', {
      alias: 'i',
      describe: 'the JSON-formatted input message from Harmony',
      type: 'string',
      coerce: JSON.parse,
      demandOption: true,
    });
}

/**
 * Generate Giovanni URL.
 * @param operation - The operation
 * @param cmr_endpoint - CMR endpoint; needs to be one of the following from environments:
 *  https://cmr.earthdata.nasa.gov
 *  https://cmr.uat.earthdata.nasa.gov
 */
async function _generateGiovanniURL(
  operation: DataOperation, cmr_endpoint: string,
): Promise<{ giovanni_url: string; giovanni_url_title: string }> {
  let giovanni_base_url;
  if ( cmr_endpoint === 'https://cmr.earthdata.nasa.gov' ) {
    giovanni_base_url = 'https://api.giovanni.earthdata.nasa.gov/';
  } else if ( cmr_endpoint === 'https://cmr.uat.earthdata.nasa.gov' ) {
    giovanni_base_url = 'https://api.giovanni.uat.earthdata.nasa.gov/';
  } else {
    throw new Error('CMR_ENDPOINT not set correctly.');
  }

  const giovanni_service_name = 'proxy-timeseries';
  const time_start = operation.temporal.start;
  const time_end = operation.temporal.end;
  const [lon, lat] = operation.spatialPoint;
  const collectionId = operation.model.sources[0].collection;
  const variableId = operation.model.sources[0].variables[0].id;
  const giovanni_datafield = giovanni_datafield_config[cmr_endpoint][collectionId][variableId];
  const giovanni_location_param = encodeURIComponent(`[${lat},${lon}]`);
  const giovanni_time_param = encodeURIComponent(`${time_start}/${time_end}`);
  const giovanni_url_path = `${giovanni_service_name}?data=${giovanni_datafield}&location=${giovanni_location_param}&time=${giovanni_time_param}`;
  return {
    giovanni_url: `${giovanni_base_url}${giovanni_url_path}`,
    giovanni_url_title: `Giovanni URL for time series of variable ${giovanni_datafield} \
(latitude = ${lat}, longitude = ${lon}, time range = [${time_start}, ${time_end}])`,
  };
}

/**
 * Entrypoint which does environment and CLI parsing.  Run `ts-node .` for usage.
 * @param args - The command line arguments to parse, absent any program name
 */
export default async function main(args: string[]): Promise<void> {
  const startTime = new Date().getTime();
  const appLogger = logger.child({ application: 'giovanni-adapter' });
  const options = parser().parse(args) as HarmonyArgv;
  const encrypter = createEncrypter(process.env.SHARED_SECRET_KEY);
  const decrypter = createDecrypter(process.env.SHARED_SECRET_KEY);
  const operation = new DataOperation(options.harmonyInput, encrypter, decrypter);
  const timingLogger = appLogger.child({ requestId: operation.requestId });
  timingLogger.info('timing..start');

  // generate Giovanni URL
  const cmr_endpoint = process.env.CMR_ENDPOINT;
  const { giovanni_url, giovanni_url_title } = await _generateGiovanniURL(operation, cmr_endpoint);

  // set up stac catalog
  const result = new Catalog({ description: 'Giovanni adapter service' });

  // generate stac item
  const stacItemRelativeFilename = 'item.json';
  result.links.push({
    'rel': 'item',
    'href': stacItemRelativeFilename,
    'type': 'application/json',
    'title': 'giovanni stac item',
  });
  const stacItemUrl = resolve(options.harmonyMetadataDir, stacItemRelativeFilename);
  const time_start = operation.temporal.start;
  const time_end = operation.temporal.end;
  const properties = { start_datetime: time_start, end_datetime: time_end };
  const [lon, lat] = operation.spatialPoint;
  const bbox: BoundingBox = [lon, lat, lon, lat];
  const assets = {
    'Giovanni URL': {
      href: giovanni_url,
      title: giovanni_url_title,
      description: 'Giovanni link',
      type: 'text/csv',
      roles: ['data'],
    },
  };
  const item = new StacItem({
    properties,
    bbox,
    assets,
  });
  await item.write(stacItemUrl, true);

  // save stac catalog
  const relativeFilename = 'catalog.json';
  const catalogFilenames = [];
  const catalogUrl = resolve(options.harmonyMetadataDir, relativeFilename);
  catalogFilenames.push(relativeFilename);
  await result.write(catalogUrl, true);

  const catalogListUrl = resolve(options.harmonyMetadataDir, 'batch-catalogs.json');
  const catalogCountUrl = resolve(options.harmonyMetadataDir, 'batch-count.txt');

  const s3 = objectStoreForProtocol('s3');
  await s3.upload(JSON.stringify(catalogFilenames), catalogListUrl, null, 'application/json');
  await s3.upload(catalogFilenames.length.toString(), catalogCountUrl, null, 'text/plain');

  const durationMs = new Date().getTime() - startTime;
  timingLogger.info('timing.giovanni-adapter.end', { durationMs });
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e); // eslint-disable-line no-console
    throw (e);
  });
}
