import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "../components/DataTable";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { useLeagues } from "../hooks/useQueries";
import { formatDate, formatNumber } from "../lib/format";

type LeagueSortKey = "name" | "matches" | "full" | "players" | "heroes" | "last";

export function LeaguesPage() {
  const query = useLeagues();
  const [sortState, setSortState] = useState<{ key: LeagueSortKey; direction: "asc" | "desc" }>({
    key: "matches",
    direction: "desc"
  });

  const sortedLeagues = useMemo(() => {
    const rows = [...(query.data ?? [])];
    rows.sort((left, right) => {
      let compare = 0;
      switch (sortState.key) {
        case "name":
          compare = left.name.localeCompare(right.name);
          break;
        case "full":
          compare = left.parsedFullMatches - right.parsedFullMatches;
          break;
        case "players":
          compare = left.uniquePlayers - right.uniquePlayers;
          break;
        case "heroes":
          compare = left.uniqueHeroes - right.uniqueHeroes;
          break;
        case "last":
          compare = (left.lastMatchTime ?? 0) - (right.lastMatchTime ?? 0);
          break;
        case "matches":
        default:
          compare = left.matchCount - right.matchCount;
          break;
      }
      return sortState.direction === "asc" ? compare : -compare;
    });
    return rows;
  }, [query.data, sortState]);

  const pagination = usePagination(sortedLeagues.length, 20, [20, 50, 100]);
  const pagedLeagues = pagination.paged(sortedLeagues);
  const totalMatches = (query.data ?? []).reduce((sum, league) => sum + league.matchCount, 0);
  const fullMatches = (query.data ?? []).reduce((sum, league) => sum + league.parsedFullMatches, 0);

  return (
    <Page
      title="Leagues"
      subtitle="Local tournament and league analytics from matches already stored in your SQLite database."
    >
      {query.isLoading ? <LoadingState label="Loading local leagues..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              { label: "Stored leagues", value: formatNumber(query.data.length) },
              { label: "League matches", value: formatNumber(totalMatches) },
              { label: "Full STRATZ matches", value: formatNumber(fullMatches) }
            ]}
          />

          <TableCard
            title="Local leagues"
            rowCount={pagedLeagues.length}
            totalItems={sortedLeagues.length}
            page={pagination.page}
            totalPages={pagination.totalPages}
            pageSize={pagination.pageSize}
            pageSizeOptions={pagination.pageSizeOptions}
            onPreviousPage={pagination.previousPage}
            onNextPage={pagination.nextPage}
            onPageSizeChange={pagination.setPageSize}
            empty={<EmptyState label="No league-tagged matches are stored yet. Fetch full league/tournament matches to populate this view." />}
          >
            <DataTable
              rows={pagedLeagues}
              getRowKey={(league) => String(league.leagueId)}
              sortState={sortState}
              onSortChange={(key) =>
                setSortState((current) => ({
                  key: key as LeagueSortKey,
                  direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                }))
              }
              columns={[
                {
                  key: "name",
                  header: "League",
                  sortable: true,
                  cell: (league) => <Link to={`/leagues/${league.leagueId}`}>{league.name}</Link>
                },
                { key: "matches", header: "Matches", sortable: true, cell: (league) => formatNumber(league.matchCount) },
                { key: "full", header: "Full parsed", sortable: true, cell: (league) => formatNumber(league.parsedFullMatches) },
                { key: "players", header: "Players", sortable: true, cell: (league) => formatNumber(league.uniquePlayers) },
                { key: "heroes", header: "Heroes", sortable: true, cell: (league) => formatNumber(league.uniqueHeroes) },
                { key: "last", header: "Last match", sortable: true, cell: (league) => formatDate(league.lastMatchTime) }
              ]}
            />
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
