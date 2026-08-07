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
 * Bubble API constraint object for server-side filtering.
 * @see https://manual.bubble.io/core-resources/api/the-bubble-api#search-constraints
 */
export interface BubbleConstraint {
  key: string;
  constraint_type:
    | 'equals'
    | 'not equal'
    | 'is_empty'
    | 'is_not_empty'
    | 'text contains'
    | 'not text contains'
    | 'greater than'
    | 'less than'
    | 'in'
    | 'not in'
    | 'contains'
    | 'not contains'
    | 'geographic_search';
  value?: unknown;
}

/**
 * Result of a record creation call.
 */
export interface CreateResult {
  id: string;
}

/**
 * Client for the Bubble.io Data API.
 * Handles authentication, pagination (cursor-based), filtering, and error normalisation.
 */
export class BubbleApiClient {
  private readonly client: AxiosInstance;
  private readonly appName: string;
  private readonly environment: string;

  /**
   * @param appName     - The Bubble.io app subdomain (e.g. 'my-app')
   * @param apiKey      - The Bubble Data API key
   * @param environment - Target environment (default: 'version-test')
   * @param httpClient  - Optional pre-configured AxiosInstance (used in tests for DI)
   */
  constructor(
    appName: string,
    apiKey: string,
    environment: string = 'version-test',
    httpClient?: AxiosInstance
  ) {
    this.appName = appName;
    this.environment = environment;

    this.client = httpClient ?? axios.create({
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
   * @param typeName    - The Bubble data type (e.g. 'User', 'Product')
   * @param maxRecords  - Optional cap on the total number of records to fetch.
   *                      When omitted, all records are fetched (full pagination).
   * @param constraints - Optional array of server-side filter constraints.
   */
  async getAllRecords<T = Record<string, unknown>>(
    typeName: string,
    maxRecords?: number,
    constraints?: BubbleConstraint[]
  ): Promise<FetchResult<T>> {
    const allResults: T[] = [];
    let cursor = 0;
    const pageSize = 100;

    const constraintsParam =
      constraints && constraints.length > 0 ? JSON.stringify(constraints) : undefined;

    do {
      const remaining_quota = maxRecords !== undefined ? maxRecords - allResults.length : pageSize;
      const limit = Math.min(pageSize, remaining_quota);

      const response = await this.client.get<{ response: BubbleApiResponse<T> }>(`/${typeName}`, {
        params: {
          cursor,
          limit,
          ...(constraintsParam && { constraints: constraintsParam }),
        },
      });

      const { results, remaining } = response.data.response;
      allResults.push(...results);
      cursor += results.length;

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
    limit: number = 100,
    constraints?: BubbleConstraint[]
  ): Promise<BubbleApiResponse<T>> {
    const constraintsParam =
      constraints && constraints.length > 0 ? JSON.stringify(constraints) : undefined;

    const response = await this.client.get<{ response: BubbleApiResponse<T> }>(`/${typeName}`, {
      params: {
        cursor,
        limit,
        ...(constraintsParam && { constraints: constraintsParam }),
      },
    });
    return response.data.response;
  }

  /**
   * Create a new record of the given data type.
   * Returns the newly created record's Bubble ID.
   */
  async createRecord(
    typeName: string,
    data: Record<string, unknown>
  ): Promise<CreateResult> {
    const response = await this.client.post<{ id: string }>(`/${typeName}`, data);
    return { id: response.data.id };
  }

  /**
   * Update (PATCH) an existing record by its Bubble ID.
   */
  async updateRecord(
    typeName: string,
    id: string,
    data: Record<string, unknown>
  ): Promise<void> {
    await this.client.patch(`/${typeName}/${id}`, data);
  }

  /**
   * Delete an existing record by its Bubble ID.
   */
  async deleteRecord(typeName: string, id: string): Promise<void> {
    await this.client.delete(`/${typeName}/${id}`);
  }

  /**
   * Trigger a Bubble backend workflow by its API name.
   * The workflow must have "This workflow can be triggered by API" enabled in Bubble.
   * Sends a POST request to /wf/<workflowName> with the provided payload.
   */
  async triggerWorkflow(
    workflowName: string,
    data: Record<string, unknown> = {}
  ): Promise<unknown> {
    // Bubble workflow endpoint is at a different base path (/wf/) not /obj/
    const baseUrl = `https://${this.appName}.bubbleapps.io/${this.environment}/api/1.1/wf`;
    const response = await this.client.post(`${baseUrl}/${workflowName}`, data, {
      baseURL: '', // override the /obj/ base to use absolute URL
    });
    return response.data;
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
