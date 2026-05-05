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
  options: { retries?: number; provider: string; operation?: string }
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
    const bodySnippet = body.replace(/\s+/g, " ").trim().slice(0, 500) || null;
    const isCloudflareChallenge =
      response.status === 403 &&
      (body.includes("Just a moment") || body.includes("Enable JavaScript and cookies to continue") || body.includes("cf_chl"));
    const message = isCloudflareChallenge
      ? "Upstream request was blocked by Cloudflare (403). This environment may not be allowed to access the provider API directly."
      : `Upstream request failed with status ${response.status}${bodySnippet ? `: ${bodySnippet}` : ""}`;

    if (!retryable || attempt === retries) {
      logger.error("Upstream request failed", {
        provider: options.provider,
        operation: options.operation ?? null,
        statusCode: response.status,
        body
      });
      throw new UpstreamHttpError(
        message,
        response.status,
        retryable,
        bodySnippet
      );
    }

    logger.warn("Retrying upstream request", {
      provider: options.provider,
      operation: options.operation ?? null,
      statusCode: response.status,
      attempt
    });

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
    attempt += 1;
  }

  throw new UpstreamHttpError("Unexpected upstream failure", 500, false);
}
