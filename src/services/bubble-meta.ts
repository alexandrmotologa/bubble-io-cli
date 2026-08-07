import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * A single field definition from the Bubble Meta API.
 */
export interface BubbleField {
  id: string;
  display: string;
  type: string;
  optionList?: string;
}

/**
 * A single data type definition from the Bubble Meta API.
 */
export interface BubbleDataType {
  id: string;
  display: string;
  fields: BubbleField[];
}

/**
 * Response envelope from the Bubble Meta API /types endpoint.
 */
interface MetaApiResponse {
  types: BubbleDataType[];
}

/**
 * Client for the Bubble.io Meta API.
 * Provides introspection of app schema (data types and their fields).
 *
 * @see https://manual.bubble.io/core-resources/api/the-bubble-api#the-meta-endpoint
 */
export class BubbleMetaClient {
  private readonly client: AxiosInstance;
  private readonly appName: string;
  private readonly environment: string;

  constructor(appName: string, apiKey: string, environment: string = 'version-test') {
    this.appName = appName;
    this.environment = environment;

    this.client = axios.create({
      baseURL: `https://${appName}.bubbleapps.io/${environment}/api/1.1/meta`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30_000,
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string }>) => {
        const status = error.response?.status;
        const apiMsg = error.response?.data?.message;
        const detail = apiMsg ?? error.message;

        if (status === 401) throw new Error(`Authentication failed (401): Check your API key.`);
        if (status === 403) throw new Error(`Meta API access forbidden (403): Enable the Meta API in your Bubble app settings.`);
        throw new Error(`Bubble Meta API error${status ? ` [${status}]` : ''}: ${detail}`);
      }
    );
  }

  /**
   * Fetch all data types and their field definitions from the Bubble Meta API.
   */
  async getDataTypes(): Promise<BubbleDataType[]> {
    const response = await this.client.get<MetaApiResponse>('/types');
    return response.data.types ?? [];
  }

  /** The Bubble app subdomain this client is connected to. */
  get app(): string { return this.appName; }

  /** The environment this client targets. */
  get env(): string { return this.environment; }
}
