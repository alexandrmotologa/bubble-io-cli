/**
 * bubble-io-cli-plugin-s3-backup
 *
 * Example lifecycle hook plugin that automatically uploads every backup
 * to an Amazon S3 bucket immediately after it is written to disk.
 *
 * Installation:
 *   Place this file in ~/.bubble-cli/plugins/s3-backup.js
 *   Or publish as an npm package: bubble-io-cli-plugin-s3-backup
 *
 * Requirements:
 *   AWS credentials must be available in the environment:
 *     AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 *   And set S3_BACKUP_BUCKET to your target bucket name.
 *
 * Usage:
 *   Once installed, every `bubble-io-cli backup` run will automatically
 *   upload the resulting file to S3. No extra flags needed.
 */

const { execSync } = require('child_process');
const path = require('path');

/** @type {import('bubble-io-cli/plugin').BubbleCLIPlugin} */
const plugin = {
  name: 'bubble-cli-plugin-s3-backup',
  version: '1.0.0',
  description: 'Automatically uploads every backup file to Amazon S3',

  // No custom commands — this plugin works entirely via hooks
  register(_program) {},

  hooks: {
    /**
     * Called after every successful backup.
     * Uploads the backup file to the configured S3 bucket.
     *
     * @param {import('bubble-io-cli/plugin').BackupHookContext} ctx
     */
    async afterBackup(ctx) {
      const bucket = process.env['S3_BACKUP_BUCKET'];
      if (!bucket) {
        process.stderr.write(
          '[s3-backup plugin] S3_BACKUP_BUCKET env var is not set. Skipping upload.\n'
        );
        return;
      }

      const filename = path.basename(ctx.filePath);
      const s3Key = `bubble-backups/${ctx.appName}/${ctx.dataType}/${filename}`;
      const destination = `s3://${bucket}/${s3Key}`;

      console.log(`\n   📤 [s3-backup] Uploading to ${destination}…`);

      try {
        // Uses the AWS CLI — can be replaced with @aws-sdk/client-s3 for production
        execSync(`aws s3 cp "${ctx.filePath}" "${destination}"`, { stdio: 'inherit' });
        console.log(`   ✅ [s3-backup] Uploaded: ${destination}`);
        console.log(`      Records: ${ctx.records} | Format: ${ctx.format} | Encrypted: ${ctx.encrypted}`);
      } catch (err) {
        process.stderr.write(
          `[s3-backup plugin] Upload failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    },
  },
};

module.exports = plugin;
