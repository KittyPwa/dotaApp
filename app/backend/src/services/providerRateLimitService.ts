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

      if (secondCount >= limits.perSecond) throw new Error(`${provider} rate limit reached: ${limits.perSecond}/second.`);
      if (minuteCount >= limits.perMinute) throw new Error(`${provider} rate limit reached: ${limits.perMinute}/minute.`);
      if (hourCount >= limits.perHour) throw new Error(`${provider} rate limit reached: ${limits.perHour}/hour.`);
      if (dayCount >= limits.perDay) throw new Error(`${provider} rate limit reached: ${limits.perDay}/day.`);

      sqliteDb
        .prepare("insert into provider_request_events (provider, requested_at) values (?, ?)")
        .run(provider, now);
    });

    transaction();
  }
}
