import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendSlackNotification, sendDiscordNotification, dispatchNotifications } from '../src/utils/notifications';

// Mock Node.js https/http modules
vi.mock('https', () => ({
  default: {
    request: vi.fn((_, callback) => {
      // Simulate a successful response with statusCode 200
      const res = { statusCode: 200 };
      callback(res);
      return { on: vi.fn(), write: vi.fn(), end: vi.fn() };
    }),
  },
}));

vi.mock('http', () => ({
  default: {
    request: vi.fn((_, callback) => {
      const res = { statusCode: 200 };
      callback(res);
      return { on: vi.fn(), write: vi.fn(), end: vi.fn() };
    }),
  },
}));

const samplePayload = {
  appName: 'my-app',
  dataType: 'Product',
  env: 'version-test',
  records: 42,
  file: '/backups/backup-product-2026-08-07.json',
  format: 'json',
  success: true,
  durationMs: 1200,
};

describe('sendSlackNotification()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should call https.request for an https Slack webhook URL', async () => {
    const https = await import('https');
    await sendSlackNotification('https://hooks.slack.com/services/T/B/secret', samplePayload);
    expect(https.default.request).toHaveBeenCalled();
  });

  it('should resolve without throwing on a 200 response', async () => {
    await expect(
      sendSlackNotification('https://hooks.slack.com/services/T/B/secret', samplePayload)
    ).resolves.not.toThrow();
  });
});

describe('sendDiscordNotification()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should call https.request for a Discord webhook URL', async () => {
    const https = await import('https');
    await sendDiscordNotification('https://discord.com/api/webhooks/123/secret', samplePayload);
    expect(https.default.request).toHaveBeenCalled();
  });

  it('should resolve without throwing on a 200 response', async () => {
    await expect(
      sendDiscordNotification('https://discord.com/api/webhooks/123/secret', samplePayload)
    ).resolves.not.toThrow();
  });
});

describe('dispatchNotifications()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('should dispatch to both Slack and Discord when both are provided', async () => {
    const https = await import('https');
    await dispatchNotifications(
      { slack: 'https://hooks.slack.com/services/T/B/s', discord: 'https://discord.com/api/webhooks/1/s' },
      samplePayload
    );
    // Two requests: one for Slack, one for Discord
    expect((https.default.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });

  it('should skip Slack when only Discord is provided', async () => {
    const https = await import('https');
    await dispatchNotifications({ discord: 'https://discord.com/api/webhooks/1/s' }, samplePayload);
    expect((https.default.request as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });

  it('should not throw when no webhooks are configured', async () => {
    await expect(dispatchNotifications({}, samplePayload)).resolves.not.toThrow();
  });
});
