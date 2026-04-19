import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardResponse,
  HeroOverview,
  HeroStat,
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
