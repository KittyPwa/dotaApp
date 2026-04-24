import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { StatsRadarChart } from "../components/StatsRadarChart";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { usePlayer, useSettings, useSyncPlayerHistory } from "../hooks/useQueries";
import {
  apiPost,
  getLocalPrimaryPlayerIdOverride,
  setLocalPrimaryPlayerIdOverride,
  setLocalAutoRefreshPlayerIdsOverride,
  setLocalFavoritePlayerIdsOverride
} from "../api/client";
import { formatDate, formatDuration } from "../lib/format";

type SortKey = "startTime" | "durationSeconds" | "heroName" | "kda" | "result" | "parsedData";
type ResultFilter = "all" | "wins" | "losses";
type PlayerTab = "overview" | "heroes" | "teammates" | "matches";
type QueueFilter = "all" | "ranked" | "unranked" | "turbo";

function calculateKda(kills: number | null, deaths: number | null, assists: number | null) {
  const total = (kills ?? 0) + (assists ?? 0);
  const safeDeaths = Math.max(deaths ?? 0, 1);
  return total / safeDeaths;
}

function formatDayKey(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function formatRank(rankTier: number | null, leaderboardRank: number | null) {
  if (!rankTier) return "Unknown";
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  const medalNames = ["Unranked", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
  const medalName = medalNames[medal] ?? `Tier ${rankTier}`;
  if (leaderboardRank) return `${medalName} (#${leaderboardRank})`;
  return stars > 0 ? `${medalName} ${stars}` : medalName;
}

export function PlayerPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerId = params.playerId ? Number(params.playerId) : null;
  const [leagueFilter, setLeagueFilter] = useState(searchParams.get("leagueId") ?? "all");
  const [queueFilter, setQueueFilter] = useState<QueueFilter>((searchParams.get("queue") as QueueFilter) ?? "all");
  const [heroFilter, setHeroFilter] = useState(searchParams.get("heroId") ?? "all");
  const query = usePlayer(Number.isFinite(playerId) ? playerId : null, {
    leagueId: leagueFilter !== "all" ? Number(leagueFilter) : null,
    queue: queueFilter,
    heroId: heroFilter !== "all" ? Number(heroFilter) : null
  });
  const settingsQuery = useSettings();
  const syncHistory = useSyncPlayerHistory(Number.isFinite(playerId) ? playerId : null);
  const favoritePlayerIds = settingsQuery.data?.favoritePlayerIds ?? [];
  const autoRefreshPlayerIds = settingsQuery.data?.autoRefreshPlayerIds ?? [];
  const currentPrimaryPlayerId = settingsQuery.data?.primaryPlayerId ?? null;
  const isFavorite = playerId !== null && favoritePlayerIds.includes(playerId);
  const autoRefreshEnabled = playerId !== null && autoRefreshPlayerIds.includes(playerId);
  const isYourPlayer = playerId !== null && currentPrimaryPlayerId === playerId;
  const canManagePlayerPreferences = true;
  const canManagePlayerAdminActions =
    !(settingsQuery.data?.adminPasswordConfigured ?? false) || (settingsQuery.data?.adminUnlocked ?? false);

  const [sortKey, setSortKey] = useState<SortKey>("startTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [heroSearch, setHeroSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [activeTab, setActiveTab] = useState<PlayerTab>(
    (searchParams.get("tab") as PlayerTab | null) ?? (searchParams.get("leagueId") || searchParams.get("heroId") ? "matches" : "overview")
  );

  useEffect(() => {
    const queryLeagueId = searchParams.get("leagueId");
    const queryQueue = (searchParams.get("queue") as QueueFilter | null) ?? "all";
    const queryHeroId = searchParams.get("heroId");
    const queryTab = searchParams.get("tab") as PlayerTab | null;
    setLeagueFilter(queryLeagueId ?? "all");
    setQueueFilter(queryQueue);
    setHeroFilter(queryHeroId ?? "all");
    if (queryTab) {
      setActiveTab(queryTab);
    } else if (queryLeagueId || queryHeroId) {
      setActiveTab("matches");
    }
  }, [searchParams]);

  const toggleFavorite = async () => {
    if (!settingsQuery.data || playerId === null || currentPrimaryPlayerId === null) return;

    const nextFavoriteIds = isFavorite
      ? favoritePlayerIds.filter((id) => id !== playerId)
      : [...favoritePlayerIds, playerId].filter((value, index, list) => list.indexOf(value) === index);
    try {
      await apiPost("/api/player-preferences/favorites", {
        ownerPlayerId: currentPrimaryPlayerId,
        favoritePlayerIds: nextFavoriteIds
      });
      setLocalFavoritePlayerIdsOverride([]);
      await settingsQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await queryClient.invalidateQueries({ queryKey: ["player-compare"] });
      await queryClient.invalidateQueries({ queryKey: ["community"] });
    } catch {
      // Let the shared error surface handle future improvements; keep UI stable for now.
    }
  };

  const setAsYourPlayer = () => {
    if (playerId === null) return;
    setLocalPrimaryPlayerIdOverride(playerId);
    void settingsQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["player-compare"] });
  };

  const clearAsYourPlayer = () => {
    setLocalPrimaryPlayerIdOverride(null);
    void settingsQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["player-compare"] });
  };

  const toggleAutoRefresh = () => {
    if (!settingsQuery.data || playerId === null) return;

    const nextAutoRefreshIds = autoRefreshEnabled
      ? autoRefreshPlayerIds.filter((id) => id !== playerId)
      : [...autoRefreshPlayerIds, playerId].filter((value, index, list) => list.indexOf(value) === index);
    setLocalAutoRefreshPlayerIdsOverride(nextAutoRefreshIds);
    void settingsQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const playerData = query.data;
  const playerLeagues = playerData?.availableLeagues ?? [];
  const filteredMatches =
    playerData?.matches.filter((match) => {
      return resultFilter === "wins" ? match.win === true : resultFilter === "losses" ? match.win === false : true;
    }) ?? [];

  const searchedMatches = filteredMatches.filter((match) => {
    const needle = matchSearch.trim().toLowerCase();
    if (!needle) return true;
    return (
      String(match.matchId).includes(needle) ||
      (match.heroName ?? "").toLowerCase().includes(needle) ||
      (match.leagueName ?? "").toLowerCase().includes(needle) ||
      match.gameModeLabel.toLowerCase().includes(needle)
    );
  });

  const sortedMatches = [...searchedMatches].sort((left, right) => {
    let compare = 0;

    switch (sortKey) {
      case "durationSeconds":
        compare = (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
        break;
      case "heroName":
        compare = (left.heroName ?? "").localeCompare(right.heroName ?? "");
        break;
      case "kda":
        compare =
          calculateKda(left.kills, left.deaths, left.assists) - calculateKda(right.kills, right.deaths, right.assists);
        break;
      case "result":
        compare = Number(left.win ?? false) - Number(right.win ?? false);
        break;
      case "parsedData":
        compare = left.parsedData.label.localeCompare(right.parsedData.label);
        break;
      case "startTime":
      default:
        compare = (left.startTime ?? 0) - (right.startTime ?? 0);
        break;
    }

    return sortDirection === "asc" ? compare : -compare;
  });

  const pagination = usePagination(sortedMatches.length, 20, [20, 50, 100]);
  const pagedMatches = pagination.paged(sortedMatches);
  const filteredHeroUsage =
    playerData?.heroUsage.filter((hero) => {
      const needle = heroSearch.trim().toLowerCase();
      return !needle || hero.heroName.toLowerCase().includes(needle);
    }) ?? [];
  const heroUsagePagination = usePagination(filteredHeroUsage.length, 12, [12, 24, 50, 100]);
  const pagedHeroUsage = heroUsagePagination.paged(filteredHeroUsage);

  const activityMap = new Map<string, { wins: number; losses: number; total: number }>();
  for (const match of playerData?.matches ?? []) {
    const dayKey = formatDayKey(match.startTime);
    if (!dayKey) continue;

    const entry = activityMap.get(dayKey) ?? { wins: 0, losses: 0, total: 0 };
    entry.total += 1;
    if (match.win === true) entry.wins += 1;
    if (match.win === false) entry.losses += 1;
    activityMap.set(dayKey, entry);
  }

  const activityDays = [...activityMap.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .slice(-84);
  const maxDailyMatches = Math.max(1, ...activityDays.map(([, value]) => value.total));

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((value) => (value === "desc" ? "asc" : "desc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "heroName" ? "asc" : "desc");
  };

  const updateScopeFilters = (next: { leagueId?: string; queue?: QueueFilter; heroId?: string; tab?: PlayerTab | null }) => {
    const nextLeague = next.leagueId ?? leagueFilter;
    const nextQueue = next.queue ?? queueFilter;
    const nextHero = next.heroId ?? heroFilter;
    const params = new URLSearchParams();
    if (nextLeague !== "all") params.set("leagueId", nextLeague);
    if (nextQueue !== "all") params.set("queue", nextQueue);
    if (nextHero !== "all") params.set("heroId", nextHero);
    if (next.tab) params.set("tab", next.tab);
    setSearchParams(params);
  };

  return (
    <Page
      title={
        playerData ? (
          <span className="page-title-with-icon">
            {playerData.avatar ? (
              <img className="avatar avatar-sm" src={playerData.avatar} alt={playerData.personaname ?? String(playerData.playerId)} />
            ) : (
              <span className="avatar avatar-sm avatar-fallback">{String(playerData.personaname ?? playerData.playerId).slice(0, 2)}</span>
            )}
            <span className="page-title-copy">
              <span>{playerData.personaname ?? `Player ${playerData.playerId}`}</span>
              <span className="page-title-meta">
                <span>Steam ID {playerData.playerId}</span>
                <span>{playerData.countryCode ?? "Country unknown"}</span>
                <span>{formatRank(playerData.rankTier, playerData.leaderboardRank)}</span>
              </span>
            </span>
          </span>
        ) : (
          `Player ${params.playerId ?? ""}`
        )
      }
    >
      {query.isLoading ? <LoadingState label="Loading player data..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {settingsQuery.error ? <ErrorState error={settingsQuery.error as Error} /> : null}
      {playerData ? (
        <>
          <MetricGrid
            items={[
              { label: "Source", value: playerData.source === "fresh" ? "Fresh fetch" : "Cache" },
              { label: "Last synced", value: formatDate(playerData.lastSyncedAt) },
              { label: "Visible matches", value: playerData.totalStoredMatches },
              { label: "Local matches", value: playerData.totalLocalMatches },
              { label: "Match scope", value: playerData.matchScopeLabel },
              { label: "Win / loss", value: `${playerData.wins} / ${playerData.losses}` },
              { label: "Rank", value: formatRank(playerData.rankTier, playerData.leaderboardRank) },
              { label: "History synced", value: formatDate(playerData.historySyncedAt) }
            ]}
          />

          <Card title="Scope and actions">
            <div className="player-scope-header">
              <div className="table-controls player-scope-controls player-scope-controls-wide">
                {playerLeagues.length > 0 ? (
                  <label>
                    League
                    <select
                      value={leagueFilter}
                      onChange={(event) => {
                        const nextLeagueId = event.target.value;
                        setLeagueFilter(nextLeagueId);
                        updateScopeFilters({ leagueId: nextLeagueId });
                        pagination.resetPage();
                        heroUsagePagination.resetPage();
                      }}
                    >
                      <option value="all">All leagues</option>
                      {playerLeagues.map((league) => (
                        <option key={league.leagueId} value={league.leagueId}>
                          {league.leagueName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {playerData.availableHeroes.length > 0 ? (
                  <label>
                    Hero
                    <select
                      value={heroFilter}
                      onChange={(event) => {
                        const nextHeroId = event.target.value;
                        setHeroFilter(nextHeroId);
                        updateScopeFilters({ heroId: nextHeroId });
                        pagination.resetPage();
                        heroUsagePagination.resetPage();
                      }}
                    >
                      <option value="all">All heroes</option>
                      {playerData.availableHeroes.map((hero) => (
                        <option key={hero.heroId} value={hero.heroId}>
                          {hero.heroName}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  Queue
                  <select
                    value={queueFilter}
                    onChange={(event) => {
                      const nextQueue = event.target.value as QueueFilter;
                      setQueueFilter(nextQueue);
                      updateScopeFilters({ queue: nextQueue });
                      pagination.resetPage();
                      heroUsagePagination.resetPage();
                    }}
                  >
                    <option value="all">All queues</option>
                    <option value="ranked">Ranked</option>
                    <option value="unranked">Unranked</option>
                    <option value="turbo">Turbo</option>
                  </select>
                </label>
              </div>
              <div className="player-header-actions">
                {canManagePlayerPreferences ? (
                  <>
                    <button type="button" onClick={isYourPlayer ? clearAsYourPlayer : setAsYourPlayer} disabled={settingsQuery.isLoading}>
                      {isYourPlayer ? "Unset as your player" : "Set as your player"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleFavorite()}
                      disabled={settingsQuery.isLoading || currentPrimaryPlayerId === null || isYourPlayer}
                      title={
                        currentPrimaryPlayerId === null
                          ? "Set your player first"
                          : isYourPlayer
                            ? "Your player cannot also be a favorite"
                            : undefined
                      }
                    >
                      {isFavorite ? "Remove favorite" : "Add to favorites"}
                    </button>
                    <button type="button" onClick={toggleAutoRefresh} disabled={settingsQuery.isLoading}>
                      {autoRefreshEnabled ? "Stop refresh on open" : "Refresh on open"}
                    </button>
                  </>
                ) : null}
                {canManagePlayerAdminActions ? (
                  <>
                    <button type="button" onClick={() => syncHistory.mutate()} disabled={syncHistory.isPending}>
                      {syncHistory.isPending ? "Syncing..." : "Sync more history"}
                    </button>
                  </>
                ) : null}
                <Link className="inline-link-chip" to={`/compare?ids=${playerData.playerId}`}>
                  Compare this player
                </Link>
              </div>
            </div>
            {syncHistory.isError ? <p className="form-error">{(syncHistory.error as Error).message}</p> : null}
            {syncHistory.isSuccess ? <p className="form-success">Deeper player history synced locally.</p> : null}
          </Card>

          <div className="settings-tabs" role="tablist" aria-label="Player sections">
            {[
              ["overview", "Overview"],
              ["heroes", "Heroes"],
              ["teammates", "Teammates"],
              ["matches", "Matches"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`settings-tab ${activeTab === key ? "active" : ""}`}
                onClick={() => setActiveTab(key as PlayerTab)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? (
          <div className="two-column two-column-balanced">
              <Card title="Performance radar">
                <StatsRadarChart
                  key={playerData.playerId}
                  players={[
                    {
                      playerId: playerData.playerId,
                      personaname: playerData.personaname,
                      comparisonStats: playerData.comparisonStats
                    }
                  ]}
                  compact
                />
              </Card>
              <Card title="Match activity calendar">
                {activityDays.length === 0 ? (
                  <EmptyState label="No locally stored matches yet." />
                ) : (
                  <div className="stack compact">
                    <div className="calendar-grid">
                      {activityDays.map(([day, stats]) => {
                        const bubbleSize = 12 + Math.round((stats.total / maxDailyMatches) * 20);
                        const tone =
                          stats.wins > stats.losses ? "win" : stats.losses > stats.wins ? "loss" : "neutral";

                        return (
                          <div
                            key={day}
                            className="calendar-cell"
                            title={`${day} | ${stats.total} matches | ${stats.wins}W / ${stats.losses}L`}
                          >
                            <span className="calendar-day">{day.slice(8)}</span>
                            <span className={`calendar-bubble ${tone}`} style={{ width: `${bubbleSize}px`, height: `${bubbleSize}px` }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </Card>
          </div>
          ) : null}

          {activeTab === "heroes" || activeTab === "teammates" ? (
          <div className="two-column">
            {activeTab === "heroes" ? (
            <TableCard
              title="Hero usage"
              rowCount={pagedHeroUsage.length}
              totalItems={filteredHeroUsage.length}
              page={heroUsagePagination.page}
              totalPages={heroUsagePagination.totalPages}
              pageSize={heroUsagePagination.pageSize}
              pageSizeOptions={heroUsagePagination.pageSizeOptions}
              onPreviousPage={heroUsagePagination.previousPage}
              onNextPage={heroUsagePagination.nextPage}
              onPageSizeChange={heroUsagePagination.setPageSize}
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={heroSearch}
                      onChange={(event) => {
                        setHeroSearch(event.target.value);
                        heroUsagePagination.resetPage();
                      }}
                      placeholder="Hero"
                    />
                  </label>
                </div>
              }
              empty={<EmptyState label="No locally stored hero usage for the active match scope yet." />}
            >
              {filteredHeroUsage.length === 0 ? (
                <EmptyState label="No locally stored hero usage for the active match scope yet." />
              ) : (
                <div className="stack compact">
                  <p className="muted-inline">Scope: {playerData.matchScopeLabel}</p>
                  {pagedHeroUsage.map((hero) => (
                    <div key={hero.heroId} className="hero-bar-row">
                      <Link
                        className="entity-link"
                        to={`/players/${playerData.playerId}?${new URLSearchParams({
                          ...(leagueFilter !== "all" ? { leagueId: leagueFilter } : {}),
                          ...(queueFilter !== "all" ? { queue: queueFilter } : {}),
                          heroId: String(hero.heroId),
                          tab: "matches"
                        }).toString()}`}
                      >
                        <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                        <span>{hero.heroName}</span>
                      </Link>
                      <div className="hero-bar-track">
                        <div
                          className="hero-bar-fill"
                          style={{ width: `${Math.max(8, (hero.games / filteredHeroUsage[0].games) * 100)}%` }}
                        />
                      </div>
                      <strong>{hero.games}</strong>
                      <span className="muted-inline">{hero.winrate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </TableCard>
            ) : null}

            {activeTab === "teammates" ? (
            <Card title="Most played with">
              {playerData.peers.length === 0 ? (
                <EmptyState label="No repeated teammates found in the local dataset yet." />
              ) : (
                <div className="roster-list">
                  {playerData.peers.map((peer) => (
                    <div key={peer.playerId} className="player-panel">
                      <div className="player-panel-header">
                        <div className="entity-link">
                          {peer.avatar ? (
                            <img className="avatar avatar-sm" src={peer.avatar} alt={peer.personaname ?? String(peer.playerId)} />
                          ) : (
                            <div className="avatar avatar-sm avatar-fallback">
                              {String(peer.personaname ?? peer.playerId).slice(0, 2)}
                            </div>
                          )}
                          <div className="stack compact">
                            <strong>
                              <Link to={`/players/${peer.playerId}`}>{peer.personaname ?? `Player ${peer.playerId}`}</Link>
                            </strong>
                            <span className="muted-inline">
                              {peer.games} games together | {peer.wins} wins | {peer.winrate}% winrate
                            </span>
                          </div>
                        </div>
                        <Link className="inline-link-chip" to={`/compare?ids=${playerData.playerId},${peer.playerId}`}>
                          Compare
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            ) : null}
          </div>
          ) : null}

          {activeTab === "matches" ? (
          <>
          <Card title="Match result filter">
            <div className="table-controls">
              <label>
                Result
                <select
                    value={resultFilter}
                    onChange={(event) => {
                      setResultFilter(event.target.value as ResultFilter);
                      pagination.resetPage();
                    }}
                >
                  <option value="all">All</option>
                  <option value="wins">Wins</option>
                  <option value="losses">Losses</option>
                </select>
              </label>
            </div>
          </Card>

          <TableCard
            title="Stored match history"
            rowCount={pagedMatches.length}
            totalItems={sortedMatches.length}
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            pageSizeOptions={pagination.pageSizeOptions}
            onPreviousPage={pagination.previousPage}
            onNextPage={pagination.nextPage}
            onPageSizeChange={pagination.setPageSize}
            extra={
              <div className="table-controls">
                <label>
                  Search
                  <input
                    type="search"
                    value={matchSearch}
                    onChange={(event) => {
                      setMatchSearch(event.target.value);
                      pagination.resetPage();
                    }}
                    placeholder="Match, hero, league, queue"
                  />
                </label>
              </div>
            }
            empty={<EmptyState label="No matches stored for this filter yet." />}
          >
            <DataTable
              className="player-history-table"
              rows={pagedMatches}
              getRowKey={(match) => String(match.matchId)}
              rowClassName={(match) =>
                match.win === true ? "row-win" : match.win === false ? "row-loss" : "row-unknown"
              }
              columns={[
                {
                  key: "match",
                  header: "Match",
                  cell: (match) => <Link to={`/matches/${match.matchId}`}>{match.matchId}</Link>
                },
                {
                  key: "date",
                  header: "Date",
                  sortable: true,
                  cell: (match) => formatDate(match.startTime)
                },
                {
                  key: "hero",
                  header: "Hero",
                  sortable: true,
                  cell: (match) => (
                    <Link className="entity-link" to={`/heroes/${match.heroId}`}>
                      <IconImage src={match.heroIconUrl} alt={match.heroName ?? "Hero"} size="sm" />
                      <span>{match.heroName ?? match.heroId ?? "Unknown"}</span>
                    </Link>
                  )
                },
                {
                  key: "kda",
                  header: "KDA",
                  sortable: true,
                  cell: (match) => `${match.kills ?? 0}/${match.deaths ?? 0}/${match.assists ?? 0}`
                },
                {
                  key: "duration",
                  header: "Duration",
                  sortable: true,
                  cell: (match) => formatDuration(match.durationSeconds)
                },
                {
                  key: "result",
                  header: "Result",
                  sortable: true,
                  cell: (match) => (match.win === null ? "Unknown" : match.win ? "Win" : "Loss")
                },
                {
                  key: "queue",
                  header: "Queue",
                  cell: (match) => match.gameModeLabel
                },
                {
                  key: "league",
                  header: "League",
                  cell: (match) =>
                    match.leagueId ? (
                      <Link to={`/leagues/${match.leagueId}`}>{match.leagueName ?? `League ${match.leagueId}`}</Link>
                    ) : (
                      "Public"
                    )
                },
                {
                  key: "parsedData",
                  header: "Parsed data",
                  sortable: true,
                  cell: (match) => (
                    <span
                      className={`parsed-data-pill ${match.parsedData.label === "Full" ? "rich" : "basic"}`}
                      title={[
                        match.parsedData.hasFullMatchPayload ? "Full match payload" : "No full match payload",
                        match.parsedData.timelines ? "Timelines" : null,
                        match.parsedData.itemTimings ? "Item timings" : null,
                        match.parsedData.vision ? "Vision" : null
                      ]
                        .filter(Boolean)
                        .join(" | ")}
                    >
                      {match.parsedData.label}
                    </span>
                  )
                }
              ]}
              sortState={{ key: sortKey === "startTime" ? "date" : sortKey === "heroName" ? "hero" : sortKey === "durationSeconds" ? "duration" : sortKey, direction: sortDirection }}
              onSortChange={(key) => {
                const nextKey = key === "date" ? "startTime" : key === "hero" ? "heroName" : key === "duration" ? "durationSeconds" : (key as SortKey);
                toggleSort(nextKey);
              }}
            />
          </TableCard>
          </>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
