import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * A plugin action definition in Bubble.
 */
export interface BubblePluginAction {
  id: string;
  name: string;
  category?: string;
  description?: string;
}

/**
 * A plugin definition with metadata and actions.
 */
export interface BubblePlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  actions?: BubblePluginAction[];
}

/**
 * Plugin definition file format accepted by `plugin deploy`.
 * Compatible with the structure used by `bubble-io-cli generate --template plugin-action`.
 */
export interface PluginDefinitionFile {
  name: string;
  description?: string;
  version?: string;
  actions: BubblePluginAction[];
}

/**
 * Client for the Bubble Plugin Editor API.
 *
 * NOTE: The Bubble Plugin Editor API requires a special token (different from the Data API key).
 * Obtain your Plugin Editor API token from:
 *   Bubble Editor → Plugins → Plugin Editor → Settings → API token
 *
 * @see https://manual.bubble.io/core-resources/api/plugin-editor-api
 */
export class BubblePluginClient {
  private readonly client: AxiosInstance;
  private readonly appName: string;

  constructor(appName: string, pluginToken: string) {
    this.appName = appName;

    this.client = axios.create({
      baseURL: `https://bubble.io/api/1.1/obj/plugin`,
      headers: {
        Authorization: `Bearer ${pluginToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string }>) => {
        const status = error.response?.status;
        const detail = error.response?.data?.message ?? error.message;

        if (status === 401) throw new Error('Plugin API authentication failed (401): Check your Plugin Editor API token.');
        if (status === 403) throw new Error('Plugin API access forbidden (403): Ensure Plugin Editor API access is enabled for your account.');
        if (status === 404) throw new Error('Plugin not found (404): The plugin ID or app name may be incorrect.');
        throw new Error(`Bubble Plugin API error${status ? ` [${status}]` : ''}: ${detail}`);
      }
    );
  }

  /**
   * List all plugins for the current Bubble app.
   * Returns plugin metadata without full action definitions.
   */
  async listPlugins(): Promise<BubblePlugin[]> {
    const response = await this.client.get<{ response: { results: BubblePlugin[] } }>(
      `?constraints=${JSON.stringify([{ key: 'app', constraint_type: 'equals', value: this.appName }])}`
    );
    return response.data.response?.results ?? [];
  }

  /**
   * Get a specific plugin's full definition by its ID.
   */
  async getPlugin(pluginId: string): Promise<BubblePlugin> {
    const response = await this.client.get<{ response: BubblePlugin }>(`/${pluginId}`);
    return response.data.response;
  }

  /**
   * Deploy (create or update) a plugin definition.
   * If `pluginId` is provided, the existing plugin is updated (PATCH).
   * If `pluginId` is omitted, a new plugin is created (POST).
   *
   * @param definition - Plugin definition to deploy
   * @param pluginId   - Optional existing plugin ID to update
   * @returns The ID of the created or updated plugin
   */
  async deployPlugin(definition: PluginDefinitionFile, pluginId?: string): Promise<string> {
    if (pluginId) {
      await this.client.patch(`/${pluginId}`, definition);
      return pluginId;
    }
    const response = await this.client.post<{ id: string }>('', { ...definition, app: this.appName });
    return response.data.id;
  }

  /** The Bubble app subdomain this client is connected to. */
  get app(): string { return this.appName; }
}
