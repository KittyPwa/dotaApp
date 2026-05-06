import { sqliteDb } from "../db/client.js";

export interface ProviderRateLimits {
  perSecond: number;
  perMinute: number;
  perHour: number;
  perDay: number;
}

function getRateLimitWindowStarts(now: number) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  return {
    oneSecondAgo: now - 1000,
    oneMinuteAgo: now - 60_000,
    oneHourAgo: now - 3_600_000,
    dayStart: dayStart.getTime()
  };
}

function parseIntegerHeader(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (!value) continue;
    const firstValue = value.split(",")[0]?.trim();
    const parsed = Number(firstValue);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return null;
}

function normalizeResetAt(value: number | null) {
  if (value === null) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function parseQuotaBucket(headers: Headers, window: "second" | "minute" | "hour" | "day") {
  const limit = parseIntegerHeader(headers, [
    `x-ratelimit-limit-${window}`,
    `x-rate-limit-limit-${window}`,
    `ratelimit-limit-${window}`
  ]);
  const remaining = parseIntegerHeader(headers, [
    `x-ratelimit-remaining-${window}`,
    `x-rate-limit-remaining-${window}`,
    `ratelimit-remaining-${window}`
  ]);
  return limit === null && remaining === null ? null : { limit, remaining };
}

function parseQuotaBucketsJson(value: string | null | undefined) {
  if (!value) return { second: null, minute: null, hour: null, day: null };
  try {
    const parsed = JSON.parse(value) as Partial<
      Record<"second" | "minute" | "hour" | "day", { limit: number | null; remaining: number | null } | null>
    >;
    return {
      second: parsed.second ?? null,
      minute: parsed.minute ?? null,
      hour: parsed.hour ?? null,
      day: parsed.day ?? null
    };
  } catch {
    return { second: null, minute: null, hour: null, day: null };
  }
}

export class ProviderRateLimitService {
  getUsage(provider: string) {
    const now = Date.now();
    const { oneSecondAgo, oneMinuteAgo, oneHourAgo, dayStart } = getRateLimitWindowStarts(now);

    sqliteDb
      .prepare("delete from provider_request_events where provider = ? and requested_at < ?")
      .run(provider, dayStart);

    const counts = sqliteDb
      .prepare(
        `
          select
            sum(case when requested_at >= ? then 1 else 0 end) as secondCount,
            sum(case when requested_at >= ? then 1 else 0 end) as minuteCount,
            sum(case when requested_at >= ? then 1 else 0 end) as hourCount,
            count(*) as dayCount
          from provider_request_events
          where provider = ? and requested_at >= ?
        `
      )
      .get(oneSecondAgo, oneMinuteAgo, oneHourAgo, provider, dayStart) as {
      secondCount: number | null;
      minuteCount: number | null;
      hourCount: number | null;
      dayCount: number | null;
    };

    return {
      second: counts.secondCount ?? 0,
      minute: counts.minuteCount ?? 0,
      hour: counts.hourCount ?? 0,
      day: counts.dayCount ?? 0
    };
  }

  consume(provider: string, limits: ProviderRateLimits) {
    const now = Date.now();
    const { oneSecondAgo, oneMinuteAgo, oneHourAgo, dayStart } = getRateLimitWindowStarts(now);

    const transaction = sqliteDb.transaction(() => {
      sqliteDb
        .prepare("delete from provider_request_events where provider = ? and requested_at < ?")
        .run(provider, dayStart);

      const counts = sqliteDb
        .prepare(
          `
            select
              sum(case when requested_at >= ? then 1 else 0 end) as secondCount,
              sum(case when requested_at >= ? then 1 else 0 end) as minuteCount,
              sum(case when requested_at >= ? then 1 else 0 end) as hourCount,
              count(*) as dayCount
            from provider_request_events
            where provider = ? and requested_at >= ?
          `
        )
        .get(oneSecondAgo, oneMinuteAgo, oneHourAgo, provider, dayStart) as {
        secondCount: number | null;
        minuteCount: number | null;
        hourCount: number | null;
        dayCount: number | null;
      };

      const secondCount = counts.secondCount ?? 0;
      const minuteCount = counts.minuteCount ?? 0;
      const hourCount = counts.hourCount ?? 0;
      const dayCount = counts.dayCount ?? 0;
      const quotaSnapshot = this.getQuotaSnapshot(provider);
      const quotaBuckets = parseQuotaBucketsJson(quotaSnapshot?.bucketsJson);
      const providerReportedRemaining = {
        second: quotaBuckets.second?.remaining ?? null,
        minute: quotaBuckets.minute?.remaining ?? null,
        hour: quotaBuckets.hour?.remaining ?? null,
        day: quotaBuckets.day?.remaining ?? quotaSnapshot?.remaining ?? null
      };
      const providerReportedLimits = {
        second: quotaBuckets.second?.limit ?? null,
        minute: quotaBuckets.minute?.limit ?? null,
        hour: quotaBuckets.hour?.limit ?? null,
        day: quotaBuckets.day?.limit ?? quotaSnapshot?.quotaLimit ?? null
      };

      if (providerReportedRemaining.second !== null && providerReportedRemaining.second <= 0) {
        throw new Error(`${provider} provider quota reached: 0 requests remaining/second.`);
      }
      if (providerReportedRemaining.minute !== null && providerReportedRemaining.minute <= 0) {
        throw new Error(`${provider} provider quota reached: 0 requests remaining/minute.`);
      }
      if (providerReportedRemaining.hour !== null && providerReportedRemaining.hour <= 0) {
        throw new Error(`${provider} provider quota reached: 0 requests remaining/hour.`);
      }
      if (providerReportedRemaining.day !== null && providerReportedRemaining.day <= 0) {
        throw new Error(`${provider} provider quota reached: 0 requests remaining/day.`);
      }

      const effectiveLimits = {
        perSecond: providerReportedLimits.second ?? limits.perSecond,
        perMinute: providerReportedLimits.minute ?? limits.perMinute,
        perHour: providerReportedLimits.hour ?? limits.perHour,
        perDay: providerReportedLimits.day ?? limits.perDay
      };

      if (secondCount >= effectiveLimits.perSecond) throw new Error(`${provider} rate limit reached: ${effectiveLimits.perSecond}/second.`);
      if (minuteCount >= effectiveLimits.perMinute) throw new Error(`${provider} rate limit reached: ${effectiveLimits.perMinute}/minute.`);
      if (hourCount >= effectiveLimits.perHour) throw new Error(`${provider} rate limit reached: ${effectiveLimits.perHour}/hour.`);
      if (dayCount >= effectiveLimits.perDay) throw new Error(`${provider} rate limit reached: ${effectiveLimits.perDay}/day.`);

      sqliteDb
        .prepare("insert into provider_request_events (provider, requested_at) values (?, ?)")
        .run(provider, now);
    });

    transaction();
  }

  recordQuotaSnapshot(provider: string, headers: Headers, statusCode: number) {
    const rawHeaders = Object.fromEntries(
      [...headers.entries()].filter(([key]) => {
        const normalized = key.toLowerCase();
        return (
          normalized.includes("ratelimit") ||
          normalized.includes("rate-limit") ||
          normalized === "retry-after" ||
          normalized.includes("calls") ||
          normalized.includes("quota")
        );
      })
    );
    const limit = parseIntegerHeader(headers, ["x-ratelimit-limit", "x-rate-limit-limit", "ratelimit-limit"]);
    const remaining = parseIntegerHeader(headers, [
      "x-ratelimit-remaining",
      "x-rate-limit-remaining",
      "ratelimit-remaining",
      "x-calls-remaining",
      "calls-remaining",
      "x-quota-remaining"
    ]);
    const buckets = {
      second: parseQuotaBucket(headers, "second"),
      minute: parseQuotaBucket(headers, "minute"),
      hour: parseQuotaBucket(headers, "hour"),
      day: parseQuotaBucket(headers, "day")
    };
    const effectiveLimit = buckets.day?.limit ?? limit;
    const effectiveRemaining = buckets.day?.remaining ?? remaining;
    const resetSeconds = parseIntegerHeader(headers, ["x-ratelimit-reset", "x-rate-limit-reset", "ratelimit-reset"]);
    const resetAt = resetSeconds !== null ? Date.now() + resetSeconds * 1000 : null;
    const retryAfterSeconds = parseIntegerHeader(headers, ["retry-after"]);

    if (
      Object.keys(rawHeaders).length === 0 &&
      effectiveLimit === null &&
      effectiveRemaining === null &&
      resetAt === null &&
      retryAfterSeconds === null
    ) {
      return;
    }

    sqliteDb
      .prepare(
        `
          insert into provider_quota_snapshots (
            provider,
            observed_at,
            status_code,
            quota_limit,
            remaining,
            reset_at,
            retry_after_seconds,
            buckets_json,
            raw_headers_json
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(provider) do update set
            observed_at = excluded.observed_at,
            status_code = excluded.status_code,
            quota_limit = excluded.quota_limit,
            remaining = excluded.remaining,
            reset_at = excluded.reset_at,
            retry_after_seconds = excluded.retry_after_seconds,
            buckets_json = excluded.buckets_json,
            raw_headers_json = excluded.raw_headers_json
        `
      )
      .run(
        provider,
        Date.now(),
        statusCode,
        effectiveLimit,
        effectiveRemaining,
        resetAt,
        retryAfterSeconds,
        JSON.stringify(buckets),
        JSON.stringify(rawHeaders)
      );
  }

  getQuotaSnapshot(provider: string) {
    return sqliteDb
      .prepare(
        `
          select
            provider,
            observed_at as observedAt,
            status_code as statusCode,
            quota_limit as quotaLimit,
            remaining,
            reset_at as resetAt,
            retry_after_seconds as retryAfterSeconds,
            buckets_json as bucketsJson,
            raw_headers_json as rawHeadersJson
          from provider_quota_snapshots
          where provider = ?
        `
      )
      .get(provider) as
      | {
          provider: string;
          observedAt: number;
          statusCode: number | null;
          quotaLimit: number | null;
          remaining: number | null;
          resetAt: number | null;
          retryAfterSeconds: number | null;
          bucketsJson: string | null;
          rawHeadersJson: string | null;
        }
      | undefined;
  }
}
