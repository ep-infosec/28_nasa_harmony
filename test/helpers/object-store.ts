import { stub, SinonStub } from 'sinon';
import fs from 'fs';
import mockAws, { S3 } from 'mock-aws-s3';
import * as tmp from 'tmp';
import { S3ObjectStore, objectStoreForProtocol } from '../../app/util/object-store';

// Patches mock-aws-s3's mock so that the result of "upload" has an "on" method
const S3MockPrototype = Object.getPrototypeOf(new mockAws.S3());
const originalUpload = S3MockPrototype.upload;
S3MockPrototype.upload = function (...args): mockAws.S3.ManagedUpload {
  const result = originalUpload.call(this, ...args);
  return { on: (): void => {}, ...result };
};

/**
 * Adds stubs to S3 object signing that retain the username from the 'A-userid' parameter.
 *
 * @returns The URL prefix for use in matching responses
 */
export function hookSignS3Object(): string {
  const prefix = 'https://example.com/s3/signed/';
  before(function () {
    stub(S3ObjectStore.prototype, 'signGetObject')
      .callsFake(async (url, params) => `${prefix}${params['A-userid']}`);
  });
  after(function () {
    (S3ObjectStore.prototype.signGetObject as SinonStub).restore();
  });
  return prefix;
}

/**
 * Gets JSON from the given object store URL.  Uses synchronous functions only suitable for testing.
 * If using mock-aws-s3, use getObjectText below
 * @param url - the Object store URL to get
 * @returns the JSON contents of the file at the given URL
 */
export async function getJson(url: string):
Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const objectStore = new S3ObjectStore();
  const filename = await objectStore.downloadFile(url);
  try {
    return JSON.parse(fs.readFileSync(filename).toString());
  } finally {
    fs.unlinkSync(filename);
  }
}

/**
 * Returns the text contents of the object at the provided URL.  If the object is mocked using
 * mock-aws-s3 this is likely to produce better results than `getJson` above.
 * @param url - the Object store URL to read
 */
export async function getObjectText(url: string): Promise<string> {
  const contents: S3.GetObjectOutput = await new Promise((resolve, reject) => {
    objectStoreForProtocol(url).getObject(url, (err, body) => {
      if (err) reject(err);
      else resolve(body);
    });
  });
  return contents.Body.toString('utf-8');
}

/**
 * Causes calls to aws.S3 to return a mock S3 object that stores to a temp dir on the
 * local filesystem.
 *
 * @param _buckets - An optional list of buckets to create in the mock S3 (not implemented
 * yet)
 */
export function hookMockS3(_buckets?: string[]): void {
  let dir;
  let stubObject;
  let stubGetJson;
  before(function () {
    dir = tmp.dirSync({ unsafeCleanup: true });
    mockAws.config.basePath = dir.name;
    stubObject = stub(S3ObjectStore.prototype, '_getS3')
      .callsFake(() => new mockAws.S3());
    // replace getObjectJson since mock-aws-s3 doesn't work well with current function
    stubGetJson = stub(S3ObjectStore.prototype, 'getObjectJson')
      .callsFake(async (url) => JSON.parse(await getObjectText(url as string)));
  });

  after(function () {
    stubObject.restore();
    stubGetJson.restore();
    dir.removeCallback();
  });
}
