/**
 * bubble-io-cli-plugin-slack-notifier
 *
 * Example lifecycle hook plugin that sends rich Slack notifications
 * after backups, restores, schema diffs, and database exports.
 *
 * Installation:
 *   Place this file in ~/.bubble-cli/plugins/slack-notifier.js
 *   Or publish as an npm package: bubble-io-cli-plugin-slack-notifier
 *
 * Requirements:
 *   Set SLACK_WEBHOOK_URL to your Slack Incoming Webhook URL.
 *   Get one from: https://api.slack.com/messaging/webhooks
 *
 * Usage:
 *   Once installed, Slack notifications are sent automatically for
 *   backup completions, restore completions, and schema diffs.
 *   No extra flags needed.
 */

const https = require('https');
const { URL } = require('url');

/**
 * Posts a JSON payload to a Slack Incoming Webhook URL.
 * Uses Node.js built-in https — zero extra dependencies.
 *
 * @param {string} webhookUrl
 * @param {object} payload
 */
function postToSlack(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const body = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`Slack webhook responded with ${res.statusCode}`));
        }
      }
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** @type {import('bubble-io-cli/plugin').BubbleCLIPlugin} */
const plugin = {
  name: 'bubble-cli-plugin-slack-notifier',
  version: '1.0.0',
  description: 'Sends rich Slack notifications for backup, restore, schema diff, and export events',

  // No custom commands — this plugin works entirely via hooks
  register(_program) {},

  hooks: {
    /**
     * Notifies Slack after every successful backup.
     *
     * @param {import('bubble-io-cli/plugin').BackupHookContext} ctx
     */
    async afterBackup(ctx) {
      const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl) return;

      const duration = ctx.durationMs !== undefined ? `${(ctx.durationMs / 1000).toFixed(1)}s` : 'N/A';

      await postToSlack(webhookUrl, {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '✅ Bubble Backup Complete', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*App:*\n${ctx.appName}` },
              { type: 'mrkdwn', text: `*Data Type:*\n${ctx.dataType}` },
              { type: 'mrkdwn', text: `*Environment:*\n${ctx.environment}` },
              { type: 'mrkdwn', text: `*Records:*\n${ctx.records}` },
              { type: 'mrkdwn', text: `*Format:*\n${ctx.format}${ctx.encrypted ? ' (encrypted)' : ''}` },
              { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
            ],
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `📁 ${ctx.filePath} · ${ctx.timestamp}` },
            ],
          },
        ],
      }).catch((err) => {
        process.stderr.write(`[slack-notifier] afterBackup notification failed: ${err.message}\n`);
      });
    },

    /**
     * Notifies Slack after a restore operation completes.
     *
     * @param {import('bubble-io-cli/plugin').RestoreHookContext} ctx
     */
    async afterRestore(ctx) {
      const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl) return;

      const hasErrors = (ctx.errors ?? 0) > 0;

      await postToSlack(webhookUrl, {
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: hasErrors ? '⚠️ Bubble Restore Finished with Errors' : '✅ Bubble Restore Complete',
              emoji: true,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*App:*\n${ctx.appName}` },
              { type: 'mrkdwn', text: `*Data Type:*\n${ctx.dataType}` },
              { type: 'mrkdwn', text: `*Environment:*\n${ctx.environment}` },
              { type: 'mrkdwn', text: `*Mode:*\n${ctx.mode}` },
              { type: 'mrkdwn', text: `*Restored:*\n${ctx.restoredCount ?? 0}` },
              { type: 'mrkdwn', text: `*Errors:*\n${ctx.errors ?? 0}` },
            ],
          },
        ],
      }).catch((err) => {
        process.stderr.write(`[slack-notifier] afterRestore notification failed: ${err.message}\n`);
      });
    },

    /**
     * Notifies Slack when a schema diff detects breaking changes.
     * Only sends a notification if there are actual differences.
     *
     * @param {import('bubble-io-cli/plugin').SchemaDiffHookContext} ctx
     */
    async onSchemaDiff(ctx) {
      const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl || ctx.diff.identical) return;

      const total =
        ctx.diff.addedTypes.length +
        ctx.diff.removedTypes.length +
        ctx.diff.modifiedTypes.length;

      await postToSlack(webhookUrl, {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🔍 Schema Differences Detected', emoji: true },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${ctx.appName}* — \`${ctx.envA}\` → \`${ctx.envB}\`\n${total} type(s) differ`,
            },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Added types:*\n${ctx.diff.addedTypes.length || 'none'}` },
              { type: 'mrkdwn', text: `*Removed types:*\n${ctx.diff.removedTypes.length || 'none'}` },
              { type: 'mrkdwn', text: `*Modified types:*\n${ctx.diff.modifiedTypes.length || 'none'}` },
            ],
          },
        ],
      }).catch((err) => {
        process.stderr.write(`[slack-notifier] onSchemaDiff notification failed: ${err.message}\n`);
      });
    },

    /**
     * Notifies Slack after a database export completes.
     *
     * @param {import('bubble-io-cli/plugin').ExportHookContext} ctx
     */
    async afterExport(ctx) {
      const webhookUrl = process.env['SLACK_WEBHOOK_URL'];
      if (!webhookUrl) return;

      const duration = ctx.durationMs !== undefined ? `${(ctx.durationMs / 1000).toFixed(1)}s` : 'N/A';

      await postToSlack(webhookUrl, {
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: '🗄️ Database Export Complete', emoji: true },
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*App:*\n${ctx.appName}` },
              { type: 'mrkdwn', text: `*Data Type:*\n${ctx.dataType}` },
              { type: 'mrkdwn', text: `*Target:*\n${ctx.target}` },
              { type: 'mrkdwn', text: `*Records:*\n${ctx.records}` },
              { type: 'mrkdwn', text: `*Destination:*\n${ctx.destination}` },
              { type: 'mrkdwn', text: `*Duration:*\n${duration}` },
            ],
          },
        ],
      }).catch((err) => {
        process.stderr.write(`[slack-notifier] afterExport notification failed: ${err.message}\n`);
      });
    },
  },
};

module.exports = plugin;
