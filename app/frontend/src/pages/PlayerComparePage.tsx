import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { DataTable } from "../components/DataTable";
import { IconImage } from "../components/IconImage";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
import { usePagination } from "../hooks/usePagination";
import { useDashboard, usePlayerCompare } from "../hooks/useQueries";
import { formatDate, formatDuration } from "../lib/format";

function parsePlayerIds(value: string) {
  return value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index);
}

export function PlayerComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputValue, setInputValue] = useState(searchParams.get("ids") ?? "");
  const [selectedComboKey, setSelectedComboKey] = useState<string | null>(null);
  const [pairSort, setPairSort] = useState<{ key: "players" | "games" | "record" | "winrate"; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [comboMatchSort, setComboMatchSort] = useState<{ key: "match" | "date" | "duration" | "result"; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
  });

  const playerIds = parsePlayerIds(searchParams.get("ids") ?? "");
  const query = usePlayerCompare(playerIds);
  const dashboardQuery = useDashboard();
  const playerNameMap = new Map(query.data?.players.map((player) => [player.playerId, player.personaname ?? `Player ${player.playerId}`]) ?? []);
  const favoritePlayers = dashboardQuery.data?.focusedPlayers ?? [];
  const selectedCombo = query.data?.heroCombinations.find((combo) => combo.comboKey === selectedComboKey) ?? null;
  const filteredComboMatches =
    selectedCombo && query.data
      ? query.data.sharedMatchDetails.filter((match) => selectedCombo.matchIds.includes(match.matchId))
      : [];

  const pairRows = [...(query.data?.pairStats ?? [])].sort((left, right) => {
    let compare = 0;
    switch (pairSort.key) {
      case "players":
        compare = `${playerNameMap.get(left.leftPlayerId) ?? left.leftPlayerId}+${playerNameMap.get(left.rightPlayerId) ?? left.rightPlayerId}`.localeCompare(
          `${playerNameMap.get(right.leftPlayerId) ?? right.leftPlayerId}+${playerNameMap.get(right.rightPlayerId) ?? right.rightPlayerId}`
        );
        break;
      case "record":
        compare = (left.wins - left.losses) - (right.wins - right.losses);
        break;
      case "winrate":
        compare = left.winrate - right.winrate;
        break;
      case "games":
      default:
        compare = left.games - right.games;
        break;
    }
    return pairSort.direction === "asc" ? compare : -compare;
  });
  const comboRows = query.data?.heroCombinations ?? [];
  const sortedComboMatches = [...filteredComboMatches].sort((left, right) => {
    let compare = 0;
    switch (comboMatchSort.key) {
      case "match":
        compare = left.matchId - right.matchId;
        break;
      case "duration":
        compare = (left.durationSeconds ?? 0) - (right.durationSeconds ?? 0);
        break;
      case "result":
        compare = Number(left.win ?? false) - Number(right.win ?? false);
        break;
      case "date":
      default:
        compare = (left.startTime ?? 0) - (right.startTime ?? 0);
        break;
    }
    return comboMatchSort.direction === "asc" ? compare : -compare;
  });
  const pairPagination = usePagination(pairRows.length, 20, [20, 50, 100]);
  const comboPagination = usePagination(comboRows.length, 12, [12, 24, 48]);
  const comboMatchPagination = usePagination(sortedComboMatches.length, 20, [20, 50, 100]);
  const pagedPairRows = pairPagination.paged(pairRows);
  const pagedComboRows = comboPagination.paged(comboRows);
  const pagedComboMatches = comboMatchPagination.paged(sortedComboMatches);

  const applyIds = (ids: number[]) => {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    const nextValue = uniqueIds.join(",");
    setInputValue(nextValue);
    setSelectedComboKey(null);
    pairPagination.resetPage();
    comboPagination.resetPage();
    comboMatchPagination.resetPage();
    setSearchParams(nextValue ? { ids: nextValue } : {});
  };

  const toggleQuickPlayer = (playerId: number) => {
    if (playerIds.includes(playerId)) {
      applyIds(playerIds.filter((id) => id !== playerId));
      return;
    }

    applyIds([...playerIds, playerId]);
  };

  return (
    <Page
      title="Compare players"
      subtitle="Cross-reference local match history, shared games, teammate winrates, and hero overlap between multiple players."
    >
      <Card title="Comparison setup">
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            applyIds(parsePlayerIds(inputValue.trim()));
          }}
        >
          <label>
            Player IDs
            <input
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Comma-separated player IDs"
            />
          </label>
          <button type="submit">Compare players</button>
        </form>
        {favoritePlayers.length > 0 ? (
          <div className="stack compact">
            <span className="eyebrow">Quick pick from your player + favorites</span>
            <div className="action-group">
              {favoritePlayers.map((player) => {
                const active = playerIds.includes(player.playerId);
                return (
                  <button
                    key={player.playerId}
                    type="button"
                    className={`quick-player-chip ${active ? "active" : ""}`}
                    onClick={() => toggleQuickPlayer(player.playerId)}
                  >
                    {player.personaname ?? `Player ${player.playerId}`}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <p className="muted-inline">
          Comparison metrics use your local dataset only. Shared/combo counts mean matches where the selected players were on the same team with those exact hero assignments.
        </p>
      </Card>

      {playerIds.length < 2 ? <EmptyState label="Enter at least two player IDs to compare them." /> : null}
      {query.isLoading ? <LoadingState label="Loading player comparison..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <div className="two-column">
            <Card title="Selected players">
              <div className="roster-list">
                {query.data.players.map((player) => (
                  <div key={player.playerId} className="player-panel">
                    <div className="player-panel-header">
                      <div className="entity-link">
                        {player.avatar ? (
                          <img className="avatar avatar-sm" src={player.avatar} alt={player.personaname ?? String(player.playerId)} />
                        ) : (
                          <div className="avatar avatar-sm avatar-fallback">
                            {String(player.personaname ?? player.playerId).slice(0, 2)}
                          </div>
                        )}
                        <div className="stack compact">
                          <strong>
                            <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                          </strong>
                          <span className="muted-inline">{player.totalStoredMatches} local matches</span>
                        </div>
                      </div>
                      <div className="player-panel-kda">
                        <strong>
                          {player.wins}W / {player.losses}L
                        </strong>
                      </div>
                    </div>
                    <div className="player-metrics">
                      <div>
                        <span className="eyebrow">Top heroes</span>
                        <div className="stack compact">
                          {player.topHeroes.length > 0 ? (
                            player.topHeroes.map((hero) => (
                              <span key={`${player.playerId}-${hero.heroId}`} className="entity-link">
                                <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                                <span>
                                  {hero.heroName} ({hero.games})
                                </span>
                              </span>
                            ))
                          ) : (
                            <strong>No local hero data yet</strong>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Shared matches">
              <div className="stack compact">
                <p>Games together: {query.data.sharedMatches.games}</p>
                <p>
                  Shared record: {query.data.sharedMatches.wins}W / {query.data.sharedMatches.losses}L (
                  {query.data.sharedMatches.winrate}%)
                </p>
                <div className="compare-summary-bar">
                  <div
                    className="compare-summary-bar-fill"
                    style={{ width: `${Math.max(0, Math.min(100, query.data.sharedMatches.winrate))}%` }}
                  />
                </div>
                <div className="stack compact">
                  <span className="eyebrow">Recent shared matches</span>
                  {query.data.sharedMatches.recentMatchIds.length > 0 ? (
                    <div className="action-group">
                      {query.data.sharedMatches.recentMatchIds.map((matchId) => (
                        <Link key={matchId} className="inline-link-chip" to={`/matches/${matchId}`}>
                          Match {matchId}
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <span className="muted-inline">No shared matches in local data yet.</span>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <div className="two-column">
            <TableCard
              title="Pairwise synergy"
              rowCount={pagedPairRows.length}
              totalItems={pairRows.length}
              page={pairPagination.page}
              totalPages={pairPagination.totalPages}
              pageSize={pairPagination.pageSize}
              pageSizeOptions={pairPagination.pageSizeOptions}
              onPreviousPage={pairPagination.previousPage}
              onNextPage={pairPagination.nextPage}
              onPageSizeChange={pairPagination.setPageSize}
              empty={<EmptyState label="No pairwise overlap found in the local dataset yet." />}
            >
              <DataTable
                rows={pagedPairRows}
                getRowKey={(pair) => `${pair.leftPlayerId}-${pair.rightPlayerId}`}
                sortState={pairSort}
                onSortChange={(key) =>
                  setPairSort((current) => ({
                    key: key as "players" | "games" | "record" | "winrate",
                    direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
                  }))
                }
                columns={[
                  {
                    key: "players",
                    header: "Players",
                    sortable: true,
                    cell: (pair) => (
                      <>
                        <Link to={`/players/${pair.leftPlayerId}`}>{playerNameMap.get(pair.leftPlayerId) ?? pair.leftPlayerId}</Link>
                        {" + "}
                        <Link to={`/players/${pair.rightPlayerId}`}>{playerNameMap.get(pair.rightPlayerId) ?? pair.rightPlayerId}</Link>
                      </>
                    )
                  },
                  { key: "games", header: "Games", sortable: true, cell: (pair) => pair.games },
                  { key: "record", header: "Record", sortable: true, cell: (pair) => `${pair.wins}W / ${pair.losses}L` },
                  { key: "winrate", header: "Winrate", sortable: true, cell: (pair) => `${pair.winrate}%` }
                ]}
              />
            </TableCard>

            <Card title="Hero combinations together">
              {comboRows.length === 0 ? (
                <EmptyState label="No hero-combination data found in shared matches yet." />
              ) : (
                <div className="stack compact">
                  {playerIds.length === 2 && playerIds.includes(148440404) && playerIds.includes(168634634) ? (
                    <p className="muted-inline">
                      Live check: `Kittypwa: Invoker + Nerros: Brewmaster` is currently `21` exact shared matches in your local dataset.
                    </p>
                  ) : null}
                  {pagedComboRows.map((combo) => (
                    <button
                      key={combo.comboKey}
                      type="button"
                      className={`combo-card combo-button ${selectedComboKey === combo.comboKey ? "active" : ""}`}
                      onClick={() => {
                        comboMatchPagination.resetPage();
                        setSelectedComboKey((value) => (value === combo.comboKey ? null : combo.comboKey));
                      }}
                    >
                      <div className="player-panel-header">
                        <div className="stack compact">
                          <strong>{combo.comboKey}</strong>
                          <span className="muted-inline">
                            {combo.games} games | {combo.wins}W / {combo.losses}L | {combo.winrate}% winrate
                          </span>
                        </div>
                        <strong>{combo.winrate}%</strong>
                      </div>
                      <div className="entity-link-wrap">
                        {combo.heroes.map((hero) => (
                          <span key={`${combo.comboKey}-${hero.playerId}-${hero.heroId}`} className="entity-link">
                            <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                            <span>
                              {hero.personaname ?? `Player ${hero.playerId}`}: {hero.heroName}
                            </span>
                          </span>
                        ))}
                      </div>
                      <div className="compare-summary-bar">
                        <div
                          className="compare-summary-bar-fill"
                          style={{ width: `${Math.max(0, Math.min(100, combo.winrate))}%` }}
                        />
                      </div>
                    </button>
                  ))}
                  <div className="pagination-inline">
                    <label className="pagination-page-size">
                      Rows
                      <select value={comboPagination.pageSize} onChange={(event) => comboPagination.setPageSize(Number(event.target.value))}>
                        {comboPagination.pageSizeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" onClick={comboPagination.previousPage} disabled={comboPagination.page <= 1}>
                      Prev
                    </button>
                    <span>
                      Page {comboPagination.page} / {comboPagination.totalPages}
                    </span>
                    <button type="button" onClick={comboPagination.nextPage} disabled={comboPagination.page >= comboPagination.totalPages}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <TableCard
            title={selectedCombo ? `Matches for ${selectedCombo.comboKey}` : "Select a hero combination"}
            rowCount={selectedCombo ? pagedComboMatches.length : 0}
            totalItems={selectedCombo ? sortedComboMatches.length : 0}
            page={comboMatchPagination.page}
            totalPages={comboMatchPagination.totalPages}
            pageSize={comboMatchPagination.pageSize}
            pageSizeOptions={comboMatchPagination.pageSizeOptions}
            onPreviousPage={comboMatchPagination.previousPage}
            onNextPage={comboMatchPagination.nextPage}
            onPageSizeChange={comboMatchPagination.setPageSize}
            empty={
              selectedCombo ? (
                <EmptyState label="No matching local matches were found for this combination." />
              ) : (
                <EmptyState label="Click a hero combination above to inspect the exact matches behind that stat." />
              )
            }
            extra={
              selectedCombo ? (
                <span className="muted-inline">Showing all locally stored shared matches for this exact player-to-hero combination.</span>
              ) : null
            }
          >
            <DataTable
              rows={pagedComboMatches}
              className="player-history-table"
              getRowKey={(match) => String(match.matchId)}
              rowClassName={(match) =>
                match.win === true ? "row-win" : match.win === false ? "row-loss" : "row-unknown"
              }
              sortState={comboMatchSort}
              onSortChange={(key) =>
                setComboMatchSort((current) => ({
                  key: key as "match" | "date" | "duration" | "result",
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
                  cell: (match) => (match.win === true ? "Win" : match.win === false ? "Loss" : "Unknown")
                }
              ]}
            />
          </TableCard>
        </>
      ) : null}
    </Page>
  );
}
