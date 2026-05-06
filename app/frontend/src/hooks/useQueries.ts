import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CommunityGraph,
  DraftContextResponse,
  DashboardResponse,
  DraftPlanPayload,
  HeroOverview,
  HeroStat,
  LeagueOverview,
  LeagueSummary,
  LeagueSyncResponse,
  MatchOverview,
  PlayerCompareResponse,
  PlayerOverview,
  SettingsPayload,
  TeamOverview
} from "@dota/shared";
import { apiDelete, apiGet, apiPost, ensureLocalDraftOwnerKey } from "../api/client";

export type ProviderEnrichmentSummary = {
  counts: Array<{ provider: "stratz" | "opendota_parse"; status: string; count: number }>;
  dueCount: number;
  nextAttemptAt: number | null;
  providerUsage: Array<{
    provider: "stratz" | "opendota" | "steam" | "enrichment";
    usage: { second: number; minute: number; hour: number; day: number };
    limits: { perSecond: number; perMinute: number; perHour: number; perDay: number };
    upstreamQuota: {
      observedAt: number;
      statusCode: number | null;
      limit: number | null;
      remaining: number | null;
      resetAt: number | null;
      retryAfterSeconds: number | null;
      rawHeaders: Record<string, string>;
    } | null;
  }>;
  worker: {
    enabled: boolean;
    running: boolean;
    lastRunAt: number | null;
    lastFinishedAt: number | null;
    nextRunAt: number | null;
    lastQueued: {
      scannedMatches: number;
      stratzQueued: number;
      openDotaParseQueued: number;
    } | null;
    lastProcessedCount: number;
    lastError: string | null;
  };
  enrichedMatches: Array<{
    matchId: number;
    provider: "stratz" | "opendota_parse";
    enrichedAt: number | null;
    startTime: number | null;
  }>;
  recentAttempts: Array<{
    matchId: number;
    provider: "stratz" | "opendota_parse";
    status: string;
    attempts: number;
    attemptedAt: number | null;
    nextAttemptAt: number | null;
    lastError: string | null;
    startTime: number | null;
    parsedData: {
      label: string;
      hasFullMatchPayload: boolean;
      timelines: boolean;
      itemTimings: boolean;
      vision: boolean;
    };
  }>;
};

export type ProviderEnrichmentEnqueueResponse = {
  scannedMatches: number;
  stratzQueued: number;
  openDotaParseQueued: number;
  summary: ProviderEnrichmentSummary;
};

export type ProviderEnrichmentProcessResponse = {
  processed: Array<{ matchId: number; provider: "stratz" | "opendota_parse"; status: string; message: string | null }>;
  summary: ProviderEnrichmentSummary;
};

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardResponse>("/api/dashboard")
  });
}

export function useHeroStats(filters?: { leagueId?: number | null }) {
  const query = new URLSearchParams();
  if (filters?.leagueId) query.set("leagueId", String(filters.leagueId));
  const suffix = query.toString();

  return useQuery({
    queryKey: ["hero-stats", filters?.leagueId ?? null],
    queryFn: () => apiGet<HeroStat[]>(`/api/heroes/stats${suffix ? `?${suffix}` : ""}`)
  });
}

export function useHero(
  heroId: number | null,
  filters?: { leagueId?: number | null; minRankTier?: number | null; maxRankTier?: number | null }
) {
  const query = new URLSearchParams();
  if (filters?.leagueId) query.set("leagueId", String(filters.leagueId));
  if (filters?.minRankTier) query.set("minRankTier", String(filters.minRankTier));
  if (filters?.maxRankTier) query.set("maxRankTier", String(filters.maxRankTier));
  const suffix = query.toString();

  return useQuery({
    queryKey: ["hero", heroId, filters?.leagueId ?? null, filters?.minRankTier ?? null, filters?.maxRankTier ?? null],
    queryFn: () => apiGet<HeroOverview>(`/api/heroes/${heroId}${suffix ? `?${suffix}` : ""}`),
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

export function useLeagueTeam(leagueId: number | null, teamId: number | null) {
  return useQuery({
    queryKey: ["league-team", leagueId, teamId],
    queryFn: () => apiGet<TeamOverview>(`/api/leagues/${leagueId}/teams/${teamId}`),
    enabled: leagueId !== null && teamId !== null
  });
}

export function useDraftPlans(leagueId: number | null, enabled = true) {
  const query = new URLSearchParams();
  if (leagueId) query.set("leagueId", String(leagueId));
  const suffix = query.toString();

  return useQuery({
    queryKey: ["draft-plans", leagueId],
    queryFn: () => apiGet<DraftPlanPayload[]>(`/api/draft-plans${suffix ? `?${suffix}` : ""}`),
    enabled
  });
}

export function useDraftContext(firstPlayerIds: number[], secondPlayerIds: number[]) {
  const firstIds = [...new Set(firstPlayerIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 5);
  const secondIds = [...new Set(secondPlayerIds.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 5);
  const query = new URLSearchParams();
  if (firstIds.length) query.set("firstPlayerIds", firstIds.join(","));
  if (secondIds.length) query.set("secondPlayerIds", secondIds.join(","));
  const suffix = query.toString();

  return useQuery({
    queryKey: ["draft-context", firstIds.join(","), secondIds.join(",")],
    queryFn: () => apiGet<DraftContextResponse>(`/api/draft-context${suffix ? `?${suffix}` : ""}`),
    enabled: firstIds.length > 0 || secondIds.length > 0
  });
}

export function useSaveDraftPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (draft: DraftPlanPayload) => {
      await ensureLocalDraftOwnerKey();
      return apiPost<DraftPlanPayload>("/api/draft-plans", draft);
    },
    onSuccess: async (draft) => {
      await queryClient.invalidateQueries({ queryKey: ["draft-plans", draft.leagueId] });
      await queryClient.invalidateQueries({ queryKey: ["draft-plans", null] });
    }
  });
}

export function useDeleteDraftPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ draftId, leagueId }: { draftId: string; leagueId: number }) =>
      apiDelete<{ ok: boolean }>(`/api/draft-plans/${encodeURIComponent(draftId)}`).then((result) => ({ ...result, leagueId })),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["draft-plans", result.leagueId] });
      await queryClient.invalidateQueries({ queryKey: ["draft-plans", null] });
    }
  });
}

export function useSyncLeague(leagueId: number | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (limit: number) => apiPost<LeagueSyncResponse>(`/api/leagues/${leagueId}/sync`, { limit }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["league", leagueId] });
      await queryClient.invalidateQueries({ queryKey: ["league-team"] });
      await queryClient.invalidateQueries({ queryKey: ["leagues"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
    }
  });
}

export function usePlayer(
  playerId: number | null,
  filters?: { leagueId?: number | null; queue?: "all" | "ranked" | "unranked" | "turbo"; heroId?: number | null }
) {
  const query = new URLSearchParams();
  if (filters?.leagueId) query.set("leagueId", String(filters.leagueId));
  if (filters?.queue && filters.queue !== "all") query.set("queue", filters.queue);
  if (filters?.heroId) query.set("heroId", String(filters.heroId));
  const suffix = query.toString();

  return useQuery({
    queryKey: ["player", playerId, filters?.leagueId ?? null, filters?.queue ?? "all", filters?.heroId ?? null],
    queryFn: () => apiGet<PlayerOverview>(`/api/players/${playerId}${suffix ? `?${suffix}` : ""}`),
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

export function useCommunity(enabled = true) {
  return useQuery({
    queryKey: ["community"],
    queryFn: () => apiGet<CommunityGraph>("/api/community"),
    enabled
  });
}

export function useProviderEnrichment(enabled = true) {
  return useQuery({
    queryKey: ["provider-enrichment"],
    queryFn: () => apiGet<ProviderEnrichmentSummary>("/api/provider-enrichment"),
    enabled,
    refetchInterval: enabled ? 15_000 : false
  });
}

export function useEnqueueProviderEnrichment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (limit: number) => apiPost<ProviderEnrichmentEnqueueResponse>("/api/provider-enrichment/enqueue", { limit }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-enrichment"] });
    }
  });
}

export function useProcessProviderEnrichment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (limit: number) => apiPost<ProviderEnrichmentProcessResponse>("/api/provider-enrichment/process", { limit }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-enrichment"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["player"] });
      await queryClient.invalidateQueries({ queryKey: ["match"] });
    }
  });
}

export function useProcessProviderEnrichmentOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (provider?: "stratz" | "opendota_parse" | null) =>
      apiPost<ProviderEnrichmentProcessResponse>("/api/provider-enrichment/process-override", { provider: provider ?? null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-enrichment"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["hero-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["player"] });
      await queryClient.invalidateQueries({ queryKey: ["match"] });
    }
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
      await queryClient.invalidateQueries({ queryKey: ["provider-enrichment"] });
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
