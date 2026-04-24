import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { useHeroStats, useLeagues } from "../hooks/useQueries";
import { usePagination } from "../hooks/usePagination";
import { formatDuration } from "../lib/format";

export function HeroStatsPage() {
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const leaguesQuery = useLeagues();
  const query = useHeroStats({ leagueId: leagueFilter !== "all" ? Number(leagueFilter) : null });
  const [sortState, setSortState] = useState<{
    key: "hero" | "games" | "winrate" | "players" | "timing";
    direction: "asc" | "desc";
  }>({ key: "games", direction: "desc" });

  const sortedHeroes = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    const rows = [...(query.data ?? [])].filter((hero) => {
      if (!needle) return true;
      return (
        hero.heroName.toLowerCase().includes(needle) ||
        hero.commonItems.some((item) => item.itemName.toLowerCase().includes(needle))
      );
    });

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
          compare =
            (left.averageFirstCoreItemTimingSeconds ?? Number.MAX_SAFE_INTEGER) -
            (right.averageFirstCoreItemTimingSeconds ?? Number.MAX_SAFE_INTEGER);
          break;
        case "games":
        default:
          compare = left.games - right.games;
          break;
      }
      return sortState.direction === "asc" ? compare : -compare;
    });

    return rows;
  }, [query.data, searchTerm, sortState]);

  const pagination = usePagination(sortedHeroes.length, 20, [20, 50, 100]);
  const pagedHeroes = pagination.paged(sortedHeroes);

  return (
    <Page title="Hero stats">
      {query.isLoading ? <LoadingState label="Computing hero analytics..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
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
          extra={
            <div className="table-controls">
              {leaguesQuery.data && leaguesQuery.data.length > 0 ? (
                <label>
                  League
                  <select
                    value={leagueFilter}
                    onChange={(event) => {
                      setLeagueFilter(event.target.value);
                      pagination.resetPage();
                    }}
                  >
                    <option value="all">All leagues</option>
                    {leaguesQuery.data.map((league) => (
                      <option key={league.leagueId} value={league.leagueId}>
                        {league.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                Search
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value);
                    pagination.resetPage();
                  }}
                  placeholder="Hero or item"
                />
              </label>
            </div>
          }
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
      ) : null}
    </Page>
  );
}
