import { fetchJsonWithRetry } from "../utils/http.js";
import type { ProviderFetchResult } from "../domain/provider.js";

export interface OpenDotaPlayerProfileResponse {
  profile?: {
    account_id?: number;
    personaname?: string;
    avatarmedium?: string;
    profileurl?: string;
    loccountrycode?: string;
  };
}

export interface OpenDotaRecentMatch {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  duration: number | null;
  game_mode: number | null;
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

export interface OpenDotaMatchResponse {
  match_id: number;
  duration?: number;
  start_time?: number;
  radiant_win?: boolean;
  radiant_score?: number;
  dire_score?: number;
  patch?: number;
  leagueid?: number;
  league_name?: string;
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
    backpack_0?: number;
    backpack_1?: number;
    backpack_2?: number;
    first_purchase_time?: Record<string, number>;
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
  }
>;

export class OpenDotaAdapter {
  private readonly baseUrl = "https://api.opendota.com/api";

  constructor(private readonly apiKey: string | null) {}

  private buildUrl(path: string) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (this.apiKey) {
      url.searchParams.set("api_key", this.apiKey);
    }
    return url;
  }

  async getPlayerProfile(playerId: number): Promise<ProviderFetchResult<OpenDotaPlayerProfileResponse>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaPlayerProfileResponse>(
      this.buildUrl(`/players/${playerId}`),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getPlayerRecentMatches(playerId: number): Promise<ProviderFetchResult<OpenDotaRecentMatch[]>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaRecentMatch[]>(
      this.buildUrl(`/players/${playerId}/recentMatches`),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getPlayerMatches(playerId: number, options?: { days?: number }): Promise<ProviderFetchResult<OpenDotaRecentMatch[]>> {
    const fetchedAt = Date.now();
    const url = this.buildUrl(`/players/${playerId}/matches`);
    if (options?.days) {
      url.searchParams.set("date", String(options.days));
    }
    const payload = await fetchJsonWithRetry<OpenDotaRecentMatch[]>(
      url,
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getPlayerWinLoss(playerId: number): Promise<ProviderFetchResult<OpenDotaPlayerWinLossResponse>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaPlayerWinLossResponse>(
      this.buildUrl(`/players/${playerId}/wl`),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getMatch(matchId: number): Promise<ProviderFetchResult<OpenDotaMatchResponse>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaMatchResponse>(
      this.buildUrl(`/matches/${matchId}`),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getHeroStats(): Promise<ProviderFetchResult<OpenDotaHeroStatsResponseItem[]>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaHeroStatsResponseItem[]>(
      this.buildUrl("/heroStats"),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }

  async getItems(): Promise<ProviderFetchResult<OpenDotaItemsResponse>> {
    const fetchedAt = Date.now();
    const payload = await fetchJsonWithRetry<OpenDotaItemsResponse>(
      this.buildUrl("/constants/items"),
      { headers: { Accept: "application/json" } },
      { provider: "opendota" }
    );
    return { payload, fetchedAt };
  }
}
