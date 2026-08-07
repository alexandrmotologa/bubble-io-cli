import Configstore from 'configstore';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Shape of the local configuration stored by bubble-io-cli.
 */
export interface BubbleConfig {
  appName: string;
  apiKey: string;
}

const CONFIG_NAME = 'bubble-io-cli';

/**
 * Wrapper around Configstore for reading and writing local CLI configuration.
 * Values are persisted in the OS user config directory (e.g. ~/.config/bubble-io-cli).
 */
class StorageManager {
  private store: Configstore;

  constructor() {
    this.store = new Configstore(CONFIG_NAME);
  }

  /**
   * Persist the Bubble app credentials to local storage.
   */
  saveConfig(config: BubbleConfig): void {
    this.store.set('appName', config.appName);
    this.store.set('apiKey', config.apiKey);
  }

  /**
   * Retrieve the stored configuration, or null if not yet configured.
   */
  getConfig(): BubbleConfig | null {
    const appName = this.store.get('appName') as string | undefined;
    const apiKey = this.store.get('apiKey') as string | undefined;

    if (!appName || !apiKey) {
      return null;
    }

    return { appName, apiKey };
  }

  /**
   * Check whether credentials have been configured.
   */
  isConfigured(): boolean {
    return this.getConfig() !== null;
  }

  /**
   * Clear all stored configuration values.
   */
  clearConfig(): void {
    this.store.clear();
  }

  /**
   * Save arbitrary JSON data to a local file path.
   * Creates parent directories if they do not exist.
   */
  saveJsonFile(filePath: string, data: unknown): void {
    const dir = join(filePath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Read and parse a JSON file from disk.
   */
  readJsonFile<T>(filePath: string): T {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  }
}

// Export a singleton so all commands share the same store instance
export const storage = new StorageManager();
