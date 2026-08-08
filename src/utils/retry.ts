import chalk from 'chalk';
import { AxiosError } from 'axios';

export interface RetryOptions {
  retries?: number;      // default: 3
  initialDelay?: number; // default: 1000ms
  maxDelay?: number;     // default: 15000ms
  jitter?: boolean;      // default: true
}

/**
 * Detects if an error is retryable (Network error, 429, or 5xx).
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    // Network errors (no response)
    if (!error.response) {
      const code = error.code;
      return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ERR_NETWORK';
    }

    const status = error.response.status;
    // Rate limit (429) or Server errors (5xx)
    return status === 429 || (status >= 500 && status < 600);
  }

  // If it's wrapped in a custom Error by our clients, try to extract the status
  if (error instanceof Error) {
    const match = error.message.match(/\[(\d{3})\]/);
    if (match) {
      const status = parseInt(match[1], 10);
      return status === 429 || (status >= 500 && status < 600);
    }
    
    // Check for network error keywords in message
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnaborted')) {
      return true;
    }
  }

  return false;
}

/**
 * Executes a function with exponential backoff retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  let delay = options.initialDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 15000;
  const useJitter = options.jitter ?? true;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (attempt > retries || !isRetryableError(error)) {
        throw error;
      }

      let currentDelay = delay;
      if (useJitter) {
        // Add +/- 25% jitter
        const jitterValue = currentDelay * 0.25;
        currentDelay = currentDelay + (Math.random() * 2 * jitterValue - jitterValue);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown network error';
      console.warn(
        chalk.yellow(
          `⚠️ Request failed (${errorMessage}). Retrying in ${Math.round(currentDelay)}ms (Attempt ${attempt}/${retries})...`
        )
      );

      await new Promise((resolve) => setTimeout(resolve, currentDelay));

      // Exponential backoff for next attempt
      delay = Math.min(delay * 2, maxDelay);
    }
  }
  
  throw new Error('Unreachable');
}
