import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { useHero } from "../hooks/useQueries";
import { usePagination } from "../hooks/usePagination";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

export function HeroDetailPage() {
  const params = useParams();
  const heroId = params.heroId ? Number(params.heroId) : null;
  const query = useHero(Number.isFinite(heroId) ? heroId : null);
  const [commonItemsSort, setCommonItemsSort] = useState<{ key: "item" | "usages" | "timing"; direction: "asc" | "desc" }>({
    key: "usages",
    direction: "desc"
  });
  const [playerUsageSort, setPlayerUsageSort] = useState<{ key: "player" | "games" | "wins" | "winrate"; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [recentMatchesSort, setRecentMatchesSort] = useState<{
    key: "match" | "start" | "duration" | "outcome" | "score" | "kills" | "patch" | "league" | "parsedData";
    direction: "asc" | "desc";
  }>({ key: "start", direction: "desc" });
  const sortedCommonItems = useMemo(() => {
    const rows = [...(query.data?.commonItems ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (commonItemsSort.key) {
        case "item":
          compare = left.itemName.localeCompare(right.itemName);
          break;
        case "timing":
          compare = (left.averageTimingSeconds ?? Number.MAX_SAFE_INTEGER) - (right.averageTimingSeconds ?? Number.MAX_SAFE_INTEGER);
          break;
        case "usages":
        default:
          compare = left.usages - right.usages;
          break;
      }
      return commonItemsSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [commonItemsSort, query.data?.commonItems]);
  const sortedPlayerUsage = useMemo(() => {
    const rows = [...(query.data?.playerUsage ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (playerUsageSort.key) {
        case "player":
          compare = (left.personaname ?? String(left.playerId ?? "")).localeCompare(right.personaname ?? String(right.playerId ?? ""));
          break;
        case "wins":
          compare = left.wins - right.wins;
          break;
        case "winrate":
          compare = left.winrate - right.winrate;
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return playerUsageSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [playerUsageSort, query.data?.playerUsage]);
  const sortedRecentMatches = useMemo(() => {
    const rows = [...(query.data?.recentMatches ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (recentMatchesSort.key) {
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
        case "kills":
          compare = (left.totalKills ?? 0) - (right.totalKills ?? 0);
          break;
        case "patch":
          compare = (left.patch ?? "").localeCompare(right.patch ?? "");
          break;
        case "league":
          compare = (left.league ?? "").localeCompare(right.league ?? "");
          break;
        case "parsedData":
          compare = left.parsedData.label.localeCompare(right.parsedData.label);
          break;
        case "start":
        default:
          compare = (left.startTime ?? 0) - (right.startTime ?? 0);
          break;
      }
      return recentMatchesSort.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [query.data?.recentMatches, recentMatchesSort]);
  const commonItemsPagination = usePagination(sortedCommonItems.length, 12, [12, 24, 48]);
  const playerUsagePagination = usePagination(sortedPlayerUsage.length, 20, [20, 50, 100]);
  const recentMatchesPagination = usePagination(sortedRecentMatches.length, 20, [20, 50, 100]);
  const pagedCommonItems = commonItemsPagination.paged(sortedCommonItems);
  const pagedPlayerUsage = playerUsagePagination.paged(sortedPlayerUsage);
  const pagedRecentMatches = recentMatchesPagination.paged(sortedRecentMatches);

  return (
    <Page
      title={query.data ? query.data.heroName : `Hero ${params.heroId ?? ""}`}
      subtitle="Hero drill-down from your local match dataset, with click-through access to the stored matches behind the aggregates."
      aside={
        query.data ? (
          <div className="hero-header-art">
            <IconImage
              src={query.data.heroPortraitUrl ?? query.data.heroIconUrl}
              alt={query.data.heroName}
              size="lg"
              rounded={false}
            />
          </div>
        ) : null
      }
    >
      {query.isLoading ? <LoadingState label="Loading hero detail…" /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Source", value: query.data.source === "fresh" ? "Fresh fetch" : "Cache" },
              { label: "Local appearances", value: formatNumber(query.data.games) },
              { label: "Winrate", value: `${query.data.winrate}%` },
              { label: "Unique players", value: formatNumber(query.data.uniquePlayers) },
              {
                label: "Avg first core",
                value: formatDuration(query.data.averageFirstCoreItemTimingSeconds)
              }
            ]}
          />

          <div className="two-column">
            <Card title="What This Hero Count Means">
              <div className="stack compact">
                <p>
                  This hero total is based on local stored appearances for this hero in your app’s
                  database.
                </p>
                <p>
                  It grows when you fetch player recent matches or full match details that contain
                  this hero.
                </p>
              </div>
            </Card>

            <TableCard
              title="Common item timings"
              rowCount={pagedCommonItems.length}
              totalItems={sortedCommonItems.length}
              page={commonItemsPagination.page}
              totalPages={commonItemsPagination.totalPages}
              pageSize={commonItemsPagination.pageSize}
              pageSizeOptions={commonItemsPagination.pageSizeOptions}
              onPreviousPage={commonItemsPagination.previousPage}
              onNextPage={commonItemsPagination.nextPage}
              onPageSizeChange={commonItemsPagination.setPageSize}
              empty={<EmptyState label="No item timing data stored for this hero yet." />}
            >
              <DataTable
                rows={pagedCommonItems}
                getRowKey={(item) => item.itemName}
                sortState={commonItemsSort}
                onSortChange={(key) =>
                  setCommonItemsSort((current) => ({
                    key: key as "item" | "usages" | "timing",
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
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
                  { key: "usages", header: "Usages", sortable: true, cell: (item) => formatNumber(item.usages) },
                  { key: "timing", header: "Average timing", sortable: true, cell: (item) => formatDuration(item.averageTimingSeconds) }
                ]}
              />
            </TableCard>

            <TableCard
              title="Player usage"
              rowCount={pagedPlayerUsage.length}
              totalItems={sortedPlayerUsage.length}
              page={playerUsagePagination.page}
              totalPages={playerUsagePagination.totalPages}
              pageSize={playerUsagePagination.pageSize}
              pageSizeOptions={playerUsagePagination.pageSizeOptions}
              onPreviousPage={playerUsagePagination.previousPage}
              onNextPage={playerUsagePagination.nextPage}
              onPageSizeChange={playerUsagePagination.setPageSize}
              empty={<EmptyState label="No player usage is stored for this hero yet." />}
            >
              <DataTable
                rows={pagedPlayerUsage}
                getRowKey={(player, index) => `${player.playerId ?? "anon"}-${index}`}
                sortState={playerUsageSort}
                onSortChange={(key) =>
                  setPlayerUsageSort((current) => ({
                    key: key as "player" | "games" | "wins" | "winrate",
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
                        <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                      ) : (
                        player.personaname ?? "Anonymous"
                      )
                  },
                  { key: "games", header: "Games", sortable: true, cell: (player) => formatNumber(player.games) },
                  { key: "wins", header: "Wins", sortable: true, cell: (player) => formatNumber(player.wins) },
                  { key: "winrate", header: "Winrate", sortable: true, cell: (player) => `${player.winrate}%` }
                ]}
              />
            </TableCard>
          </div>

          <TableCard
            title="Stored matches for this hero"
            rowCount={pagedRecentMatches.length}
            totalItems={sortedRecentMatches.length}
            page={recentMatchesPagination.page}
            totalPages={recentMatchesPagination.totalPages}
            pageSize={recentMatchesPagination.pageSize}
            pageSizeOptions={recentMatchesPagination.pageSizeOptions}
            onPreviousPage={recentMatchesPagination.previousPage}
            onNextPage={recentMatchesPagination.nextPage}
            onPageSizeChange={recentMatchesPagination.setPageSize}
            empty={<EmptyState label="No stored matches found for this hero." />}
          >
            <DataTable
              rows={pagedRecentMatches}
              getRowKey={(match) => String(match.matchId)}
              sortState={recentMatchesSort}
              onSortChange={(key) =>
                setRecentMatchesSort((current) => ({
                  key: key as "match" | "start" | "duration" | "outcome" | "score" | "kills" | "patch" | "league" | "parsedData",
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
                  cell: (match) =>
                    match.radiantWin === null ? "Unknown" : match.radiantWin ? "Radiant victory" : "Dire victory"
                },
                {
                  key: "score",
                  header: "Score",
                  sortable: true,
                  cell: (match) => `${formatNumber(match.radiantScore)} - ${formatNumber(match.direScore)}`
                },
                { key: "kills", header: "Total kills", sortable: true, cell: (match) => formatNumber(match.totalKills) },
                { key: "patch", header: "Patch", sortable: true, cell: (match) => match.patch ?? "Unknown" },
                { key: "league", header: "League", sortable: true, cell: (match) => match.league ?? "Unknown" },
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
            />
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
