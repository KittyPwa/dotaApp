import { logger } from "./logger.js";

export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean
  ) {
    super(message);
  }
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { retries?: number; provider: string }
): Promise<T> {
  const retries = options.retries ?? 2;
  let attempt = 0;
  let delayMs = 500;

  while (attempt <= retries) {
    const response = await fetch(input, init);

    if (response.ok) {
      return (await response.json()) as T;
    }

    const retryable = response.status >= 500 || response.status === 429;
    const body = await response.text();

    if (!retryable || attempt === retries) {
      logger.error("Upstream request failed", {
        provider: options.provider,
        statusCode: response.status,
        body
      });
      throw new UpstreamHttpError(
        `Upstream request failed with status ${response.status}`,
        response.status,
        retryable
      );
    }

    logger.warn("Retrying upstream request", {
      provider: options.provider,
      statusCode: response.status,
      attempt
    });

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
    attempt += 1;
  }

  throw new UpstreamHttpError("Unexpected upstream failure", 500, false);
}
