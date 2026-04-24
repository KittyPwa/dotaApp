import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { StatsRadarChart } from "../components/StatsRadarChart";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { useLeagueTeam } from "../hooks/useQueries";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

type TeamTab = "players" | "heroes" | "matches";
type PlayerSortKey = "player" | "games" | "wins" | "losses" | "winrate" | "heroes";
type HeroSortKey = "hero" | "games" | "wins" | "losses" | "winrate";
type MatchSortKey = "match" | "date" | "duration" | "result" | "opponent" | "patch" | "parsedData";

export function LeagueTeamPage() {
  const params = useParams();
  const leagueId = params.leagueId ? Number(params.leagueId) : null;
  const teamId = params.teamId ? Number(params.teamId) : null;
  const query = useLeagueTeam(Number.isFinite(leagueId) ? leagueId : null, Number.isFinite(teamId) ? teamId : null);
  const [activeTab, setActiveTab] = useState<TeamTab>("players");
  const [hiddenRadarPlayerIds, setHiddenRadarPlayerIds] = useState<number[]>([]);
  const [playerSearch, setPlayerSearch] = useState("");
  const [heroSearch, setHeroSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [playerSort, setPlayerSort] = useState<{ key: PlayerSortKey; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [heroSort, setHeroSort] = useState<{ key: HeroSortKey; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [matchSort, setMatchSort] = useState<{ key: MatchSortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
  });

  const radarPlayers = useMemo(
    () =>
      (query.data?.players ?? [])
        .filter((player) => player.playerId !== null && player.comparisonStats.length >= 3)
        .map((player) => ({
          playerId: player.playerId as number,
          personaname: player.personaname,
          comparisonStats: player.comparisonStats
        })),
    [query.data?.players]
  );

  const sortedPlayers = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    const rows = [...(query.data?.players ?? [])].filter((player) =>
      !needle ? true : (player.personaname ?? `Player ${player.playerId ?? "Anonymous"}`).toLowerCase().includes(needle)
    );
    rows.sort((left, right) => {
      let compare = 0;
      switch (playerSort.key) {
        case "player":
          compare = (left.personaname ?? `Player ${left.playerId ?? "Anonymous"}`).localeCompare(
            right.personaname ?? `Player ${right.playerId ?? "Anonymous"}`
          );
          break;
        case "wins":
          compare = left.wins - right.wins;
          break;
        case "losses":
          compare = left.losses - right.losses;
          break;
        case "winrate":
          compare = left.winrate - right.winrate;
          break;
        case "heroes":
          compare = left.uniqueHeroes - right.uniqueHeroes;
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return playerSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [playerSearch, playerSort, query.data?.players]);

  const sortedHeroes = useMemo(() => {
    const needle = heroSearch.trim().toLowerCase();
    const rows = [...(query.data?.topHeroes ?? [])].filter((hero) =>
      !needle ? true : hero.heroName.toLowerCase().includes(needle)
    );
    rows.sort((left, right) => {
      let compare = 0;
      switch (heroSort.key) {
        case "hero":
          compare = left.heroName.localeCompare(right.heroName);
          break;
        case "wins":
          compare = left.wins - right.wins;
          break;
        case "losses":
          compare = left.losses - right.losses;
          break;
        case "winrate":
          compare = left.winrate - right.winrate;
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return heroSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [heroSearch, heroSort, query.data?.topHeroes]);

  const sortedMatches = useMemo(() => {
    const needle = matchSearch.trim().toLowerCase();
    const rows = [...(query.data?.matches ?? [])].filter((match) =>
      !needle
        ? true
        : String(match.matchId).includes(needle) ||
          (match.opponentName ?? "").toLowerCase().includes(needle) ||
          (match.patch ?? "").toLowerCase().includes(needle)
    );
    rows.sort((left, right) => {
      let compare = 0;
      switch (matchSort.key) {
        case "match":
          compare = left.matchId - right.matchId;
          break;
        case "duration":
          compare = (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
          break;
        case "result":
          compare = Number(left.teamWin ?? false) - Number(right.teamWin ?? false);
          break;
        case "opponent":
          compare = (left.opponentName ?? "").localeCompare(right.opponentName ?? "");
          break;
        case "patch":
          compare = (left.patch ?? "").localeCompare(right.patch ?? "");
          break;
        case "parsedData":
          compare = left.parsedData.label.localeCompare(right.parsedData.label);
          break;
        case "date":
        default:
          compare = (left.startTime ?? 0) - (right.startTime ?? 0);
          break;
      }
      return matchSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [matchSearch, matchSort, query.data?.matches]);

  const playerPagination = usePagination(sortedPlayers.length, 20, [20, 50, 100]);
  const heroPagination = usePagination(sortedHeroes.length, 20, [20, 50, 100]);
  const matchPagination = usePagination(sortedMatches.length, 20, [20, 50, 100]);
  const pagedPlayers = playerPagination.paged(sortedPlayers);
  const pagedHeroes = heroPagination.paged(sortedHeroes);
  const pagedMatches = matchPagination.paged(sortedMatches);

  return (
    <Page
      title={query.data ? `${query.data.name}${query.data.tag ? ` (${query.data.tag})` : ""}` : `Team ${params.teamId ?? ""}`}
      subtitle={
        query.data ? (
          <span>
            League scope: <Link to={`/leagues/${query.data.leagueId}`}>{query.data.leagueName}</Link>
          </span>
        ) : undefined
      }
    >
      {query.isLoading ? <LoadingState label="Loading team..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Matches", value: formatNumber(query.data.games) },
              { label: "Wins", value: formatNumber(query.data.wins) },
              { label: "Losses", value: formatNumber(query.data.losses) },
              { label: "Win %", value: `${query.data.winrate}%` },
              { label: "Players", value: formatNumber(query.data.uniquePlayers) },
              { label: "Heroes", value: formatNumber(query.data.uniqueHeroes) },
              { label: "First match", value: formatDate(query.data.firstMatchTime) },
              { label: "Latest match", value: formatDate(query.data.lastMatchTime) }
            ]}
          />

          <div className="two-column compare-summary-grid">
            <Card title="Roster radar">
              {radarPlayers.length > 0 ? (
                <StatsRadarChart
                  players={radarPlayers}
                  compact
                  hiddenPlayerIds={hiddenRadarPlayerIds}
                  onTogglePlayer={(playerId) =>
                    setHiddenRadarPlayerIds((current) =>
                      current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]
                    )
                  }
                />
              ) : (
                <EmptyState label="Not enough player stat data to draw a team radar yet." />
              )}
            </Card>

            <Card title="Most played heroes">
              {query.data.topHeroes.length > 0 ? (
                <div className="stack compact">
                  {query.data.topHeroes.slice(0, 8).map((hero) => (
                    <Link key={hero.heroId} className="entity-link" to={`/heroes/${hero.heroId}?leagueId=${query.data?.leagueId}`}>
                      <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                      <span>
                        {hero.heroName} ({hero.games}, {hero.winrate}%)
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState label="No hero data stored for this team yet." />
              )}
            </Card>
          </div>

          <div className="settings-tabs" role="tablist" aria-label="Team sections">
            {[
              ["players", "Players"],
              ["heroes", "Heroes"],
              ["matches", "Matches"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`settings-tab ${activeTab === key ? "active" : ""}`}
                onClick={() => setActiveTab(key as TeamTab)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "players" ? (
            <TableCard
              title="Players"
              rowCount={pagedPlayers.length}
              totalItems={sortedPlayers.length}
              page={playerPagination.page}
              totalPages={playerPagination.totalPages}
              pageSize={playerPagination.pageSize}
              pageSizeOptions={playerPagination.pageSizeOptions}
              onPreviousPage={playerPagination.previousPage}
              onNextPage={playerPagination.nextPage}
              onPageSizeChange={playerPagination.setPageSize}
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={playerSearch}
                      onChange={(event) => {
                        setPlayerSearch(event.target.value);
                        playerPagination.resetPage();
                      }}
                      placeholder="Player"
                    />
                  </label>
                </div>
              }
              empty={<EmptyState label="No player data stored for this team yet." />}
            >
              <DataTable
                rows={pagedPlayers}
                getRowKey={(player, index) => `${player.playerId ?? "anon"}-${index}`}
                sortState={playerSort}
                onSortChange={(key) =>
                  setPlayerSort((current) => ({
                    key: key as PlayerSortKey,
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "player",
                    header: "Player",
                    sortable: true,
                    cell: (player) =>
                      player.playerId ? (
                        <Link className="entity-link" to={`/players/${player.playerId}?leagueId=${query.data.leagueId}`}>
                          {player.avatar ? <img className="avatar avatar-sm" src={player.avatar} alt={player.personaname ?? String(player.playerId)} /> : null}
                          <span>{player.personaname ?? player.playerId}</span>
                        </Link>
                      ) : (
                        player.personaname ?? "Anonymous"
                      )
                  },
                  { key: "games", header: "Games", sortable: true, cell: (player) => formatNumber(player.games) },
                  { key: "wins", header: "Wins", sortable: true, cell: (player) => formatNumber(player.wins) },
                  { key: "losses", header: "Losses", sortable: true, cell: (player) => formatNumber(player.losses) },
                  { key: "winrate", header: "Win %", sortable: true, cell: (player) => `${player.winrate}%` },
                  { key: "heroes", header: "Heroes", sortable: true, cell: (player) => formatNumber(player.uniqueHeroes) }
                ]}
              />
            </TableCard>
          ) : null}

          {activeTab === "heroes" ? (
            <TableCard
              title="Heroes"
              rowCount={pagedHeroes.length}
              totalItems={sortedHeroes.length}
              page={heroPagination.page}
              totalPages={heroPagination.totalPages}
              pageSize={heroPagination.pageSize}
              pageSizeOptions={heroPagination.pageSizeOptions}
              onPreviousPage={heroPagination.previousPage}
              onNextPage={heroPagination.nextPage}
              onPageSizeChange={heroPagination.setPageSize}
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={heroSearch}
                      onChange={(event) => {
                        setHeroSearch(event.target.value);
                        heroPagination.resetPage();
                      }}
                      placeholder="Hero"
                    />
                  </label>
                </div>
              }
              empty={<EmptyState label="No hero data stored for this team yet." />}
            >
              <DataTable
                rows={pagedHeroes}
                getRowKey={(hero) => String(hero.heroId)}
                sortState={heroSort}
                onSortChange={(key) =>
                  setHeroSort((current) => ({
                    key: key as HeroSortKey,
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "hero",
                    header: "Hero",
                    sortable: true,
                    cell: (hero) => (
                      <Link className="entity-link" to={`/heroes/${hero.heroId}?leagueId=${query.data.leagueId}`}>
                        <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                        <span>{hero.heroName}</span>
                      </Link>
                    )
                  },
                  { key: "games", header: "Games", sortable: true, cell: (hero) => formatNumber(hero.games) },
                  { key: "wins", header: "Wins", sortable: true, cell: (hero) => formatNumber(hero.wins) },
                  { key: "losses", header: "Losses", sortable: true, cell: (hero) => formatNumber(hero.losses) },
                  { key: "winrate", header: "Win %", sortable: true, cell: (hero) => `${hero.winrate}%` }
                ]}
              />
            </TableCard>
          ) : null}

          {activeTab === "matches" ? (
            <TableCard
              title="Team matches"
              rowCount={pagedMatches.length}
              totalItems={sortedMatches.length}
              page={matchPagination.page}
              totalPages={matchPagination.totalPages}
              pageSize={matchPagination.pageSize}
              pageSizeOptions={matchPagination.pageSizeOptions}
              onPreviousPage={matchPagination.previousPage}
              onNextPage={matchPagination.nextPage}
              onPageSizeChange={matchPagination.setPageSize}
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={matchSearch}
                      onChange={(event) => {
                        setMatchSearch(event.target.value);
                        matchPagination.resetPage();
                      }}
                      placeholder="Match, opponent, patch"
                    />
                  </label>
                </div>
              }
              empty={<EmptyState label="No matches stored for this team yet." />}
            >
              <DataTable
                rows={pagedMatches}
                getRowKey={(match) => String(match.matchId)}
                rowClassName={(match) =>
                  match.teamWin === true ? "row-win" : match.teamWin === false ? "row-loss" : "row-unknown"
                }
                sortState={matchSort}
                onSortChange={(key) =>
                  setMatchSort((current) => ({
                    key: key as MatchSortKey,
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "match",
                    header: "Match",
                    sortable: true,
                    cell: (match) => <Link to={`/matches/${match.matchId}`}>{match.matchId}</Link>
                  },
                  { key: "date", header: "Date", sortable: true, cell: (match) => formatDate(match.startTime) },
                  { key: "duration", header: "Duration", sortable: true, cell: (match) => formatDuration(match.durationSeconds) },
                  {
                    key: "result",
                    header: "Result",
                    sortable: true,
                    cell: (match) => (match.teamWin === true ? "Win" : match.teamWin === false ? "Loss" : "Unknown")
                  },
                  { key: "opponent", header: "Opponent", sortable: true, cell: (match) => match.opponentName ?? "Unknown" },
                  {
                    key: "score",
                    header: "Score",
                    cell: (match) => `${formatNumber(match.teamScore)} - ${formatNumber(match.opponentScore)}`
                  },
                  { key: "patch", header: "Patch", sortable: true, cell: (match) => match.patch ?? "Unknown" },
                  { key: "parsedData", header: "Parsed data", sortable: true, cell: (match) => match.parsedData.label }
                ]}
              />
            </TableCard>
          ) : null}
        </>
      ) : null}
    </Page>
  );
}
