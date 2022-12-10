import { Response, NextFunction } from 'express';
import DataOperation from '../../models/data-operation';
import { keysToLowerCase } from '../../util/object';
import { RequestValidationError } from '../../util/errors';
import wrap from '../../util/array';
import { parseVariables } from '../../util/variables';
import { parsePointParam, parseSubsetParams, subsetParamsToBbox, subsetParamsToTemporal } from './util/subset-parameter-parsing';
import { parseAcceptHeader } from '../../util/content-negotiation';
import { ParameterParseError, parseMultiValueParameter } from '../../util/parameter-parsing';
import HarmonyRequest from '../../models/harmony-request';
import { createDecrypter, createEncrypter } from '../../util/crypto';
import parseCRS from '../../util/crs';
import env from '../../util/env';
/**
 * Express middleware that responds to OGC API - Coverages coverage
 * rangeset requests.  Responds with the actual coverage data.
 *
 * @param req - The request sent by the client
 * @param res - The response to send to the client
 * @param next - The next express handler
 * @throws RequestValidationError - Thrown if the request has validation problems and
 *   cannot be performed
 */
export default function getCoverageRangeset(
  req: HarmonyRequest,
  res: Response,
  next: NextFunction,
): void {
  req.context.frontend = 'ogcCoverages';
  const query = keysToLowerCase(req.query);

  const encrypter = createEncrypter(env.sharedSecretKey);
  const decrypter = createDecrypter(env.sharedSecretKey);
  const operation = new DataOperation(null, encrypter, decrypter);

  if (query.format) {
    operation.outputFormat = query.format;
  } else if (req.headers.accept) {
    const acceptedMimeTypes = parseAcceptHeader(req.headers.accept);
    req.context.requestedMimeTypes = acceptedMimeTypes
      .map((v: { mimeType: string }) => v.mimeType)
      .filter((v) => v);
  }

  if (query.granuleid) {
    operation.granuleIds = parseMultiValueParameter(query.granuleid);
  }
  if (query.outputcrs) {
    const [crs, srs] = parseCRS({ queryCRS_: query.outputcrs });
    operation.crs = crs;
    operation.srs = srs;
  }
  operation.interpolationMethod = query.interpolation;
  if (query.scaleextent) {
    const [xMin, yMin, xMax, yMax] = query.scaleextent;
    operation.scaleExtent = { x: { min: xMin, max: xMax }, y: { min: yMin, max: yMax } };
  }
  operation.outputWidth = query.width;
  operation.outputHeight = query.height;
  if (query.scalesize) {
    const [x, y] = query.scalesize;
    operation.scaleSize = { x, y };
  }
  if (query.forceasync) {
    operation.isSynchronous = false;
  }
  if (query.ignoreerrors) {
    operation.ignoreErrors = true;
  }
  try {
    const subset = parseSubsetParams(wrap(query.subset));
    operation.dimensions = [];
    Object.entries(subset).forEach(([key, value]) => {
      if (!['time', 'lat', 'lon'].includes(key)) {
        operation.dimensions.push({
          name: key,
          min: value.min as number,
          max: value.max as number,
        });
      }
    });

    const bbox = subsetParamsToBbox(subset);
    if (bbox) {
      operation.boundingRectangle = bbox;
    }
    const point = parsePointParam(query.point);
    if (point) {
      if (bbox || req.rawHeaders.filter((x) => new RegExp('shapefile=*').test(x)).length)
        throw new RequestValidationError('bounding_box and point query parameters should not co-exist');
      operation.spatialPoint = point;
    }
    const { start, end } = subsetParamsToTemporal(subset);
    if (start || end) {
      operation.temporal = { start, end };
    }
  } catch (e) {
    if (e instanceof ParameterParseError) {
      // Turn parsing exceptions into 400 errors pinpointing the source parameter
      throw new RequestValidationError(`query parameter "subset" ${e.message}`);
    }
    throw e;
  }

  const varInfos = parseVariables(req.collections, req.params.collectionId);
  for (const varInfo of varInfos) {
    operation.addSource(varInfo.collectionId, varInfo.shortName, varInfo.versionId,
      varInfo.variables, varInfo.coordinateVariables);
  }

  req.operation = operation;
  next();
}
