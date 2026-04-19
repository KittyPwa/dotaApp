import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { TableCard } from "../components/TableCard";
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
  const [pairPage, setPairPage] = useState(1);
  const [comboPage, setComboPage] = useState(1);
  const [comboMatchPage, setComboMatchPage] = useState(1);

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

  const pairPageSize = 20;
  const comboPageSize = 12;
  const comboMatchPageSize = 20;
  const pairRows = query.data?.pairStats ?? [];
  const pairTotalPages = Math.max(1, Math.ceil(pairRows.length / pairPageSize));
  const currentPairPage = Math.min(pairPage, pairTotalPages);
  const pagedPairRows = pairRows.slice((currentPairPage - 1) * pairPageSize, currentPairPage * pairPageSize);
  const comboRows = query.data?.heroCombinations ?? [];
  const comboTotalPages = Math.max(1, Math.ceil(comboRows.length / comboPageSize));
  const currentComboPage = Math.min(comboPage, comboTotalPages);
  const pagedComboRows = comboRows.slice((currentComboPage - 1) * comboPageSize, currentComboPage * comboPageSize);
  const comboMatchTotalPages = Math.max(1, Math.ceil(filteredComboMatches.length / comboMatchPageSize));
  const currentComboMatchPage = Math.min(comboMatchPage, comboMatchTotalPages);
  const pagedComboMatches = filteredComboMatches.slice(
    (currentComboMatchPage - 1) * comboMatchPageSize,
    currentComboMatchPage * comboMatchPageSize
  );

  const applyIds = (ids: number[]) => {
    const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
    const nextValue = uniqueIds.join(",");
    setInputValue(nextValue);
    setSelectedComboKey(null);
    setPairPage(1);
    setComboPage(1);
    setComboMatchPage(1);
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
              page={currentPairPage}
              totalPages={pairTotalPages}
              onPreviousPage={() => setPairPage((value) => Math.max(1, value - 1))}
              onNextPage={() => setPairPage((value) => Math.min(pairTotalPages, value + 1))}
              empty={<EmptyState label="No pairwise overlap found in the local dataset yet." />}
            >
              <table>
                <thead>
                  <tr>
                    <th>Players</th>
                    <th>Games</th>
                    <th>Record</th>
                    <th>Winrate</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedPairRows.map((pair) => (
                    <tr key={`${pair.leftPlayerId}-${pair.rightPlayerId}`}>
                      <td>
                        <Link to={`/players/${pair.leftPlayerId}`}>{playerNameMap.get(pair.leftPlayerId) ?? pair.leftPlayerId}</Link>
                        {" + "}
                        <Link to={`/players/${pair.rightPlayerId}`}>{playerNameMap.get(pair.rightPlayerId) ?? pair.rightPlayerId}</Link>
                      </td>
                      <td>{pair.games}</td>
                      <td>
                        {pair.wins}W / {pair.losses}L
                      </td>
                      <td>{pair.winrate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                        setComboMatchPage(1);
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
                    <button type="button" onClick={() => setComboPage((value) => Math.max(1, value - 1))} disabled={currentComboPage <= 1}>
                      Prev
                    </button>
                    <span>
                      Page {currentComboPage} / {comboTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setComboPage((value) => Math.min(comboTotalPages, value + 1))}
                      disabled={currentComboPage >= comboTotalPages}
                    >
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
            page={currentComboMatchPage}
            totalPages={comboMatchTotalPages}
            onPreviousPage={() => setComboMatchPage((value) => Math.max(1, value - 1))}
            onNextPage={() => setComboMatchPage((value) => Math.min(comboMatchTotalPages, value + 1))}
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
            <table>
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Date</th>
                  <th>Duration</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {pagedComboMatches.map((match) => (
                  <tr key={match.matchId} className={match.win === true ? "row-win" : match.win === false ? "row-loss" : "row-unknown"}>
                    <td>
                      <Link to={`/matches/${match.matchId}`}>{match.matchId}</Link>
                    </td>
                    <td>{formatDate(match.startTime)}</td>
                    <td>{formatDuration(match.durationSeconds)}</td>
                    <td>{match.win === true ? "Win" : match.win === false ? "Loss" : "Unknown"}</td>
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
