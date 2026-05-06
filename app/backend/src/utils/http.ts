import { logger } from "./logger.js";

export class UpstreamHttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly bodySnippet: string | null = null
  ) {
    super(message);
  }
}

export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    retries?: number;
    provider: string;
    operation?: string;
    context?: Record<string, unknown>;
    onResponseHeaders?: (headers: Headers, statusCode: number) => void;
  }
): Promise<T> {
  const retries = options.retries ?? 2;
  let attempt = 0;
  let delayMs = 500;
  const startedAt = Date.now();

  while (attempt <= retries) {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      logger.error("Upstream request network failure", {
        provider: options.provider,
        operation: options.operation ?? null,
        context: options.context ?? null,
        attempt,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    try {
      options.onResponseHeaders?.(response.headers, response.status);
    } catch (error) {
      logger.warn("Failed to record upstream response headers", {
        provider: options.provider,
        operation: options.operation ?? null,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const retryable = response.status >= 500 || response.status === 429;
    const body = await response.text();
    const bodySnippet = body.replace(/\s+/g, " ").trim().slice(0, 500) || null;
    const isCloudflareChallenge =
      response.status === 403 &&
      (body.includes("Just a moment") || body.includes("Enable JavaScript and cookies to continue") || body.includes("cf_chl"));
    const message = isCloudflareChallenge
      ? "Upstream request was blocked by Cloudflare (403). This environment may not be allowed to access the provider API directly."
      : `Upstream request failed with status ${response.status}${bodySnippet ? `: ${bodySnippet}` : ""}`;
    const responseHeaders = Object.fromEntries(
      [...response.headers.entries()].filter(([key]) =>
        [
          "age",
          "cf-cache-status",
          "cf-ray",
          "content-type",
          "date",
          "retry-after",
          "server",
          "x-cache",
          "x-ratelimit-limit",
          "x-ratelimit-remaining",
          "x-ratelimit-reset"
        ].includes(key.toLowerCase())
      )
    );
    const logPayload = {
      provider: options.provider,
      operation: options.operation ?? null,
      context: options.context ?? null,
      statusCode: response.status,
      attempt,
      elapsedMs: Date.now() - startedAt,
      headers: responseHeaders,
      bodySnippet
    };

    if (!retryable || attempt === retries) {
      logger.error("Upstream request failed", logPayload);
      throw new UpstreamHttpError(
        message,
        response.status,
        retryable,
        bodySnippet
      );
    }

    logger.warn("Retrying upstream request", logPayload);

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
    attempt += 1;
  }

  throw new UpstreamHttpError("Unexpected upstream failure", 500, false);
}
