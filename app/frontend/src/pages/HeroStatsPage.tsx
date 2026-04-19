import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useHeroStats } from "../hooks/useQueries";
import { formatDuration } from "../lib/format";

export function HeroStatsPage() {
  const query = useHeroStats();

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
          <Card title="Hero performance">
            {query.data.length === 0 ? (
              <EmptyState label="Fetch a player or match first to populate hero analytics." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Hero</th>
                    <th>Local appearances</th>
                    <th>Winrate</th>
                    <th>Players</th>
                    <th>First core timing</th>
                    <th>Common items</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.map((hero) => (
                    <tr key={hero.heroId}>
                      <td>
                        <Link to={`/heroes/${hero.heroId}`} className="entity-link">
                          <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                          <span>{hero.heroName}</span>
                        </Link>
                      </td>
                      <td>{hero.games}</td>
                      <td>{hero.winrate}%</td>
                      <td>{hero.uniquePlayers}</td>
                      <td>{formatDuration(hero.averageFirstCoreItemTimingSeconds)}</td>
                      <td>
                        {hero.commonItems.length === 0
                          ? "No item timing data"
                          : hero.commonItems.map((item) => (
                              <span key={item.itemName} className="icon-chip">
                                <IconImage src={item.imageUrl} alt={item.itemName} size="sm" />
                                <span>
                                  {item.itemName} ({formatDuration(item.averageTimingSeconds)})
                                </span>
                              </span>
                            ))}
                      </td>
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
