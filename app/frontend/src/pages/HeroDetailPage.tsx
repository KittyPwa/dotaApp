import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useHero } from "../hooks/useQueries";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

export function HeroDetailPage() {
  const params = useParams();
  const heroId = params.heroId ? Number(params.heroId) : null;
  const query = useHero(Number.isFinite(heroId) ? heroId : null);

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

            <Card title="Common item timings">
              {query.data.commonItems.length === 0 ? (
                <EmptyState label="No item timing data stored for this hero yet." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Usages</th>
                      <th>Average timing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.commonItems.map((item) => (
                      <tr key={item.itemName}>
                        <td>
                          <span className="entity-link">
                            <IconImage src={item.imageUrl} alt={item.itemName} size="sm" />
                            <span>{item.itemName}</span>
                          </span>
                        </td>
                        <td>{formatNumber(item.usages)}</td>
                        <td>{formatDuration(item.averageTimingSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Player usage">
              {query.data.playerUsage.length === 0 ? (
                <EmptyState label="No player usage is stored for this hero yet." />
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Games</th>
                      <th>Wins</th>
                      <th>Winrate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.playerUsage.map((player, index) => (
                      <tr key={`${player.playerId ?? "anon"}-${index}`}>
                        <td>
                          {player.playerId ? (
                            <Link to={`/players/${player.playerId}`}>{player.personaname ?? player.playerId}</Link>
                          ) : (
                            player.personaname ?? "Anonymous"
                          )}
                        </td>
                        <td>{formatNumber(player.games)}</td>
                        <td>{formatNumber(player.wins)}</td>
                        <td>{player.winrate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="Stored matches for this hero">
            {query.data.recentMatches.length === 0 ? (
              <EmptyState label="No stored matches found for this hero." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Match</th>
                    <th>Start</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                    <th>Score</th>
                    <th>Total kills</th>
                    <th>Patch</th>
                    <th>League</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.recentMatches.map((match) => (
                    <tr key={match.matchId}>
                      <td>
                        <Link to={`/matches/${match.matchId}`}>{match.matchId}</Link>
                      </td>
                      <td>{formatDate(match.startTime)}</td>
                      <td>{formatDuration(match.durationSeconds)}</td>
                      <td>
                        {match.radiantWin === null
                          ? "Unknown"
                          : match.radiantWin
                            ? "Radiant victory"
                            : "Dire victory"}
                      </td>
                      <td>
                        {formatNumber(match.radiantScore)} - {formatNumber(match.direScore)}
                      </td>
                      <td>{formatNumber(match.totalKills)}</td>
                      <td>{match.patch ?? "Unknown"}</td>
                      <td>{match.league ?? "Unknown"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}
    </Page>
  );
}
