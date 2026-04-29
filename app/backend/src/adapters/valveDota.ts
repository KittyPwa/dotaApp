import { fetchJsonWithRetry } from "../utils/http.js";
import type { ProviderFetchResult } from "../domain/provider.js";
import { ProviderRateLimitService } from "../services/providerRateLimitService.js";
import { SettingsService } from "../services/settingsService.js";

interface ValveMatchHistoryResponse {
  result?: {
    status?: number;
    statusDetail?: string;
    num_results?: number;
    total_results?: number;
    results_remaining?: number;
    matches?: ValveMatchHistoryItem[];
  };
}

interface ValveMatchHistoryItem {
  match_id?: number;
  match_seq_num?: number;
  start_time?: number;
  lobby_type?: number;
  players?: Array<{
    account_id?: number;
    player_slot?: number;
    hero_id?: number;
  }>;
}

interface ValveMatchDetailsResponse {
  result?: {
    match_id?: number;
    duration?: number;
    start_time?: number;
    radiant_win?: boolean;
    radiant_score?: number;
    dire_score?: number;
    leagueid?: number;
    players?: Array<{
      account_id?: number;
      player_slot?: number;
      hero_id?: number;
      kills?: number;
      deaths?: number;
      assists?: number;
      leaver_status?: number;
      gold?: number;
      last_hits?: number;
      denies?: number;
      gold_per_min?: number;
      xp_per_min?: number;
      level?: number;
      item_0?: number;
      item_1?: number;
      item_2?: number;
      item_3?: number;
      item_4?: number;
      item_5?: number;
      backpack_0?: number;
      backpack_1?: number;
      backpack_2?: number;
    }>;
    picks_bans?: Array<{
      is_pick?: boolean;
      hero_id?: number;
      team?: 0 | 1;
      order?: number;
    }>;
  };
}

export interface ValveLeagueMatch {
  match_id: number;
  start_time: number | null;
}

export interface ValveMatchDetails {
  match_id: number;
  duration?: number;
  start_time?: number;
  radiant_win?: boolean;
  radiant_score?: number;
  dire_score?: number;
  leagueid?: number;
  players?: Array<{
    account_id?: number;
    player_slot?: number;
    hero_id?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    last_hits?: number;
    denies?: number;
    gold_per_min?: number;
    xp_per_min?: number;
    level?: number;
    item_0?: number;
    item_1?: number;
    item_2?: number;
    item_3?: number;
    item_4?: number;
    item_5?: number;
    backpack_0?: number;
    backpack_1?: number;
    backpack_2?: number;
  }>;
  picks_bans?: Array<{
    is_pick: boolean;
    hero_id: number;
    team: 0 | 1;
    order: number;
  }>;
}

export class ValveDotaAdapter {
  private readonly baseUrl = "https://api.steampowered.com/IDOTA2Match_570";
  private readonly rateLimitService = new ProviderRateLimitService();
  private readonly settingsService = new SettingsService();

  constructor(private readonly apiKey: string | null) {}

  private assertConfigured() {
    if (!this.apiKey) {
      throw new Error("Steam Web API key is not configured.");
    }
  }

  private buildUrl(path: string) {
    this.assertConfigured();
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("key", this.apiKey ?? "");
    url.searchParams.set("format", "json");
    return url;
  }

  private async fetch<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    this.rateLimitService.consume("steam", {
      perSecond: settings.steamPerSecondCap,
      perMinute: settings.steamPerMinuteCap,
      perHour: settings.steamPerHourCap,
      perDay: settings.steamDailyRequestCap
    });
    return fetchJsonWithRetry<T>(input, init, { provider: "valve" });
  }

  async getLeagueMatches(leagueId: number, limit: number): Promise<ProviderFetchResult<ValveLeagueMatch[]>> {
    const fetchedAt = Date.now();
    const requested = Math.min(100, Math.max(1, limit));
    const url = this.buildUrl("/GetMatchHistory/v1/");
    url.searchParams.set("league_id", String(leagueId));
    url.searchParams.set("matches_requested", String(requested));
    url.searchParams.set("tournament_games_only", "1");

    const payload = await this.fetch<ValveMatchHistoryResponse>(
      url,
      { headers: { Accept: "application/json", "User-Agent": "DotaLocalAnalytics/1.0" } }
    );

    const result = payload.result;
    if (!result || (result.status !== undefined && result.status !== 1)) {
      throw new Error(result?.statusDetail ?? `Valve match history returned status ${result?.status ?? "unknown"}.`);
    }

    return {
      fetchedAt,
      payload: (result.matches ?? [])
        .filter((match): match is ValveMatchHistoryItem & { match_id: number } => Number.isInteger(match.match_id))
        .map((match) => ({
          match_id: match.match_id,
          start_time: typeof match.start_time === "number" ? match.start_time : null
        }))
    };
  }

  async getMatch(matchId: number): Promise<ProviderFetchResult<ValveMatchDetails>> {
    const fetchedAt = Date.now();
    const url = this.buildUrl("/GetMatchDetails/v1/");
    url.searchParams.set("match_id", String(matchId));

    const payload = await this.fetch<ValveMatchDetailsResponse>(
      url,
      { headers: { Accept: "application/json", "User-Agent": "DotaLocalAnalytics/1.0" } }
    );

    const result = payload.result;
    if (!result?.match_id) {
      throw new Error("Valve match details response did not include a match.");
    }

    return {
      fetchedAt,
      payload: {
        match_id: result.match_id,
        duration: result.duration,
        start_time: result.start_time,
        radiant_win: result.radiant_win,
        radiant_score: result.radiant_score,
        dire_score: result.dire_score,
        leagueid: result.leagueid,
        players: result.players?.map((player) => ({
          account_id: player.account_id,
          player_slot: player.player_slot,
          hero_id: player.hero_id,
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          last_hits: player.last_hits,
          denies: player.denies,
          gold_per_min: player.gold_per_min,
          xp_per_min: player.xp_per_min,
          level: player.level,
          item_0: player.item_0,
          item_1: player.item_1,
          item_2: player.item_2,
          item_3: player.item_3,
          item_4: player.item_4,
          item_5: player.item_5,
          backpack_0: player.backpack_0,
          backpack_1: player.backpack_1,
          backpack_2: player.backpack_2
        })),
        picks_bans: result.picks_bans
          ?.filter(
            (entry): entry is { is_pick: boolean; hero_id: number; team: 0 | 1; order: number } =>
              typeof entry.is_pick === "boolean" &&
              Number.isInteger(entry.hero_id) &&
              (entry.team === 0 || entry.team === 1) &&
              Number.isInteger(entry.order)
          )
      }
    };
  }
}
