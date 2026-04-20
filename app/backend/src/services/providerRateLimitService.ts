import { sqliteDb } from "../db/client.js";

export interface ProviderRateLimits {
  perSecond: number;
  perMinute: number;
  perHour: number;
  perDay: number;
}

export class ProviderRateLimitService {
  consume(provider: string, limits: ProviderRateLimits) {
    const now = Date.now();
    const oneSecondAgo = now - 1000;
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;
    const oneDayAgo = now - 86_400_000;

    const transaction = sqliteDb.transaction(() => {
      sqliteDb
        .prepare("delete from provider_request_events where provider = ? and requested_at < ?")
        .run(provider, oneDayAgo);

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
        .get(oneSecondAgo, oneMinuteAgo, oneHourAgo, provider, oneDayAgo) as {
        secondCount: number | null;
        minuteCount: number | null;
        hourCount: number | null;
        dayCount: number | null;
      };

      const secondCount = counts.secondCount ?? 0;
      const minuteCount = counts.minuteCount ?? 0;
      const hourCount = counts.hourCount ?? 0;
      const dayCount = counts.dayCount ?? 0;

      if (secondCount >= limits.perSecond) {
        throw new Error(`STRATZ rate limit reached: ${limits.perSecond}/second.`);
      }
      if (minuteCount >= limits.perMinute) {
        throw new Error(`STRATZ rate limit reached: ${limits.perMinute}/minute.`);
      }
      if (hourCount >= limits.perHour) {
        throw new Error(`STRATZ rate limit reached: ${limits.perHour}/hour.`);
      }
      if (dayCount >= limits.perDay) {
        throw new Error(`STRATZ rate limit reached: ${limits.perDay}/day.`);
      }

      sqliteDb
        .prepare("insert into provider_request_events (provider, requested_at) values (?, ?)")
        .run(provider, now);
    });

    transaction();
  }
}
