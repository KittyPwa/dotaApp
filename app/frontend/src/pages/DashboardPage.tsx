import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { useDashboard } from "../hooks/useQueries";
import { usePagination } from "../hooks/usePagination";

function formatRank(rankTier: number | null, leaderboardRank: number | null) {
  if (!rankTier) return "Unknown";
  const medal = Math.floor(rankTier / 10);
  const stars = rankTier % 10;
  const medalNames = ["Unranked", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
  const medalName = medalNames[medal] ?? `Tier ${rankTier}`;
  if (leaderboardRank) return `${medalName} (#${leaderboardRank})`;
  return stars > 0 ? `${medalName} ${stars}` : medalName;
}

export function DashboardPage() {
  const query = useDashboard();
  const [mostPlayedSort, setMostPlayedSort] = useState<{ key: "hero" | "games"; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [bestWinrateSort, setBestWinrateSort] = useState<{ key: "hero" | "games" | "winrate"; direction: "asc" | "desc" }>({
    key: "winrate",
    direction: "desc"
  });
  const sortedMostPlayed = useMemo(() => {
    const rows = [...(query.data?.mostPlayedHeroes ?? [])];
    rows.sort((left, right) => {
      const compare =
        mostPlayedSort.key === "hero"
          ? left.heroName.localeCompare(right.heroName)
          : left.games - right.games;
      return mostPlayedSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [query.data?.mostPlayedHeroes, mostPlayedSort]);
  const sortedBestWinrate = useMemo(() => {
    const rows = [...(query.data?.highestWinrateHeroes ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (bestWinrateSort.key) {
        case "hero":
          compare = left.heroName.localeCompare(right.heroName);
          break;
        case "games":
          compare = left.games - right.games;
          break;
        case "winrate":
        default:
          compare = left.winrate - right.winrate;
          break;
      }
      return bestWinrateSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [bestWinrateSort, query.data?.highestWinrateHeroes]);
  const mostPlayedPagination = usePagination(sortedMostPlayed.length, 10, [10, 20, 50]);
  const bestWinratePagination = usePagination(sortedBestWinrate.length, 10, [10, 20, 50]);
  const pagedMostPlayed = mostPlayedPagination.paged(sortedMostPlayed);
  const pagedBestWinrate = bestWinratePagination.paged(sortedBestWinrate);

  return (
    <Page
      title="Dashboard"
      subtitle="Your local Dota workspace, centered on your player and the people you care about first."
    >
      {query.isLoading ? <LoadingState label="Loading dashboard..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Stored matches", value: query.data.totalStoredMatches },
              { label: "Your player", value: query.data.primaryPlayerId ?? "Not set" },
              { label: "Favorite players", value: query.data.favoritePlayerIds.length }
            ]}
          />

          <Card title="Priority players">
            {query.data.focusedPlayers.length === 0 ? (
              <p>
                Set your player ID and favorite player IDs in <Link to="/settings">Settings</Link>. The dashboard will
                refresh those players first and keep them front and center.
              </p>
            ) : (
              <div className="roster-list">
                {query.data.focusedPlayers.map((player) => (
                  <div key={player.playerId} className="player-panel">
                    <div className="player-panel-header">
                      <div className="entity-link">
                        <img
                          className="avatar"
                          src={player.avatar ?? undefined}
                          alt={player.personaname ?? String(player.playerId)}
                        />
                        <div className="stack compact">
                          <strong>
                            <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                          </strong>
                          <span>
                            {query.data.primaryPlayerId === player.playerId ? "Your player" : "Favorite player"} ·{" "}
                            {player.source === "fresh" ? "fresh sync" : "cache"}
                          </span>
                        </div>
                      </div>
                      <div className="player-panel-kda">
                        <strong>
                          {player.wins}W / {player.losses}L
                        </strong>
                        <span className="muted-inline">{formatRank(player.rankTier, player.leaderboardRank)}</span>
                        <span className="muted-inline">{player.totalStoredMatches} stored matches</span>
                      </div>
                    </div>

                    <div className="player-metrics">
                      <div>
                        <span className="eyebrow">Top heroes</span>
                        <strong>
                          {player.topHeroes.length > 0
                            ? player.topHeroes.map((hero) => `${hero.heroName} (${hero.games})`).join(", ")
                            : "No local hero data yet"}
                        </strong>
                      </div>
                      <div>
                        <span className="eyebrow">Recent matches</span>
                        <strong>
                          {player.recentMatches.length > 0
                            ? player.recentMatches.map((match) => `#${match.matchId}`).join(", ")
                            : "No local matches yet"}
                        </strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="two-column">
            <TableCard
              title="Most played heroes in your local data"
              rowCount={pagedMostPlayed.length}
              totalItems={sortedMostPlayed.length}
              page={mostPlayedPagination.page}
              totalPages={mostPlayedPagination.totalPages}
              pageSize={mostPlayedPagination.pageSize}
              pageSizeOptions={mostPlayedPagination.pageSizeOptions}
              onPreviousPage={mostPlayedPagination.previousPage}
              onNextPage={mostPlayedPagination.nextPage}
              onPageSizeChange={mostPlayedPagination.setPageSize}
            >
              <DataTable
                rows={pagedMostPlayed}
                getRowKey={(hero) => String(hero.heroId)}
                sortState={mostPlayedSort}
                onSortChange={(key) =>
                  setMostPlayedSort((current) => ({
                    key: key as "hero" | "games",
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "hero",
                    header: "Hero",
                    sortable: true,
                    cell: (hero) => <Link to={`/heroes/${hero.heroId}`}>{hero.heroName}</Link>
                  },
                  { key: "games", header: "Games", sortable: true, cell: (hero) => hero.games }
                ]}
              />
            </TableCard>

            <TableCard
              title="Best local winrates"
              rowCount={pagedBestWinrate.length}
              totalItems={sortedBestWinrate.length}
              page={bestWinratePagination.page}
              totalPages={bestWinratePagination.totalPages}
              pageSize={bestWinratePagination.pageSize}
              pageSizeOptions={bestWinratePagination.pageSizeOptions}
              onPreviousPage={bestWinratePagination.previousPage}
              onNextPage={bestWinratePagination.nextPage}
              onPageSizeChange={bestWinratePagination.setPageSize}
            >
              <DataTable
                rows={pagedBestWinrate}
                getRowKey={(hero) => String(hero.heroId)}
                sortState={bestWinrateSort}
                onSortChange={(key) =>
                  setBestWinrateSort((current) => ({
                    key: key as "hero" | "games" | "winrate",
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "hero",
                    header: "Hero",
                    sortable: true,
                    cell: (hero) => <Link to={`/heroes/${hero.heroId}`}>{hero.heroName}</Link>
                  },
                  { key: "games", header: "Games", sortable: true, cell: (hero) => hero.games },
                  { key: "winrate", header: "Winrate", sortable: true, cell: (hero) => `${hero.winrate}%` }
                ]}
              />
            </TableCard>
          </div>
        </>
      ) : null}
    </Page>
  );
}
