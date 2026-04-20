import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardResponse,
  HeroOverview,
  HeroStat,
  LeagueOverview,
  LeagueSummary,
  LeagueSyncResponse,
  MatchOverview,
  PlayerCompareResponse,
  PlayerOverview,
  SettingsPayload
} from "@dota/shared";
import { apiGet, apiPost } from "../api/client";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardResponse>("/api/dashboard")
  });
}

export function useHeroStats() {
  return useQuery({
    queryKey: ["hero-stats"],
    queryFn: () => apiGet<HeroStat[]>("/api/heroes/stats")
  });
}

export function useHero(heroId: number | null) {
  return useQuery({
    queryKey: ["hero", heroId],
    queryFn: () => apiGet<HeroOverview>(`/api/heroes/${heroId}`),
    enabled: heroId !== null
  });
}

export function useLeagues() {
  return useQuery({
    queryKey: ["leagues"],
    queryFn: () => apiGet<LeagueSummary[]>("/api/leagues")
  });
}

export function useLeague(leagueId: number | null) {
  return useQuery({
    queryKey: ["league", leagueId],
    queryFn: () => apiGet<LeagueOverview>(`/api/leagues/${leagueId}`),
    enabled: leagueId !== null
  });
}

export function useSyncLeague(leagueId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (limit: number) => apiPost<LeagueSyncResponse>(`/api/leagues/${leagueId}/sync`, { limit }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["league", leagueId] });
      await queryClient.invalidateQueries({ queryKey: ["leagues"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
    }
  });
}

export function usePlayer(playerId: number | null) {
  return useQuery({
    queryKey: ["player", playerId],
    queryFn: () => apiGet<PlayerOverview>(`/api/players/${playerId}`),
    enabled: playerId !== null
  });
}

export function useMatch(matchId: number | null) {
  return useQuery({
    queryKey: ["match", matchId],
    queryFn: () => apiGet<MatchOverview>(`/api/matches/${matchId}`),
    enabled: matchId !== null
  });
}

export function useRefreshMatch(matchId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<MatchOverview>(`/api/matches/${matchId}/refresh`, {}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["match", matchId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["hero"] });
    }
  });
}

export function usePlayerCompare(playerIds: number[]) {
  const ids = [...new Set(playerIds.filter((id) => Number.isInteger(id) && id > 0))];

  return useQuery({
    queryKey: ["player-compare", ids.join(",")],
    queryFn: () => apiGet<PlayerCompareResponse>(`/api/players/compare?ids=${ids.join(",")}`),
    enabled: ids.length >= 2
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<SettingsPayload>("/api/settings")
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: SettingsPayload) => apiPost<SettingsPayload>("/api/settings", payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["player"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["hero"] });
      await queryClient.invalidateQueries({ queryKey: ["player-compare"] });
    }
  });
}

export function useSyncPlayerHistory(playerId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiPost<PlayerOverview>(`/api/players/${playerId}/sync-history`, {}),
    onSuccess: async (_, syncedPlayerId) => {
      await queryClient.invalidateQueries({ queryKey: ["player", playerId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    }
  });
}
