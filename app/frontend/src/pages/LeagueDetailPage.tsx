import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { useLeague, useSyncLeague } from "../hooks/useQueries";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

type MatchSortKey = "match" | "start" | "duration" | "outcome" | "score" | "patch" | "parsedData";
type HeroSortKey = "hero" | "games" | "wins" | "losses" | "winrate" | "players";
type PlayerSortKey = "player" | "games" | "wins" | "losses" | "winrate" | "heroes";
type ItemSortKey = "item" | "games" | "wins" | "losses" | "winrate";

function ParsedDataPill({ label }: { label: string }) {
  return <span className={`parsed-data-pill ${label === "Full" ? "rich" : "basic"}`}>{label}</span>;
}

export function LeagueDetailPage() {
  const params = useParams();
  const leagueId = params.leagueId ? Number(params.leagueId) : null;
  const query = useLeague(Number.isFinite(leagueId) ? leagueId : null);
  const syncLeague = useSyncLeague(Number.isFinite(leagueId) ? leagueId : null);
  const [syncLimit, setSyncLimit] = useState("25");
  const [matchSort, setMatchSort] = useState<{ key: MatchSortKey; direction: "asc" | "desc" }>({
    key: "start",
    direction: "desc"
  });
  const [heroSort, setHeroSort] = useState<{ key: HeroSortKey; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [playerSort, setPlayerSort] = useState<{ key: PlayerSortKey; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [itemSort, setItemSort] = useState<{ key: ItemSortKey; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [selectedHeroId, setSelectedHeroId] = useState<number | null>(null);
  const [showSparseItems, setShowSparseItems] = useState(false);

  function toggleSort<T extends string>(key: T, setter: Dispatch<SetStateAction<{ key: T; direction: "asc" | "desc" }>>) {
    setter((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
    }));
  }

  const sortedHeroes = useMemo(() => {
    const rows = [...(query.data?.heroes ?? [])];
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
        case "players":
          compare = left.uniquePlayers - right.uniquePlayers;
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return heroSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [heroSort, query.data?.heroes]);

  const sortedPlayers = useMemo(() => {
    const rows = [...(query.data?.players ?? [])];
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
  }, [playerSort, query.data?.players]);

  const sortedItems = useMemo(() => {
    const rows = [...(query.data?.items ?? [])].filter((item) => showSparseItems || item.games >= 10);
    rows.sort((left, right) => {
      let compare = 0;
      switch (itemSort.key) {
        case "item":
          compare = left.itemName.localeCompare(right.itemName);
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
      return itemSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [itemSort, query.data?.items, showSparseItems]);

  const selectedHero = useMemo(
    () => query.data?.heroes.find((hero) => hero.heroId === selectedHeroId) ?? null,
    [query.data?.heroes, selectedHeroId]
  );

  const derivedHeroPlayers = useMemo(() => {
    const playerMap = new Map<
      string,
      {
        heroId: number;
        playerId: number | null;
        personaname: string | null;
        games: number;
        wins: number;
        losses: number;
        winrate: number;
      }
    >();

    for (const row of query.data?.matchPlayers ?? []) {
      const key = `${row.heroId}-${row.playerId ?? `anon-${row.personaname ?? "unknown"}`}`;
      const current =
        playerMap.get(key) ??
        {
          heroId: row.heroId,
          playerId: row.playerId,
          personaname: row.personaname,
          games: 0,
          wins: 0,
          losses: 0,
          winrate: 0
        };
      current.games += 1;
      if (row.win === true) current.wins += 1;
      if (row.win === false) current.losses += 1;
      current.winrate = current.games ? Number(((current.wins / current.games) * 100).toFixed(1)) : 0;
      playerMap.set(key, current);
    }

    return [...playerMap.values()];
  }, [query.data?.matchPlayers]);

  const selectedHeroPlayers = useMemo(() => {
    const sourceRows = query.data?.heroPlayers?.length ? query.data.heroPlayers : derivedHeroPlayers;
    const rows = [...sourceRows].filter((player) => player.heroId === selectedHeroId);
    rows.sort((left, right) => right.games - left.games || right.winrate - left.winrate);
    return rows;
  }, [derivedHeroPlayers, query.data?.heroPlayers, selectedHeroId]);

  const sortedMatches = useMemo(() => {
    const rows = [...(query.data?.matches ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (matchSort.key) {
        case "match":
          compare = left.matchId - right.matchId;
          break;
        case "duration":
          compare = (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
          break;
        case "outcome":
          compare = Number(left.radiantWin ?? false) - Number(right.radiantWin ?? false);
          break;
        case "score":
          compare = ((left.radiantScore ?? 0) + (left.direScore ?? 0)) - ((right.radiantScore ?? 0) + (right.direScore ?? 0));
          break;
        case "patch":
          compare = (left.patch ?? "").localeCompare(right.patch ?? "");
          break;
        case "parsedData":
          compare = left.parsedData.label.localeCompare(right.parsedData.label);
          break;
        case "start":
        default:
          compare = (left.startTime ?? 0) - (right.startTime ?? 0);
          break;
      }
      return matchSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [matchSort, query.data?.matches]);

  const matchPagination = usePagination(sortedMatches.length, 20, [20, 50, 100]);
  const pagedMatches = matchPagination.paged(sortedMatches);
  const heroPagination = usePagination(sortedHeroes.length, 20, [20, 50, 100]);
  const pagedHeroes = heroPagination.paged(sortedHeroes);
  const playerPagination = usePagination(sortedPlayers.length, 20, [20, 50, 100]);
  const pagedPlayers = playerPagination.paged(sortedPlayers);
  const itemPagination = usePagination(sortedItems.length, 20, [20, 50, 100]);
  const pagedItems = itemPagination.paged(sortedItems);
  const sparseItemCount = (query.data?.items ?? []).filter((item) => item.games < 10).length;
  const heroPlayerPagination = usePagination(selectedHeroPlayers.length, 20, [20, 50, 100]);
  const pagedHeroPlayers = heroPlayerPagination.paged(selectedHeroPlayers);

  return (
    <Page
      title={query.data?.name ?? `League ${params.leagueId ?? ""}`}
      aside={
        Number.isFinite(leagueId) ? (
          <div className="action-group">
            <label className="compact-label">
              Fetch
              <input
                type="number"
                min={1}
                max={100}
                value={syncLimit}
                onChange={(event) => setSyncLimit(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={syncLeague.isPending}
              onClick={() => syncLeague.mutate(Math.min(100, Math.max(1, Number(syncLimit) || 25)))}
            >
              {syncLeague.isPending ? "Syncing..." : "Sync league matches"}
            </button>
          </div>
        ) : null
      }
    >
      {query.isLoading ? <LoadingState label="Loading league..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {syncLeague.error ? <ErrorState error={syncLeague.error as Error} /> : null}
      {syncLeague.data ? (
        <p className="success-inline">
          {syncLeague.data.requestedMatches === 0 && syncLeague.data.skippedMatches === 0
            ? "No provider returned match IDs for this league yet."
            : syncLeague.data.requestedMatches === 0
              ? `No new matches to fetch. ${formatNumber(syncLeague.data.skippedMatches)} provider matches were already stored locally.`
              : `League sync fetched ${formatNumber(syncLeague.data.fetchedMatches)} matches, skipped ${formatNumber(syncLeague.data.skippedMatches)}, failed ${formatNumber(syncLeague.data.failedMatches.length)}.`}
        </p>
      ) : null}
      {syncLeague.data?.providerMessages?.length ? (
        <Card title="Provider notes">
          <div className="stack compact">
            {syncLeague.data.providerMessages.map((message) => (
              <span key={message} className="muted-inline">
                {message}
              </span>
            ))}
          </div>
        </Card>
      ) : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Matches", value: formatNumber(query.data.matchCount) },
              { label: "Full parsed", value: formatNumber(query.data.parsedFullMatches) },
              { label: "Players", value: formatNumber(query.data.uniquePlayers) },
              { label: "Heroes", value: formatNumber(query.data.uniqueHeroes) },
              { label: "First match", value: formatDate(query.data.firstMatchTime) },
              { label: "Latest match", value: formatDate(query.data.lastMatchTime) }
            ]}
          />

          <div className="two-column">
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
              empty={<EmptyState label="No hero data stored for this league." />}
            >
              <DataTable
                rows={pagedHeroes}
                getRowKey={(hero) => String(hero.heroId)}
                sortState={heroSort}
                onSortChange={(key) => toggleSort(key as HeroSortKey, setHeroSort)}
                columns={[
                  {
                    key: "hero",
                    header: "Hero",
                    sortable: true,
                    cell: (hero) => (
                      <Link className="entity-link" to={`/heroes/${hero.heroId}`}>
                        <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                        <span>{hero.heroName}</span>
                      </Link>
                    )
                  },
                  { key: "games", header: "Games", sortable: true, cell: (hero) => formatNumber(hero.games) },
                  { key: "wins", header: "Wins", sortable: true, cell: (hero) => formatNumber(hero.wins) },
                  { key: "losses", header: "Losses", sortable: true, cell: (hero) => formatNumber(hero.losses) },
                  { key: "winrate", header: "Win %", sortable: true, cell: (hero) => `${hero.winrate}%` },
                  {
                    key: "players",
                    header: "Players",
                    sortable: true,
                    cell: (hero) => (
                      <button type="button" className="table-link-button" onClick={() => setSelectedHeroId(hero.heroId)}>
                        {formatNumber(hero.uniquePlayers)}
                      </button>
                    )
                  }
                ]}
              />
            </TableCard>

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
              empty={<EmptyState label="No player data stored for this league." />}
            >
              <DataTable
                rows={pagedPlayers}
                getRowKey={(player, index) => `${player.playerId ?? "anon"}-${index}`}
                sortState={playerSort}
                onSortChange={(key) => toggleSort(key as PlayerSortKey, setPlayerSort)}
                columns={[
                  {
                    key: "player",
                    header: "Player",
                    sortable: true,
                    cell: (player) =>
                      player.playerId ? (
                        <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
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
          </div>

          {selectedHero ? (
            <TableCard
              title={`Players on ${selectedHero.heroName}`}
              rowCount={pagedHeroPlayers.length}
              totalItems={selectedHeroPlayers.length}
              page={heroPlayerPagination.page}
              totalPages={heroPlayerPagination.totalPages}
              pageSize={heroPlayerPagination.pageSize}
              pageSizeOptions={heroPlayerPagination.pageSizeOptions}
              onPreviousPage={heroPlayerPagination.previousPage}
              onNextPage={heroPlayerPagination.nextPage}
              onPageSizeChange={heroPlayerPagination.setPageSize}
              extra={
                <button type="button" onClick={() => setSelectedHeroId(null)}>
                  Clear
                </button>
              }
              empty={<EmptyState label="No player data stored for this hero in this league." />}
            >
              <DataTable
                rows={pagedHeroPlayers}
                getRowKey={(player, index) => `${player.heroId}-${player.playerId ?? "anon"}-${index}`}
                columns={[
                  {
                    key: "player",
                    header: "Player",
                    cell: (player) =>
                      player.playerId ? (
                        <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                      ) : (
                        player.personaname ?? "Anonymous"
                      )
                  },
                  { key: "games", header: "Games", cell: (player) => formatNumber(player.games) },
                  { key: "wins", header: "Wins", cell: (player) => formatNumber(player.wins) },
                  { key: "losses", header: "Losses", cell: (player) => formatNumber(player.losses) },
                  { key: "winrate", header: "Win %", cell: (player) => `${player.winrate}%` }
                ]}
              />
            </TableCard>
          ) : null}

          <TableCard
            title="Items over 1500 gold"
            rowCount={pagedItems.length}
            totalItems={sortedItems.length}
            page={itemPagination.page}
            totalPages={itemPagination.totalPages}
            pageSize={itemPagination.pageSize}
            pageSizeOptions={itemPagination.pageSizeOptions}
            onPreviousPage={itemPagination.previousPage}
            onNextPage={itemPagination.nextPage}
            onPageSizeChange={itemPagination.setPageSize}
            extra={
              sparseItemCount > 0 ? (
                <button type="button" onClick={() => setShowSparseItems((current) => !current)}>
                  {showSparseItems ? "Hide <10 games" : `Show ${formatNumber(sparseItemCount)} rare items`}
                </button>
              ) : null
            }
            empty={<EmptyState label="No qualifying item data stored for this league." />}
          >
            <DataTable
              rows={pagedItems}
              getRowKey={(item) => String(item.itemId)}
              sortState={itemSort}
              onSortChange={(key) => toggleSort(key as ItemSortKey, setItemSort)}
              columns={[
                {
                  key: "item",
                  header: "Item",
                  sortable: true,
                  cell: (item) => (
                    <span className="entity-link">
                      <IconImage src={item.imageUrl} alt={item.itemName} size="sm" />
                      <span>{item.itemName}</span>
                    </span>
                  )
                },
                { key: "games", header: "Games", sortable: true, cell: (item) => formatNumber(item.games) },
                { key: "wins", header: "Wins", sortable: true, cell: (item) => formatNumber(item.wins) },
                { key: "losses", header: "Losses", sortable: true, cell: (item) => formatNumber(item.losses) },
                { key: "winrate", header: "Win %", sortable: true, cell: (item) => `${item.winrate}%` }
              ]}
            />
          </TableCard>

          <TableCard
            title="League matches"
            rowCount={pagedMatches.length}
            totalItems={sortedMatches.length}
            page={matchPagination.page}
            totalPages={matchPagination.totalPages}
            pageSize={matchPagination.pageSize}
            pageSizeOptions={matchPagination.pageSizeOptions}
            onPreviousPage={matchPagination.previousPage}
            onNextPage={matchPagination.nextPage}
            onPageSizeChange={matchPagination.setPageSize}
            empty={<EmptyState label="No locally stored matches found for this league." />}
          >
            <DataTable
              rows={pagedMatches}
              getRowKey={(match) => String(match.matchId)}
              rowClassName={(match) =>
                match.radiantWin === null ? "row-unknown" : match.radiantWin ? "league-row-radiant" : "league-row-dire"
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
                { key: "start", header: "Start", sortable: true, cell: (match) => formatDate(match.startTime) },
                { key: "duration", header: "Duration", sortable: true, cell: (match) => formatDuration(match.durationSeconds) },
                {
                  key: "outcome",
                  header: "Outcome",
                  sortable: true,
                  cell: (match) => (
                    <span className={`outcome-pill ${match.radiantWin === null ? "unknown" : match.radiantWin ? "radiant" : "dire"}`}>
                      {match.radiantWin === null ? "Unknown" : match.radiantWin ? "Radiant" : "Dire"}
                    </span>
                  )
                },
                {
                  key: "score",
                  header: "Score",
                  sortable: true,
                  cell: (match) => `${formatNumber(match.radiantScore)} - ${formatNumber(match.direScore)}`
                },
                { key: "patch", header: "Patch", sortable: true, cell: (match) => match.patch ?? "Unknown" },
                {
                  key: "parsedData",
                  header: "Parsed data",
                  sortable: true,
                  cell: (match) => <ParsedDataPill label={match.parsedData.label} />
                }
              ]}
            />
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
