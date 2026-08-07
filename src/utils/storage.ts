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
const DEFAULT_PROFILE = 'default';

/**
 * Wrapper around Configstore for reading and writing local CLI configuration.
 * Supports named profiles so users can manage credentials for multiple Bubble apps.
 *
 * Profile data is stored under `profiles.<name>.appName` / `profiles.<name>.apiKey`.
 * The active profile name is stored under `activeProfile`.
 *
 * Values are persisted in the OS user config directory (e.g. ~/.config/bubble-io-cli).
 */
class StorageManager {
  private store: Configstore;

  constructor() {
    this.store = new Configstore(CONFIG_NAME);
  }

  // ── Profile helpers ──────────────────────────────────────────────────────────

  private profileKey(profile: string, field: string): string {
    return `profiles.${profile}.${field}`;
  }

  /**
   * Returns the currently active profile name (defaults to 'default').
   */
  getActiveProfile(): string {
    return (this.store.get('activeProfile') as string | undefined) ?? DEFAULT_PROFILE;
  }

  /**
   * Sets the active profile name.
   */
  setActiveProfile(profile: string): void {
    this.store.set('activeProfile', profile);
  }

  /**
   * Returns the names of all stored profiles.
   * Iterates through profiles stored under the `profiles.*` key namespace.
   */
  listProfiles(): string[] {
    // Configstore stores nested keys as dot-notation under the hood.
    // We discover profiles by reading the top-level profiles object.
    const raw = this.store.get('profiles');
    if (!raw || typeof raw !== 'object') return [];
    return Object.keys(raw as Record<string, unknown>);
  }


  // ── Config CRUD (profile-aware) ──────────────────────────────────────────────

  /**
   * Persist the Bubble app credentials to local storage under the given profile.
   * If no profile is provided, uses the currently active profile.
   */
  saveConfig(config: BubbleConfig, profile?: string): void {
    const p = profile ?? this.getActiveProfile();
    this.store.set(this.profileKey(p, 'appName'), config.appName);
    this.store.set(this.profileKey(p, 'apiKey'), config.apiKey);
    // Activate the saved profile automatically
    this.store.set('activeProfile', p);
  }

  /**
   * Retrieve the stored configuration for a given profile, or null if not configured.
   * If no profile is provided, uses the currently active profile.
   */
  getConfig(profile?: string): BubbleConfig | null {
    const p = profile ?? this.getActiveProfile();
    const appName = this.store.get(this.profileKey(p, 'appName')) as string | undefined;
    const apiKey = this.store.get(this.profileKey(p, 'apiKey')) as string | undefined;

    if (!appName || !apiKey) return null;
    return { appName, apiKey };
  }

  /**
   * Check whether credentials have been configured for the given profile.
   */
  isConfigured(profile?: string): boolean {
    return this.getConfig(profile) !== null;
  }

  /**
   * Clear stored configuration for a given profile.
   * If no profile is specified, clears the active profile.
   * Passing `'*'` clears ALL profiles and resets to factory defaults.
   */
  clearConfig(profile?: string): void {
    if (profile === '*') {
      this.store.clear();
      return;
    }
    const p = profile ?? this.getActiveProfile();
    this.store.delete(this.profileKey(p, 'appName'));
    this.store.delete(this.profileKey(p, 'apiKey'));
  }

  // ── File utilities ───────────────────────────────────────────────────────────

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
