import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { useHeroStats } from "../hooks/useQueries";
import { usePagination } from "../hooks/usePagination";
import { formatDuration } from "../lib/format";

export function HeroStatsPage() {
  const query = useHeroStats();
  const [sortState, setSortState] = useState<{
    key: "hero" | "games" | "winrate" | "players" | "timing";
    direction: "asc" | "desc";
  }>({ key: "games", direction: "desc" });
  const sortedHeroes = useMemo(() => {
    const rows = [...(query.data ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (sortState.key) {
        case "hero":
          compare = left.heroName.localeCompare(right.heroName);
          break;
        case "winrate":
          compare = left.winrate - right.winrate;
          break;
        case "players":
          compare = left.uniquePlayers - right.uniquePlayers;
          break;
        case "timing":
          compare = (left.averageFirstCoreItemTimingSeconds ?? Number.MAX_SAFE_INTEGER) - (right.averageFirstCoreItemTimingSeconds ?? Number.MAX_SAFE_INTEGER);
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return sortState.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [query.data, sortState]);
  const pagination = usePagination(sortedHeroes.length, 20, [20, 50, 100]);
  const pagedHeroes = pagination.paged(sortedHeroes);

  return (
    <Page
      title="Hero stats"
      subtitle="These analytics are computed only from the matches and player-match rows stored in your local SQLite database."
    >
      {query.isLoading ? <LoadingState label="Computing hero analytics…" /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Tracked heroes", value: query.data.length },
              { label: "Dataset scope", value: "Local only", hint: "No global ladder or replay parsing" },
              { label: "What counts", value: "Local appearances", hint: "Not global Dota totals" }
            ]}
          />
          <Card title="How To Read These Counts">
            <div className="stack compact">
              <p>
                The numbers on this page are built from your local dataset only. They are not global
                OpenDota hero statistics.
              </p>
              <p>
                A hero’s count here means a locally stored hero appearance. If you fetch a player,
                that player’s recent-match hero rows get stored. If you fetch a full match, all
                stored participants from that match contribute.
              </p>
              <p>
                In other words: these totals reflect what you have pulled into this app, not the full
                Dota population.
              </p>
            </div>
          </Card>
          <TableCard
            title="Hero performance"
            rowCount={pagedHeroes.length}
            totalItems={sortedHeroes.length}
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            pageSizeOptions={pagination.pageSizeOptions}
            onPreviousPage={pagination.previousPage}
            onNextPage={pagination.nextPage}
            onPageSizeChange={pagination.setPageSize}
            empty={<EmptyState label="Fetch a player or match first to populate hero analytics." />}
          >
            <DataTable
              rows={pagedHeroes}
              getRowKey={(hero) => String(hero.heroId)}
              sortState={sortState}
              onSortChange={(key) =>
                setSortState((current) => ({
                  key: key as "hero" | "games" | "winrate" | "players" | "timing",
                  direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                }))
              }
              columns={[
                {
                  key: "hero",
                  header: "Hero",
                  sortable: true,
                  cell: (hero) => (
                    <Link to={`/heroes/${hero.heroId}`} className="entity-link">
                      <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                      <span>{hero.heroName}</span>
                    </Link>
                  )
                },
                { key: "games", header: "Local appearances", sortable: true, cell: (hero) => hero.games },
                { key: "winrate", header: "Winrate", sortable: true, cell: (hero) => `${hero.winrate}%` },
                { key: "players", header: "Players", sortable: true, cell: (hero) => hero.uniquePlayers },
                {
                  key: "timing",
                  header: "First core timing",
                  sortable: true,
                  cell: (hero) => formatDuration(hero.averageFirstCoreItemTimingSeconds)
                },
                {
                  key: "items",
                  header: "Common items",
                  cell: (hero) =>
                    hero.commonItems.length === 0
                      ? "No item timing data"
                      : hero.commonItems.map((item) => (
                          <span key={item.itemName} className="icon-chip">
                            <IconImage src={item.imageUrl} alt={item.itemName} size="sm" />
                            <span>
                              {item.itemName} ({formatDuration(item.averageTimingSeconds)})
                            </span>
                          </span>
                        ))
                }
              ]}
            />
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
