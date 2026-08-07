import { readFileSync } from 'fs';
import { extname } from 'path';

/** MIME type lookup for common backup file extensions. */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.enc') return 'application/octet-stream';
  return 'application/octet-stream';
}

/**
 * Uploads a local file to an Amazon S3 bucket.
 * Requires `@aws-sdk/client-s3` to be installed:
 *   npm install @aws-sdk/client-s3
 *
 * AWS credentials must be configured via environment variables or ~/.aws/credentials:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *
 * @param localPath   - Absolute or relative path to the local file
 * @param destination - S3 URI: s3://bucket-name/optional/prefix/filename
 */
export async function uploadToS3(localPath: string, destination: string): Promise<void> {
  let S3Client: unknown, PutObjectCommand: unknown;
  try {
    // @ts-expect-error — optional peer dependency, not installed by default
    const sdk = await import('@aws-sdk/client-s3');
    S3Client = sdk.S3Client;
    PutObjectCommand = sdk.PutObjectCommand;
  } catch {
    throw new Error(
      'AWS SDK not installed. Run: npm install @aws-sdk/client-s3\n' +
      '   Then set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION.'
    );
  }

  // Parse s3://bucket/key
  const withoutScheme = destination.replace(/^s3:\/\//, '');
  const slashIdx = withoutScheme.indexOf('/');
  const bucket = slashIdx === -1 ? withoutScheme : withoutScheme.slice(0, slashIdx);
  const key = slashIdx === -1 ? '' : withoutScheme.slice(slashIdx + 1);

  if (!bucket) throw new Error(`Invalid S3 destination: "${destination}". Expected s3://bucket/key`);

  const body = readFileSync(localPath);
  const contentType = getMimeType(localPath);

  const client = new (S3Client as new (cfg: object) => { send: (cmd: unknown) => Promise<unknown> })({});
  await client.send(
    new (PutObjectCommand as new (cfg: object) => unknown)({
      Bucket: bucket,
      Key: key || localPath.split('/').pop(),
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Uploads a local file to Google Cloud Storage.
 * Requires `@google-cloud/storage` to be installed:
 *   npm install @google-cloud/storage
 *
 * GCP credentials must be configured via GOOGLE_APPLICATION_CREDENTIALS.
 *
 * @param localPath   - Absolute or relative path to the local file
 * @param destination - GCS URI: gs://bucket-name/optional/prefix/filename
 */
export async function uploadToGCS(localPath: string, destination: string): Promise<void> {
  let Storage: unknown;
  try {
    // @ts-expect-error — optional peer dependency, not installed by default
    const sdk = await import('@google-cloud/storage');
    Storage = sdk.Storage;
  } catch {
    throw new Error(
      'GCS SDK not installed. Run: npm install @google-cloud/storage\n' +
      '   Then set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.'
    );
  }

  const withoutScheme = destination.replace(/^gs:\/\//, '');
  const slashIdx = withoutScheme.indexOf('/');
  const bucket = slashIdx === -1 ? withoutScheme : withoutScheme.slice(0, slashIdx);
  const destPath = slashIdx === -1 ? '' : withoutScheme.slice(slashIdx + 1);

  if (!bucket) throw new Error(`Invalid GCS destination: "${destination}". Expected gs://bucket/path`);

  const storage = new (Storage as new () => { bucket: (b: string) => { upload: (p: string, opts: object) => Promise<unknown> } })();
  await storage.bucket(bucket).upload(localPath, {
    destination: destPath || localPath.split('/').pop(),
  });
}

/**
 * Routes a file upload to the correct cloud provider based on the URI scheme.
 * Supported schemes: s3://, gs://
 *
 * @param localPath   - Local file path to upload
 * @param destination - Cloud URI (s3:// or gs://)
 */
export async function uploadToCloud(localPath: string, destination: string): Promise<void> {
  if (destination.startsWith('s3://')) {
    return uploadToS3(localPath, destination);
  }
  if (destination.startsWith('gs://')) {
    return uploadToGCS(localPath, destination);
  }
  throw new Error(
    `Unknown destination scheme in "${destination}".\n` +
    '   Supported: s3://bucket/path  or  gs://bucket/path'
  );
}
