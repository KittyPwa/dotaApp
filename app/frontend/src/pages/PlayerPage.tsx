import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePlayer, useSaveSettings, useSettings, useSyncPlayerHistory } from "../hooks/useQueries";
import { formatDate, formatDuration } from "../lib/format";

type SortKey = "startTime" | "durationSeconds" | "heroName" | "kda" | "result";
type ResultFilter = "all" | "wins" | "losses";

function calculateKda(kills: number | null, deaths: number | null, assists: number | null) {
  const total = (kills ?? 0) + (assists ?? 0);
  const safeDeaths = Math.max(deaths ?? 0, 1);
  return total / safeDeaths;
}

function getSortIndicator(active: boolean, direction: "asc" | "desc") {
  if (!active) return "";
  return direction === "asc" ? " ^" : " v";
}

function formatDayKey(timestamp: number | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function PlayerPage() {
  const params = useParams();
  const playerId = params.playerId ? Number(params.playerId) : null;
  const query = usePlayer(Number.isFinite(playerId) ? playerId : null);
  const settingsQuery = useSettings();
  const saveSettings = useSaveSettings();
  const syncHistory = useSyncPlayerHistory(Number.isFinite(playerId) ? playerId : null);
  const favoritePlayerIds = settingsQuery.data?.favoritePlayerIds ?? [];
  const isFavorite = playerId !== null && favoritePlayerIds.includes(playerId);

  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
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
      case "startTime":
      default:
        compare = (left.startTime ?? 0) - (right.startTime ?? 0);
        break;
    }

    return sortDirection === "asc" ? compare : -compare;
  });

  const totalPages = Math.max(1, Math.ceil(sortedMatches.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedMatches = sortedMatches.slice((currentPage - 1) * pageSize, currentPage * pageSize);

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
              { label: "Stored matches", value: playerData.totalStoredMatches },
              { label: "Win / loss", value: `${playerData.wins} / ${playerData.losses}` },
              { label: "Favorite", value: isFavorite ? "Yes" : "No" },
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
                    Bigger bubbles mean more matches on that day. Green means more wins, red more losses, gray means even.
                  </p>
                </div>
              )}
            </Card>
          </div>

          <div className="two-column">
            <Card title="Hero usage">
              {playerData.heroUsage.length === 0 ? (
                <EmptyState label="No locally stored hero usage yet." />
              ) : (
                <div className="stack compact">
                  {playerData.heroUsage.slice(0, 8).map((hero) => (
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
            </Card>

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
                Show
                <select
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value));
                    setPage(1);
                  }}
                >
                  <option value={20}>20 matches</option>
                  <option value={50}>50 matches</option>
                </select>
              </label>
              <label>
                Result
                <select
                  value={resultFilter}
                  onChange={(event) => {
                    setResultFilter(event.target.value as ResultFilter);
                    setPage(1);
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
            page={currentPage}
            totalPages={totalPages}
            onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
            onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
            empty={<EmptyState label="No matches stored for this filter yet." />}
          >
            <table className="player-history-table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => toggleSort("startTime")}>
                      Date{getSortIndicator(sortKey === "startTime", sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => toggleSort("heroName")}>
                      Hero{getSortIndicator(sortKey === "heroName", sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => toggleSort("kda")}>
                      KDA{getSortIndicator(sortKey === "kda", sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => toggleSort("durationSeconds")}>
                      Duration{getSortIndicator(sortKey === "durationSeconds", sortDirection)}
                    </button>
                  </th>
                  <th>
                    <button type="button" className="table-sort-button" onClick={() => toggleSort("result")}>
                      Result{getSortIndicator(sortKey === "result", sortDirection)}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedMatches.map((match) => (
                  <tr
                    key={match.matchId}
                    className={match.win === true ? "row-win" : match.win === false ? "row-loss" : "row-unknown"}
                  >
                    <td>
                      <Link to={`/matches/${match.matchId}`}>{match.matchId}</Link>
                    </td>
                    <td>{formatDate(match.startTime)}</td>
                    <td>
                      <span className="entity-link">
                        <IconImage src={match.heroIconUrl} alt={match.heroName ?? "Hero"} size="sm" />
                        <span>{match.heroName ?? match.heroId ?? "Unknown"}</span>
                      </span>
                    </td>
                    <td>
                      {match.kills ?? 0}/{match.deaths ?? 0}/{match.assists ?? 0}
                    </td>
                    <td>{formatDuration(match.durationSeconds)}</td>
                    <td>{match.win === null ? "Unknown" : match.win ? "Win" : "Loss"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
