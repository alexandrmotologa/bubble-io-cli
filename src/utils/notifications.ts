import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Payload sent to notification hooks after a backup operation.
 */
export interface NotificationPayload {
  appName: string;
  dataType: string;
  env: string;
  records: number;
  file: string;
  format: string;
  success: boolean;
  durationMs?: number;
  error?: string;
}

/**
 * Sends an HTTP POST request with a JSON body.
 * Works with both http and https URLs (no axios dependency — keeps bundle lean).
 */
function httpPost(webhookUrl: string, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => resolve(res.statusCode ?? 0)
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Sends a Slack Incoming Webhook notification after a backup.
 *
 * The webhook URL must be created in Slack:
 *   Apps → Incoming Webhooks → Activate → Copy Webhook URL
 *
 * @see https://api.slack.com/messaging/webhooks
 */
export async function sendSlackNotification(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<void> {
  const statusIcon = payload.success ? '✅' : '❌';
  const statusText = payload.success ? 'Backup complete' : 'Backup failed';

  const slackBody = {
    text: `${statusIcon} *bubble-io-cli* — ${statusText}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusIcon} bubble-io-cli — ${statusText}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*App:*\n${payload.appName}` },
          { type: 'mrkdwn', text: `*Data Type:*\n${payload.dataType}` },
          { type: 'mrkdwn', text: `*Environment:*\n${payload.env}` },
          { type: 'mrkdwn', text: `*Records:*\n${payload.records}` },
          { type: 'mrkdwn', text: `*Format:*\n${payload.format}` },
          {
            type: 'mrkdwn',
            text: `*File:*\n\`${payload.file.split('/').pop() ?? payload.file}\``,
          },
        ],
      },
      ...(payload.error
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Error:* ${payload.error}` },
            },
          ]
        : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Triggered at ${new Date().toISOString()}${payload.durationMs !== undefined ? ` · ${payload.durationMs}ms` : ''}`,
          },
        ],
      },
    ],
  };

  const status = await httpPost(webhookUrl, JSON.stringify(slackBody));
  if (status < 200 || status >= 300) {
    throw new Error(`Slack webhook returned HTTP ${status}. Check the webhook URL.`);
  }
}

/**
 * Sends a Discord Webhook notification after a backup.
 *
 * The webhook URL must be created in Discord:
 *   Server Settings → Integrations → Webhooks → New Webhook → Copy URL
 *
 * @see https://discord.com/developers/docs/resources/webhook
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  payload: NotificationPayload
): Promise<void> {
  const statusColor = payload.success ? 0x2ecc71 : 0xe74c3c; // green / red
  const statusText = payload.success ? '✅ Backup complete' : '❌ Backup failed';

  const discordBody = {
    embeds: [
      {
        title: `bubble-io-cli — ${statusText}`,
        color: statusColor,
        fields: [
          { name: 'App', value: payload.appName, inline: true },
          { name: 'Data Type', value: payload.dataType, inline: true },
          { name: 'Environment', value: payload.env, inline: true },
          { name: 'Records', value: String(payload.records), inline: true },
          { name: 'Format', value: payload.format, inline: true },
          {
            name: 'File',
            value: `\`${payload.file.split('/').pop() ?? payload.file}\``,
            inline: true,
          },
          ...(payload.error ? [{ name: 'Error', value: payload.error, inline: false }] : []),
        ],
        footer: {
          text: `bubble-io-cli${payload.durationMs !== undefined ? ` · ${payload.durationMs}ms` : ''}`,
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const status = await httpPost(webhookUrl, JSON.stringify(discordBody));
  // Discord returns 204 No Content on success
  if (status !== 200 && status !== 204) {
    throw new Error(`Discord webhook returned HTTP ${status}. Check the webhook URL.`);
  }
}

/**
 * Dispatches notifications to all configured webhook URLs.
 * Failures are collected and re-thrown as a combined error.
 */
export async function dispatchNotifications(
  webhooks: { slack?: string; discord?: string },
  payload: NotificationPayload
): Promise<void> {
  const errors: string[] = [];

  if (webhooks.slack) {
    try {
      await sendSlackNotification(webhooks.slack, payload);
    } catch (e) {
      errors.push(`Slack: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (webhooks.discord) {
    try {
      await sendDiscordNotification(webhooks.discord, payload);
    } catch (e) {
      errors.push(`Discord: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Notification error(s):\n  ${errors.join('\n  ')}`);
  }
}
