import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { ErrorState, LoadingState } from "../components/State";
import { useMatch } from "../hooks/useQueries";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getKdaRatio(kills: number | null, deaths: number | null, assists: number | null) {
  const total = (kills ?? 0) + (assists ?? 0);
  const safeDeaths = Math.max(deaths ?? 0, 1);
  return (total / safeDeaths).toFixed(2);
}

export function MatchPage() {
  const params = useParams();
  const matchId = params.matchId ? Number(params.matchId) : null;
  const query = useMatch(Number.isFinite(matchId) ? matchId : null);

  const radiantPlayers = query.data?.participants.filter((player) => player.isRadiant) ?? [];
  const direPlayers = query.data?.participants.filter((player) => !player.isRadiant) ?? [];

  return (
    <Page
      title={`Match ${params.matchId ?? ""}`}
      subtitle="Detailed match inspection sourced from cache when possible and OpenDota when needed."
    >
      {query.isLoading ? <LoadingState label="Loading match detail…" /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <MetricGrid
            items={[
              {
                label: "Winner",
                value:
                  query.data.radiantWin === null
                    ? "Unknown"
                    : query.data.radiantWin
                      ? "Radiant victory"
                      : "Dire victory"
              },
              {
                label: "Score",
                value: `${formatNumber(query.data.radiantScore)} - ${formatNumber(query.data.direScore)}`
              },
              { label: "Duration", value: formatDuration(query.data.durationSeconds) },
              { label: "Start", value: formatDate(query.data.startTime) },
              { label: "Patch", value: query.data.patch ?? "Unknown" },
              { label: "League", value: query.data.league ?? "Public / unknown" },
              { label: "Source", value: query.data.source === "fresh" ? "Fresh fetch" : "Cache" },
              { label: "Total kills", value: formatNumber(query.data.summary.totalKills) }
            ]}
          />

          <div className="two-column">
            <Card title="Why This Match Looks The Way It Does">
              <div className="stack compact">
                <p>
                  Radiant finished {formatNumber(query.data.summary.radiantNetWorth - query.data.summary.direNetWorth)} net
                  worth ahead and dealt {formatNumber(query.data.summary.radiantHeroDamage - query.data.summary.direHeroDamage)}
                  {" "}more hero damage.
                </p>
                <p>
                  Farm edge: {formatNumber(query.data.summary.radiantLastHits)} LH vs{" "}
                  {formatNumber(query.data.summary.direLastHits)} LH.
                </p>
                <p>
                  Pace edge: {formatNumber(query.data.summary.averageGpm.radiant)} avg GPM vs{" "}
                  {formatNumber(query.data.summary.averageGpm.dire)} avg GPM.
                </p>
                <p>
                  Players tracked: {query.data.summary.radiantPlayers + query.data.summary.direPlayers} /
                  10.
                </p>
              </div>
            </Card>

            <Card title="Team comparison">
              <div className="team-panels">
                <div className="team-panel radiant">
                  <div className="team-panel-header">
                    <strong>Radiant</strong>
                    <span>{formatNumber(query.data.radiantScore)} kills</span>
                  </div>
                  <div className="team-stats-grid">
                    <span>Net worth</span>
                    <strong>{formatNumber(query.data.summary.radiantNetWorth)}</strong>
                    <span>Hero damage</span>
                    <strong>{formatNumber(query.data.summary.radiantHeroDamage)}</strong>
                    <span>Tower damage</span>
                    <strong>{formatNumber(query.data.summary.radiantTowerDamage)}</strong>
                    <span>Last hits</span>
                    <strong>{formatNumber(query.data.summary.radiantLastHits)}</strong>
                    <span>Average GPM</span>
                    <strong>{formatNumber(query.data.summary.averageGpm.radiant)}</strong>
                    <span>Average XPM</span>
                    <strong>{formatNumber(query.data.summary.averageXpm.radiant)}</strong>
                  </div>
                </div>
                <div className="team-panel dire">
                  <div className="team-panel-header">
                    <strong>Dire</strong>
                    <span>{formatNumber(query.data.direScore)} kills</span>
                  </div>
                  <div className="team-stats-grid">
                    <span>Net worth</span>
                    <strong>{formatNumber(query.data.summary.direNetWorth)}</strong>
                    <span>Hero damage</span>
                    <strong>{formatNumber(query.data.summary.direHeroDamage)}</strong>
                    <span>Tower damage</span>
                    <strong>{formatNumber(query.data.summary.direTowerDamage)}</strong>
                    <span>Last hits</span>
                    <strong>{formatNumber(query.data.summary.direLastHits)}</strong>
                    <span>Average GPM</span>
                    <strong>{formatNumber(query.data.summary.averageGpm.dire)}</strong>
                    <span>Average XPM</span>
                    <strong>{formatNumber(query.data.summary.averageXpm.dire)}</strong>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="two-column">
            <Card title="Match leaders">
              <div className="leader-grid">
                {Object.values(query.data.summary.leaders)
                  .filter((leader) => leader !== null)
                  .map((leader) => (
                    <div key={leader.label} className="leader-card">
                      <span className="eyebrow">{leader.label}</span>
                      <strong>{formatNumber(leader.value)}</strong>
                      <span>
                        {leader.personaname ?? leader.playerId ?? "Anonymous"} on {leader.heroName ?? "Unknown"}
                      </span>
                      <span className="muted-inline">{leader.team}</span>
                    </div>
                  ))}
              </div>
            </Card>

            <Card title="Draft overview">
              {query.data.draft.length === 0 ? (
                <p>No picks or bans were stored for this match.</p>
              ) : (
                <div className="draft-list">
                  {query.data.draft.map((event) => {
                    const participant = query.data.participants.find((player) => player.heroId === event.heroId);
                    return (
                      <div key={`${event.team}-${event.orderIndex}-${event.heroId}`} className="draft-row">
                        <span className="draft-order">#{event.orderIndex + 1}</span>
                        <span className={`draft-type ${event.isPick ? "pick" : "ban"}`}>
                          {event.team} {event.isPick ? "pick" : "ban"}
                        </span>
                        <span className="entity-link">
                          <IconImage
                            src={participant?.heroIconUrl}
                            alt={event.heroName ?? `Hero ${event.heroId}`}
                            size="sm"
                          />
                          <span>{event.heroName ?? event.heroId}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>

          <div className="two-column">
            {[
              {
                title: "Radiant roster",
                players: radiantPlayers,
                team: "radiant" as const,
                teamKills: query.data.radiantScore ?? 0
              },
              {
                title: "Dire roster",
                players: direPlayers,
                team: "dire" as const,
                teamKills: query.data.direScore ?? 0
              }
            ].map((section) => (
              <Card key={section.title} title={section.title}>
                <div className="roster-list">
                  {section.players.map((player, index) => {
                    const killParticipation =
                      section.teamKills > 0 ? (((player.kills ?? 0) + (player.assists ?? 0)) / section.teamKills) * 100 : 0;
                    return (
                      <div key={`${player.playerId ?? "anon"}-${index}`} className={`player-panel ${section.team}`}>
                        <div className="player-panel-header">
                          <div className="entity-link">
                            <IconImage
                              src={player.heroIconUrl}
                              alt={player.heroName ?? `Hero ${player.heroId ?? ""}`}
                              size="md"
                            />
                            <div className="stack compact">
                              <strong>{player.heroName ?? player.heroId ?? "Unknown"}</strong>
                              <span>
                                {player.playerId ? (
                                  <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                                ) : (
                                  player.personaname ?? "Anonymous"
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="player-panel-kda">
                            <strong>
                              {player.kills ?? 0}/{player.deaths ?? 0}/{player.assists ?? 0}
                            </strong>
                            <span className="muted-inline">{getKdaRatio(player.kills, player.deaths, player.assists)} KDA</span>
                          </div>
                        </div>

                        <div className="player-metrics">
                          <div>
                            <span className="eyebrow">Kill participation</span>
                            <strong>{formatPercent(killParticipation)}</strong>
                          </div>
                          <div>
                            <span className="eyebrow">Net worth</span>
                            <strong>{formatNumber(player.netWorth)}</strong>
                          </div>
                          <div>
                            <span className="eyebrow">Farm</span>
                            <strong>
                              {formatNumber(player.gpm)} GPM / {formatNumber(player.xpm)} XPM
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">Damage</span>
                            <strong>
                              {formatNumber(player.heroDamage)} hero / {formatNumber(player.towerDamage)} tower
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">CS</span>
                            <strong>
                              {formatNumber(player.lastHits)} LH / {formatNumber(player.denies)} DN
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">Level</span>
                            <strong>{formatNumber(player.level)}</strong>
                          </div>
                        </div>

                        <div className="player-build">
                          <span className="eyebrow">Build</span>
                          {player.items.length === 0 ? (
                            <p className="muted-inline">No tracked items for this player.</p>
                          ) : (
                            <>
                              <div className="item-icon-strip">
                                {player.items.map((item) => (
                                  <span key={`${item.name}-${item.imageUrl ?? "none"}`} className="item-slot" title={item.name}>
                                    <IconImage src={item.imageUrl} alt={item.name} size="sm" rounded={false} />
                                  </span>
                                ))}
                              </div>
                              <div className="item-name-list">
                                {player.items.map((item) => (
                                  <span key={`${item.name}-label`} className="item-name-chip">
                                    {item.name}
                                  </span>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : null}
    </Page>
  );
}
