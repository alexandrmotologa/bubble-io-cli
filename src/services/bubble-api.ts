import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Bubble API pagination cursor response envelope.
 */
export interface BubbleApiResponse<T> {
  cursor: number;
  count: number;
  remaining: number;
  results: T[];
}

/**
 * High-level result returned from a paginated fetch.
 */
export interface FetchResult<T> {
  totalFetched: number;
  results: T[];
}

/**
 * Client for the Bubble.io Data API.
 * Handles authentication, pagination (cursor-based), and error normalisation.
 */
export class BubbleApiClient {
  private readonly client: AxiosInstance;
  private readonly appName: string;
  private readonly environment: string;

  constructor(appName: string, apiKey: string, environment: string = 'version-test') {
    this.appName = appName;
    this.environment = environment;

    this.client = axios.create({
      baseURL: `https://${appName}.bubbleapps.io/${environment}/api/1.1/obj`,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    });

    // Attach response error interceptor for uniform error messages
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError<{ message?: string }>) => {
        const status = error.response?.status;
        const apiMsg = error.response?.data?.message;
        const detail = apiMsg ?? error.message;

        if (status === 401) {
          throw new Error(`Authentication failed (401): Check your API key.`);
        }
        if (status === 404) {
          throw new Error(`Data type not found (404): Verify the type name and environment.`);
        }
        throw new Error(`Bubble API error${status ? ` [${status}]` : ''}: ${detail}`);
      }
    );
  }

  /**
   * Fetch records for a given data type, automatically following
   * Bubble's cursor-based pagination until all records are retrieved.
   *
   * @param typeName   - The Bubble data type (e.g. 'User', 'Product')
   * @param maxRecords - Optional cap on the total number of records to fetch.
   *                     When omitted, all records are fetched (full pagination).
   *                     When provided, fetching stops as soon as this count is reached.
   */
  async getAllRecords<T = Record<string, unknown>>(
    typeName: string,
    maxRecords?: number
  ): Promise<FetchResult<T>> {
    const allResults: T[] = [];
    let cursor = 0;
    const pageSize = 100;

    do {
      // When a limit is set, only request up to the remaining quota per page
      const remaining_quota = maxRecords !== undefined ? maxRecords - allResults.length : pageSize;
      const limit = Math.min(pageSize, remaining_quota);

      const response = await this.client.get<{ response: BubbleApiResponse<T> }>(`/${typeName}`, {
        params: { cursor, limit },
      });

      const { results, remaining } = response.data.response;
      allResults.push(...results);
      cursor += results.length;

      // Stop if no more pages, or if we've reached the requested cap
      if (remaining === 0) break;
      if (maxRecords !== undefined && allResults.length >= maxRecords) break;
    } while (true);

    return {
      totalFetched: allResults.length,
      results: allResults,
    };
  }

  /**
   * Fetch a single page of records from a Bubble data type.
   */
  async getDataType<T = Record<string, unknown>>(
    typeName: string,
    cursor: number = 0,
    limit: number = 100
  ): Promise<BubbleApiResponse<T>> {
    const response = await this.client.get<{ response: BubbleApiResponse<T> }>(`/${typeName}`, {
      params: { cursor, limit },
    });
    return response.data.response;
  }

  /**
   * Check connectivity to the Bubble app by performing a minimal API call.
   */
  async ping(typeName: string = 'User'): Promise<boolean> {
    try {
      await this.client.get(`/${typeName}`, { params: { limit: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  /** The Bubble app subdomain this client is connected to. */
  get app(): string {
    return this.appName;
  }

  /** The environment (version-test / version-live) this client targets. */
  get env(): string {
    return this.environment;
  }
}
