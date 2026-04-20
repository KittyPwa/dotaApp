import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { usePlayer, useSaveSettings, useSettings, useSyncPlayerHistory } from "../hooks/useQueries";
import { formatDate, formatDuration } from "../lib/format";

type SortKey = "startTime" | "durationSeconds" | "heroName" | "kda" | "result" | "parsedData";
type ResultFilter = "all" | "wins" | "losses";

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
  const params = useParams();
  const playerId = params.playerId ? Number(params.playerId) : null;
  const query = usePlayer(Number.isFinite(playerId) ? playerId : null);
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const syncHistory = useSyncPlayerHistory(Number.isFinite(playerId) ? playerId : null);
  const favoritePlayerIds = settingsQuery.data?.favoritePlayerIds ?? [];
  const autoRefreshPlayerIds = settingsQuery.data?.autoRefreshPlayerIds ?? [];
  const isFavorite = playerId !== null && favoritePlayerIds.includes(playerId);
  const autoRefreshEnabled = playerId !== null && autoRefreshPlayerIds.includes(playerId);

  const [sortKey, setSortKey] = useState<SortKey>("startTime");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");

  const toggleFavorite = () => {
    if (!settingsQuery.data || playerId === null) return;

    const nextFavoriteIds = isFavorite
      ? favoritePlayerIds.filter((id) => id !== playerId)
      : [...favoritePlayerIds, playerId].filter((value, index, list) => list.indexOf(value) === index);

    saveSettings.mutate({
      ...settingsQuery.data,
      favoritePlayerIds: nextFavoriteIds
    });
  };

  const toggleAutoRefresh = () => {
    if (!settingsQuery.data || playerId === null) return;

    const nextAutoRefreshIds = autoRefreshEnabled
      ? autoRefreshPlayerIds.filter((id) => id !== playerId)
      : [...autoRefreshPlayerIds, playerId].filter((value, index, list) => list.indexOf(value) === index);

    saveSettings.mutate({
      ...settingsQuery.data,
      autoRefreshPlayerIds: nextAutoRefreshIds
    });
  };

  const playerData = query.data;
  const filteredMatches =
    playerData?.matches.filter((match) => {
      if (resultFilter === "wins") return match.win === true;
      if (resultFilter === "losses") return match.win === false;
      return true;
    }) ?? [];

  const sortedMatches = [...filteredMatches].sort((left, right) => {
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
  const heroUsagePagination = usePagination(playerData?.heroUsage.length ?? 0, 12, [12, 24, 50, 100]);
  const pagedHeroUsage = heroUsagePagination.paged(playerData?.heroUsage ?? []);

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

  return (
    <Page
      title={`Player ${params.playerId ?? ""}`}
      subtitle="Profile, recent matches, teammates, and local history insights."
      aside={
        playerData && playerId !== null ? (
          <div className="action-group">
            <button type="button" onClick={toggleFavorite} disabled={saveSettings.isPending || settingsQuery.isLoading}>
              {saveSettings.isPending ? "Saving..." : isFavorite ? "Remove favorite" : "Add to favorites"}
            </button>
            <button type="button" onClick={toggleAutoRefresh} disabled={saveSettings.isPending || settingsQuery.isLoading}>
              {saveSettings.isPending ? "Saving..." : autoRefreshEnabled ? "Stop refresh on open" : "Refresh on open"}
            </button>
            <button type="button" onClick={() => syncHistory.mutate()} disabled={syncHistory.isPending}>
              {syncHistory.isPending ? "Syncing..." : "Sync more history"}
            </button>
          </div>
        ) : null
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
              { label: "Favorite", value: isFavorite ? "Yes" : "No" },
              { label: "Refresh on open", value: playerData.autoRefreshOnOpen ? "Yes" : "No" },
              { label: "Priority player", value: playerData.isPriorityPlayer ? "Yes" : "No" },
              { label: "History synced", value: formatDate(playerData.historySyncedAt) }
            ]}
          />

          <div className="two-column">
            <Card title={playerData.personaname ?? `Player ${playerData.playerId}`}>
              <div className="stack compact">
                {playerData.avatar ? <img className="avatar" src={playerData.avatar} alt="" /> : null}
                <p>Steam account ID: {playerData.playerId}</p>
                <p>Country: {playerData.countryCode ?? "Unknown"}</p>
                <p>Rank: {formatRank(playerData.rankTier, playerData.leaderboardRank)}</p>
                {playerData.profileUrl ? (
                  <a href={playerData.profileUrl} target="_blank" rel="noreferrer">
                    Open profile
                  </a>
                ) : null}
                {playerData.isPriorityPlayer ? (
                  <p>This player is part of your priority set, so the app can keep a much deeper local match history for them.</p>
                ) : (
                  <p>Add this player to favorites if you want the app to keep a deeper local history instead of just the shallow recent snapshot.</p>
                )}
                <p>{playerData.autoRefreshOnOpen ? "This player refreshes from upstream each time you open the profile." : "Enable refresh on open if you want this profile to pull fresh data every time it is opened."}</p>
                <Link className="inline-link-chip" to={`/compare?ids=${playerData.playerId}`}>
                  Compare this player
                </Link>
                {saveSettings.isError ? <p className="form-error">{(saveSettings.error as Error).message}</p> : null}
                {saveSettings.isSuccess ? <p className="form-success">Favorite players updated locally.</p> : null}
                {syncHistory.isError ? <p className="form-error">{(syncHistory.error as Error).message}</p> : null}
                {syncHistory.isSuccess ? <p className="form-success">Deeper player history synced locally.</p> : null}
              </div>
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
                  <p className="muted-inline">
                    Bigger bubbles mean more matches on that day. Win-favored days use the positive color, loss-favored days use the negative color, and gray means even.
                  </p>
                </div>
              )}
            </Card>
          </div>

          <div className="two-column">
            <TableCard
              title="Hero usage"
              rowCount={pagedHeroUsage.length}
              totalItems={playerData.heroUsage.length}
              page={heroUsagePagination.page}
              totalPages={heroUsagePagination.totalPages}
              pageSize={heroUsagePagination.pageSize}
              pageSizeOptions={heroUsagePagination.pageSizeOptions}
              onPreviousPage={heroUsagePagination.previousPage}
              onNextPage={heroUsagePagination.nextPage}
              onPageSizeChange={heroUsagePagination.setPageSize}
              empty={<EmptyState label="No locally stored hero usage for the active match scope yet." />}
            >
              {playerData.heroUsage.length === 0 ? (
                <EmptyState label="No locally stored hero usage for the active match scope yet." />
              ) : (
                <div className="stack compact">
                  <p className="muted-inline">Scope: {playerData.matchScopeLabel}</p>
                  {pagedHeroUsage.map((hero) => (
                    <div key={hero.heroId} className="hero-bar-row">
                      <div className="entity-link">
                        <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                        <span>{hero.heroName}</span>
                      </div>
                      <div className="hero-bar-track">
                        <div
                          className="hero-bar-fill"
                          style={{ width: `${Math.max(8, (hero.games / playerData.heroUsage[0].games) * 100)}%` }}
                        />
                      </div>
                      <strong>{hero.games}</strong>
                      <span className="muted-inline">{hero.winrate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </TableCard>

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
          </div>

          <Card title="History filters">
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
                    <span className="entity-link">
                      <IconImage src={match.heroIconUrl} alt={match.heroName ?? "Hero"} size="sm" />
                      <span>{match.heroName ?? match.heroId ?? "Unknown"}</span>
                    </span>
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
    </Page>
  );
}
