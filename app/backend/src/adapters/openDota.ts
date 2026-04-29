import { fetchJsonWithRetry } from "../utils/http.js";
import type { ProviderFetchResult } from "../domain/provider.js";
import { ProviderRateLimitService } from "../services/providerRateLimitService.js";
import { SettingsService } from "../services/settingsService.js";

export interface OpenDotaPlayerProfileResponse {
  profile?: {
    account_id?: number;
    personaname?: string;
    avatarmedium?: string;
    profileurl?: string;
    loccountrycode?: string;
  };
  rank_tier?: number;
  leaderboard_rank?: number;
}

export interface OpenDotaRecentMatch {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  duration: number | null;
  game_mode: number | null;
  lobby_type?: number | null;
  hero_id: number | null;
  start_time: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  lane_role: number | null;
}

export interface OpenDotaPlayerWinLossResponse {
  win?: number;
  lose?: number;
}

export interface OpenDotaLeagueMatch {
  match_id: number;
  radiant_win?: boolean | null;
  radiant_score?: number | null;
  dire_score?: number | null;
  duration?: number | null;
  start_time?: number | null;
  leagueid?: number | null;
  league_name?: string | null;
}

interface OpenDotaExplorerResponse<T> {
  rows?: T[];
  err?: string | null;
}

export interface OpenDotaMatchResponse {
  match_id: number;
  duration?: number;
  start_time?: number;
  radiant_win?: boolean;
  game_mode?: number;
  lobby_type?: number;
  radiant_score?: number;
  dire_score?: number;
  patch?: number;
  leagueid?: number;
  league_name?: string;
  radiant_team?: { team_id?: number; name?: string; tag?: string } | null;
  dire_team?: { team_id?: number; name?: string; tag?: string } | null;
  radiant_name?: string;
  dire_name?: string;
  radiant_team_id?: number;
  dire_team_id?: number;
  players?: Array<{
    account_id?: number;
    personaname?: string;
    player_slot?: number;
    hero_id?: number;
    kills?: number;
    deaths?: number;
    assists?: number;
    net_worth?: number;
    gold_per_min?: number;
    xp_per_min?: number;
    hero_damage?: number;
    hero_healing?: number;
    tower_damage?: number;
    last_hits?: number;
    denies?: number;
    level?: number;
    item_0?: number;
    item_1?: number;
    item_2?: number;
    item_3?: number;
    item_4?: number;
    item_5?: number;
    item_neutral?: number;
    backpack_0?: number;
    backpack_1?: number;
    backpack_2?: number;
    gold_t?: number[];
    xp_t?: number[];
    lh_t?: number[];
    dn_t?: number[];
    first_purchase_time?: Record<string, number>;
    ability_upgrades_arr?: number[];
    ability_upgrades?: Array<{ ability?: number; time?: number; level?: number }>;
    item_uses?: Record<string, number>;
    purchase_log?: Array<{ time?: number; key?: string; charges?: number }>;
    obs_log?: Array<{ time?: number; x?: number; y?: number; z?: number }>;
    sen_log?: Array<{ time?: number; x?: number; y?: number; z?: number }>;
    obs_placed?: number;
    sen_placed?: number;
    observer_kills?: number;
    camps_stacked?: number;
    courier_kills?: number;
  }>;
  picks_bans?: Array<{
    is_pick: boolean;
    hero_id: number;
    team: 0 | 1;
    order: number;
  }>;
}

export interface OpenDotaHeroStatsResponseItem {
  id: number;
  name: string;
  localized_name: string;
  icon?: string;
  img?: string;
  primary_attr?: string;
  attack_type?: string;
  roles?: string[];
}

export type OpenDotaItemsResponse = Record<
  string,
  {
    id: number;
    dname?: string;
    img?: string;
    cost?: number;
  }
>;

export interface OpenDotaParseRequestResponse {
  job?: {
    jobId?: number;
    type?: string;
  };
  message?: string;
  error?: string;
}

export interface OpenDotaPatchResponseItem {
  id: number;
  name: string;
  date?: string;
}

export type OpenDotaAbilityIdsResponse = Record<string, string>;

export type OpenDotaAbilitiesResponse = Record<
  string,
  {
    dname?: string;
    img?: string;
  }
>;

export class OpenDotaAdapter {
  private readonly baseUrl = "https://api.opendota.com/api";
  private readonly rateLimitService = new ProviderRateLimitService();
  private readonly settingsService = new SettingsService();

  constructor(private readonly apiKey: string | null) {}

  private buildUrl(path: string) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    }
    return url;
  }

  private async fetch<T>(input: RequestInfo | URL, init: RequestInit): Promise<T> {
    const settings = await this.settingsService.getSettings({ includeProtected: true });
    this.rateLimitService.consume("opendota", {
      perSecond: settings.openDotaPerSecondCap,
      perMinute: settings.openDotaPerMinuteCap,
      perHour: settings.openDotaPerHourCap,
      perDay: settings.openDotaDailyRequestCap
    });
    return fetchJsonWithRetry<T>(input, init, { provider: "opendota" });
  }

  async getPlayerProfile(playerId: number): Promise<ProviderFetchResult<OpenDotaPlayerProfileResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaPlayerProfileResponse>(
      this.buildUrl(`/players/${playerId}`),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getPlayerRecentMatches(playerId: number): Promise<ProviderFetchResult<OpenDotaRecentMatch[]>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaRecentMatch[]>(
      this.buildUrl(`/players/${playerId}/recentMatches`),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getPlayerMatches(playerId: number, options?: { days?: number }): Promise<ProviderFetchResult<OpenDotaRecentMatch[]>> {
    const fetchedAt = Date.now();
    const url = this.buildUrl(`/players/${playerId}/matches`);
    if (options?.days) {
      url.searchParams.set("date", String(options.days));
    }
    const payload = await this.fetch<OpenDotaRecentMatch[]>(
      url,
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getPlayerWinLoss(playerId: number): Promise<ProviderFetchResult<OpenDotaPlayerWinLossResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaPlayerWinLossResponse>(
      this.buildUrl(`/players/${playerId}/wl`),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getLeagueMatches(leagueId: number): Promise<ProviderFetchResult<OpenDotaLeagueMatch[]>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaLeagueMatch[]>(
      this.buildUrl(`/leagues/${leagueId}/matches`),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getLeagueMatchesFromExplorer(leagueId: number): Promise<ProviderFetchResult<OpenDotaLeagueMatch[]>> {
    const fetchedAt = Date.now();
    const url = this.buildUrl("/explorer");
    url.searchParams.set(
      "sql",
      `
        select match_id, start_time, duration, radiant_win, leagueid
        from matches
        where leagueid = ${leagueId}
        order by start_time desc
        limit 500
      `
    );
    const payload = await this.fetch<OpenDotaExplorerResponse<OpenDotaLeagueMatch>>(
      url,
      { headers: { Accept: "application/json" } }
    );
    if (payload.err) {
      throw new Error(payload.err);
    }
    return { payload: payload.rows ?? [], fetchedAt };
  }

  async getMatch(matchId: number): Promise<ProviderFetchResult<OpenDotaMatchResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaMatchResponse>(
      this.buildUrl(`/matches/${matchId}`),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async requestMatchParse(matchId: number): Promise<ProviderFetchResult<OpenDotaParseRequestResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaParseRequestResponse>(
      this.buildUrl(`/request/${matchId}`),
      { method: "POST", headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getHeroStats(): Promise<ProviderFetchResult<OpenDotaHeroStatsResponseItem[]>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaHeroStatsResponseItem[]>(
      this.buildUrl("/heroStats"),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getItems(): Promise<ProviderFetchResult<OpenDotaItemsResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaItemsResponse>(
      this.buildUrl("/constants/items"),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getPatches(): Promise<ProviderFetchResult<OpenDotaPatchResponseItem[]>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaPatchResponseItem[]>(
      this.buildUrl("/constants/patch"),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getAbilityIds(): Promise<ProviderFetchResult<OpenDotaAbilityIdsResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaAbilityIdsResponse>(
      this.buildUrl("/constants/ability_ids"),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }

  async getAbilities(): Promise<ProviderFetchResult<OpenDotaAbilitiesResponse>> {
    const fetchedAt = Date.now();
    const payload = await this.fetch<OpenDotaAbilitiesResponse>(
      this.buildUrl("/constants/abilities"),
      { headers: { Accept: "application/json" } }
    );
    return { payload, fetchedAt };
  }
}
