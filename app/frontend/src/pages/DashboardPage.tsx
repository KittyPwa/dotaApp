import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { useDashboard } from "../hooks/useQueries";

export function DashboardPage() {
  const query = useDashboard();

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
            <Card title="Most played heroes in your local data">
              <table>
                <thead>
                  <tr>
                    <th>Hero</th>
                    <th>Games</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.mostPlayedHeroes.map((hero) => (
                    <tr key={hero.heroId}>
                      <td>
                        <Link to={`/heroes/${hero.heroId}`}>{hero.heroName}</Link>
                      </td>
                      <td>{hero.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Best local winrates">
              <table>
                <thead>
                  <tr>
                    <th>Hero</th>
                    <th>Games</th>
                    <th>Winrate</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.highestWinrateHeroes.map((hero) => (
                    <tr key={hero.heroId}>
                      <td>
                        <Link to={`/heroes/${hero.heroId}`}>{hero.heroName}</Link>
                      </td>
                      <td>{hero.games}</td>
                      <td>{hero.winrate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      ) : null}
    </Page>
  );
}
