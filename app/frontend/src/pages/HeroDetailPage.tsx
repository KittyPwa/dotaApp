import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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

type HeroDetailTab = "overview" | "builds" | "players" | "matches";
type HeroBuildTab = "skills" | "items";
type HeroItemBuild = {
  sequence: Array<{ itemName: string; imageUrl: string | null }>;
  games: number;
  winrate: number;
};
type HeroSkillBuildAbility = NonNullable<ReturnType<typeof useHero>["data"]>["commonSkillBuilds"][number]["sequence"][number];

const heroRankSteps = [
  { tier: 0, label: "Any rank" },
  { tier: 10, label: "Herald" },
  { tier: 20, label: "Guardian" },
  { tier: 30, label: "Crusader" },
  { tier: 40, label: "Archon" },
  { tier: 50, label: "Legend" },
  { tier: 60, label: "Ancient" },
  { tier: 70, label: "Divine" },
  { tier: 80, label: "Immortal" }
];

function rankTierToIndex(value: string | null, fallback: number) {
  const numericValue = value ? Number(value) : NaN;
  const index = heroRankSteps.findIndex((step) => step.tier === numericValue);
  return index >= 0 ? index : fallback;
}

function formatRankTier(value: number | null) {
  if (value === null) return "Unknown";
  const rounded = Math.round(value / 10) * 10;
  const bucket = heroRankSteps.find((step) => step.tier === rounded);
  if (!bucket) return `Tier ${value}`;
  return value % 10 === 0 ? bucket.label : `${bucket.label} (${value.toFixed(1)})`;
}

function clampRangePosition(value: number) {
  return Math.max(0, Math.min(heroRankSteps.length - 1, value));
}

function roundRangePosition(value: number) {
  return Math.round(clampRangePosition(value));
}

function buildSmoothDensityPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] ?? next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (afterNext.x - current.x) / 6;
    const control2Y = next.y - (afterNext.y - current.y) / 6;
    path += ` C ${control1X.toFixed(2)} ${control1Y.toFixed(2)} ${control2X.toFixed(2)} ${control2Y.toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return path;
}

function buildUpperDensityAreaPath(points: Array<{ x: number; y: number }>, baselineY: number) {
  if (points.length === 0) return "";
  const linePath = buildSmoothDensityPath(points);
  const lastPoint = points[points.length - 1];
  return `${linePath} L ${lastPoint.x.toFixed(2)} ${baselineY.toFixed(2)} L ${points[0].x.toFixed(2)} ${baselineY.toFixed(2)} Z`;
}

type ItemBuildTreeNode = {
  key: string;
  itemName: string;
  imageUrl: string | null;
  games: number;
  weightedWins: number;
  children: ItemBuildTreeNode[];
};

function buildItemTree(builds: HeroItemBuild[]) {
  type MutableNode = ItemBuildTreeNode & { childMap: Map<string, MutableNode> };
  const roots = new Map<string, MutableNode>();

  for (const build of builds) {
    let level = roots;
    build.sequence.forEach((item, index) => {
      const nodeKey = `${index}:${item.itemName}`;
      const existing = level.get(nodeKey) ?? {
        key: nodeKey,
        itemName: item.itemName,
        imageUrl: item.imageUrl,
        games: 0,
        weightedWins: 0,
        children: [],
        childMap: new Map<string, MutableNode>()
      };
      existing.games += build.games;
      existing.weightedWins += build.games * (build.winrate / 100);
      if (!level.has(nodeKey)) {
        level.set(nodeKey, existing);
      }
      level = existing.childMap;
    });
  }

  const materialize = (nodes: Map<string, MutableNode>): ItemBuildTreeNode[] =>
    [...nodes.values()]
      .map((node) => ({
        ...node,
        children: materialize(node.childMap)
      }))
      .sort((left, right) => right.games - left.games || left.itemName.localeCompare(right.itemName));

  return materialize(roots);
}

function ItemBuildBranch({ node }: { node: ItemBuildTreeNode }) {
  const winrate = node.games > 0 ? (node.weightedWins / node.games) * 100 : 0;
  return (
    <div className="item-tree-branch">
      <div
        className="item-tree-node"
        title={`${node.itemName} • ${formatNumber(node.games)} games • ${winrate.toFixed(1)}% winrate`}
      >
        <IconImage src={node.imageUrl} alt={node.itemName} size="sm" />
        <span className="item-tree-count">{formatNumber(node.games)}</span>
      </div>
      {node.children.length > 0 ? (
        <div className="item-tree-children">
          {node.children.map((child) => (
            <ItemBuildBranch key={child.key} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HeroItemBuildBranch({ node }: { node: ItemBuildTreeNode }) {
  const winrate = node.games > 0 ? (node.weightedWins / node.games) * 100 : 0;
  return (
    <div className="item-tree-branch">
      <div className="item-tree-node" title={`${node.itemName} - ${formatNumber(node.games)} games - ${winrate.toFixed(1)}% winrate`}>
        <IconImage src={node.imageUrl} alt={node.itemName} size="sm" />
        <span className="item-tree-count">{formatNumber(node.games)}</span>
      </div>
      {node.children.length > 0 ? (
        <div className="item-tree-children">
          {node.children.map((child) => (
            <HeroItemBuildBranch key={child.key} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SkillBuildNode({ ability, orderIndex }: { ability: HeroSkillBuildAbility; orderIndex: number }) {
  return (
    <div className="build-tree-node skill-build-chip" title={`${ability.abilityName} - order ${orderIndex + 1}`}>
      <IconImage src={ability.imageUrl} alt={ability.abilityName} size="sm" />
      <span className="skill-order-label">{orderIndex + 1}</span>
    </div>
  );
}

export function HeroDetailPage() {
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const heroId = params.heroId ? Number(params.heroId) : null;
  const initialMinIndex = rankTierToIndex(searchParams.get("minRankTier"), 0);
  const initialMaxIndex = rankTierToIndex(searchParams.get("maxRankTier"), heroRankSteps.length - 1);
  const [leagueFilter, setLeagueFilter] = useState(searchParams.get("leagueId") ?? "all");
  const [draftMinRankIndex, setDraftMinRankIndex] = useState(initialMinIndex);
  const [draftMaxRankIndex, setDraftMaxRankIndex] = useState(initialMaxIndex);
  const [draftMinRankPosition, setDraftMinRankPosition] = useState(initialMinIndex);
  const [draftMaxRankPosition, setDraftMaxRankPosition] = useState(initialMaxIndex);
  const [activeMinRankIndex, setActiveMinRankIndex] = useState(initialMinIndex);
  const [activeMaxRankIndex, setActiveMaxRankIndex] = useState(initialMaxIndex);
  const query = useHero(Number.isFinite(heroId) ? heroId : null, {
    leagueId: leagueFilter !== "all" ? Number(leagueFilter) : null,
    minRankTier: heroRankSteps[activeMinRankIndex]?.tier > 0 ? heroRankSteps[activeMinRankIndex]?.tier : null,
    maxRankTier:
      heroRankSteps[activeMaxRankIndex]?.tier < heroRankSteps[heroRankSteps.length - 1].tier
        ? heroRankSteps[activeMaxRankIndex]?.tier
        : null
  });
  const [activeTab, setActiveTab] = useState<HeroDetailTab>("overview");
  const [activeBuildTab, setActiveBuildTab] = useState<HeroBuildTab>("skills");
  const [playerUsageSort, setPlayerUsageSort] = useState<{ key: "player" | "games" | "wins" | "winrate"; direction: "asc" | "desc" }>({
    key: "games",
    direction: "desc"
  });
  const [playerSearch, setPlayerSearch] = useState("");
  const [matchSearch, setMatchSearch] = useState("");
  const [recentMatchesSort, setRecentMatchesSort] = useState<{
    key: "match" | "start" | "duration" | "outcome" | "score" | "kills" | "patch" | "league" | "averageRank" | "parsedData";
    direction: "asc" | "desc";
  }>({ key: "start", direction: "desc" });

  const sortedPlayerUsage = useMemo(() => {
    const needle = playerSearch.trim().toLowerCase();
    const rows = [...(query.data?.playerUsage ?? [])].filter((player) =>
      !needle ? true : (player.personaname ?? String(player.playerId ?? "")).toLowerCase().includes(needle)
    );
    rows.sort((left, right) => {
      let compare = 0;
      switch (playerUsageSort.key) {
        case "player":
          compare = (left.personaname ?? String(left.playerId ?? "")).localeCompare(
            right.personaname ?? String(right.playerId ?? "")
          );
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
  }, [playerSearch, playerUsageSort, query.data?.playerUsage]);

  const sortedRecentMatches = useMemo(() => {
    const needle = matchSearch.trim().toLowerCase();
    const rows = [...(query.data?.recentMatches ?? [])].filter((match) => {
      if (!needle) return true;
      return (
        String(match.matchId).includes(needle) ||
        (match.league ?? "").toLowerCase().includes(needle) ||
        (match.patch ?? "").toLowerCase().includes(needle)
      );
    });
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
          compare =
            ((left.radiantScore ?? 0) + (left.direScore ?? 0)) - ((right.radiantScore ?? 0) + (right.direScore ?? 0));
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
        case "averageRank":
          compare = (left.averageRankTier ?? -1) - (right.averageRankTier ?? -1);
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
  }, [matchSearch, query.data?.recentMatches, recentMatchesSort]);

  const playerUsagePagination = usePagination(sortedPlayerUsage.length, 20, [20, 50, 100]);
  const recentMatchesPagination = usePagination(sortedRecentMatches.length, 20, [20, 50, 100]);
  const pagedPlayerUsage = playerUsagePagination.paged(sortedPlayerUsage);
  const pagedRecentMatches = recentMatchesPagination.paged(sortedRecentMatches);
  const heroLeagues = query.data?.availableLeagues ?? [];
  const rankDistribution = query.data?.rankDistribution ?? [];
  const commonItemBuilds = query.data?.commonItemBuilds ?? [];
  const itemBuildTree = useMemo(() => buildItemTree(commonItemBuilds), [commonItemBuilds]);
  const totalHistogramGames = useMemo(
    () => rankDistribution.reduce((sum, bucket) => sum + bucket.games, 0),
    [rankDistribution]
  );
  const maxDistributionGames = Math.max(...rankDistribution.map((bucket) => bucket.games), 0);
  const distributionBuckets = useMemo(() => {
    if (rankDistribution.length > 0) return rankDistribution;
    return heroRankSteps.map((step) => ({
      rankTier: step.tier,
      label: step.label,
      games: 0
    }));
  }, [rankDistribution]);
  const rankDistributionPath = useMemo(() => {
    if (distributionBuckets.length === 0) return null;
    const width = 100;
    const centerY = 50;
    const amplitude = 32;
    const upperPoints = distributionBuckets.map((bucket, index) => {
      const x = distributionBuckets.length === 1 ? width / 2 : (index / (distributionBuckets.length - 1)) * width;
      const normalizedHeight = maxDistributionGames > 0 ? (bucket.games / maxDistributionGames) * amplitude : 0;
      return { x, y: centerY - normalizedHeight };
    });
    const upperPath = buildSmoothDensityPath(upperPoints);
    const upperAreaPath = buildUpperDensityAreaPath(upperPoints, centerY);
    return { upperAreaPath, upperPath };
  }, [distributionBuckets, maxDistributionGames]);
  const selectedMinPercent = (draftMinRankPosition / Math.max(1, heroRankSteps.length - 1)) * 100;
  const selectedMaxPercent = (draftMaxRankPosition / Math.max(1, heroRankSteps.length - 1)) * 100;

  useEffect(() => {
    const nextLeague = searchParams.get("leagueId") ?? "all";
    const nextMin = rankTierToIndex(searchParams.get("minRankTier"), 0);
    const nextMax = rankTierToIndex(searchParams.get("maxRankTier"), heroRankSteps.length - 1);
    setLeagueFilter(nextLeague);
    setDraftMinRankIndex(nextMin);
    setDraftMaxRankIndex(nextMax);
    setDraftMinRankPosition(nextMin);
    setDraftMaxRankPosition(nextMax);
    setActiveMinRankIndex(nextMin);
    setActiveMaxRankIndex(nextMax);
  }, [searchParams]);

  const resetPages = () => {
    playerUsagePagination.resetPage();
    recentMatchesPagination.resetPage();
  };

  const updateScopeFilters = (next: { leagueId?: string; minRankIndex?: number; maxRankIndex?: number }) => {
    const nextLeague = next.leagueId ?? leagueFilter;
    const nextMinIndex = next.minRankIndex ?? activeMinRankIndex;
    const nextMaxIndex = next.maxRankIndex ?? activeMaxRankIndex;
    const params = new URLSearchParams();
    if (nextLeague !== "all") params.set("leagueId", nextLeague);
    if (heroRankSteps[nextMinIndex]?.tier > 0) params.set("minRankTier", String(heroRankSteps[nextMinIndex].tier));
    if (heroRankSteps[nextMaxIndex]?.tier < heroRankSteps[heroRankSteps.length - 1].tier) {
      params.set("maxRankTier", String(heroRankSteps[nextMaxIndex].tier));
    }
    setSearchParams(params);
  };

  const commitRankRange = (nextMinIndex = draftMinRankIndex, nextMaxIndex = draftMaxRankIndex) => {
    setActiveMinRankIndex(nextMinIndex);
    setActiveMaxRankIndex(nextMaxIndex);
    setDraftMinRankIndex(nextMinIndex);
    setDraftMaxRankIndex(nextMaxIndex);
    setDraftMinRankPosition(nextMinIndex);
    setDraftMaxRankPosition(nextMaxIndex);
    updateScopeFilters({ minRankIndex: nextMinIndex, maxRankIndex: nextMaxIndex });
    resetPages();
  };

  return (
    <Page
      title={
        query.data ? (
          <span className="page-title-with-icon">
            <IconImage src={query.data.heroIconUrl ?? query.data.heroPortraitUrl} alt={query.data.heroName} size="md" />
            <span>{query.data.heroName}</span>
          </span>
        ) : (
          `Hero ${params.heroId ?? ""}`
        )
      }
      aside={
        query.data ? (
          <div className="stack compact hero-page-tools">
            <div className="stack compact hero-filter-summary">
              <span className="muted-inline">
                {heroLeagues.find((league) => league.leagueId === query.data.activeFilters.leagueId)?.leagueName ?? "All leagues"}
              </span>
            </div>
            <div className="table-controls player-scope-controls">
              {heroLeagues.length > 0 ? (
                <label>
                  League
                  <select
                    value={leagueFilter}
                    onChange={(event) => {
                      const nextLeagueId = event.target.value;
                      setLeagueFilter(nextLeagueId);
                      updateScopeFilters({ leagueId: nextLeagueId });
                      resetPages();
                    }}
                  >
                    <option value="all">All leagues</option>
                    {heroLeagues.map((league) => (
                      <option key={league.leagueId} value={league.leagueId}>
                        {league.leagueName}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="rank-range-card">
              <div className="player-panel-header">
                <strong>Rank range</strong>
                <span className="muted-inline">
                  {heroRankSteps[roundRangePosition(draftMinRankPosition)]?.label} to{" "}
                  {heroRankSteps[roundRangePosition(draftMaxRankPosition)]?.label}
                </span>
              </div>
              <div className="rank-slider-shell">
                <div className="rank-distribution">
                  <svg className="rank-distribution-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <line x1="0" y1="50" x2="100" y2="50" className="rank-distribution-baseline" />
                    {rankDistributionPath ? (
                      <>
                        <path d={rankDistributionPath.upperAreaPath} className="rank-distribution-area" />
                        <path
                          d={rankDistributionPath.upperAreaPath}
                          className="rank-distribution-area"
                          transform="translate(0 100) scale(1 -1)"
                        />
                      </>
                    ) : null}
                  </svg>
                </div>
                <div className="dual-range-slider">
                  <span
                    className="dual-range-slider-selection"
                    style={{
                      left: `${selectedMinPercent}%`,
                      width: `${Math.max(0, selectedMaxPercent - selectedMinPercent)}%`
                    }}
                  />
                <input
                  type="range"
                  min={0}
                  max={heroRankSteps.length - 1}
                  step={0.01}
                  value={draftMinRankPosition}
                  onChange={(event) => {
                    const nextPosition = Math.min(Number(event.target.value), draftMaxRankPosition);
                    setDraftMinRankPosition(nextPosition);
                    setDraftMinRankIndex(roundRangePosition(nextPosition));
                  }}
                  onMouseUp={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                  onTouchEnd={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                  onKeyUp={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                />
                <input
                  type="range"
                  min={0}
                  max={heroRankSteps.length - 1}
                  step={0.01}
                  value={draftMaxRankPosition}
                  onChange={(event) => {
                    const nextPosition = Math.max(Number(event.target.value), draftMinRankPosition);
                    setDraftMaxRankPosition(nextPosition);
                    setDraftMaxRankIndex(roundRangePosition(nextPosition));
                  }}
                  onMouseUp={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                  onTouchEnd={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                  onKeyUp={() => commitRankRange(roundRangePosition(draftMinRankPosition), roundRangePosition(draftMaxRankPosition))}
                />
              </div>
              </div>
              <div className="rank-range-footer">
                <span className="muted-inline">{formatNumber(query.data.games)} total matches in current scope</span>
                <span className="muted-inline">{formatNumber(totalHistogramGames)} matches with known rank in the graph</span>
              </div>
            </div>
          </div>
        ) : null
      }
    >
      {query.isLoading ? <LoadingState label="Loading hero detail..." /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {query.data ? (
        <>
          <div className="settings-tabs" role="tablist" aria-label="Hero sections">
            {[
              ["overview", "Overview"],
              ["builds", "Builds"],
              ["players", "Players"],
              ["matches", "Matches"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`settings-tab ${activeTab === key ? "active" : ""}`}
                onClick={() => setActiveTab(key as HeroDetailTab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={activeTab === "overview" ? "tab-panel" : "tab-panel hidden"}>
            <MetricGrid
              items={[
                { label: "Source", value: query.data.source === "fresh" ? "Fresh fetch" : "Cache" },
                { label: "Local appearances", value: formatNumber(query.data.games) },
                { label: "Winrate", value: `${query.data.winrate}%` },
                { label: "Unique players", value: formatNumber(query.data.uniquePlayers) },
                {
                  label: "League scope",
                  value:
                    heroLeagues.find((league) => league.leagueId === query.data.activeFilters.leagueId)?.leagueName ??
                    "All leagues"
                },
                {
                  label: "Rank scope",
                  value: `${heroRankSteps[activeMinRankIndex]?.label} to ${heroRankSteps[activeMaxRankIndex]?.label}`
                },
                {
                  label: "Avg first core",
                  value: formatDuration(query.data.averageFirstCoreItemTimingSeconds)
                }
              ]}
            />

            <div className="two-column">
              <Card title="Rank buckets in current scope">
                <div className="stack compact">
                  <div className="player-metrics">
                    {query.data.mmrBreakdown.map((bucket) => (
                      <div key={bucket.label}>
                        <span className="eyebrow">{bucket.label}</span>
                        <strong>{formatNumber(bucket.games)} games</strong>
                        <span className="muted-inline">
                          {formatNumber(bucket.wins)} wins | {bucket.winrate}% winrate
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="muted-inline">
                    Rank filtering affects the full hero page. Unknown player ranks are excluded whenever a rank range is active.
                  </p>
                </div>
              </Card>
            </div>
          </div>

          <div className={activeTab === "players" ? "tab-panel" : "tab-panel hidden"}>
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
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={playerSearch}
                      onChange={(event) => {
                        setPlayerSearch(event.target.value);
                        playerUsagePagination.resetPage();
                      }}
                      placeholder="Player"
                    />
                  </label>
                </div>
              }
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
                        <Link
                          to={`/players/${player.playerId}?${new URLSearchParams({
                            heroId: String(heroId ?? query.data?.heroId ?? 0),
                            tab: "matches"
                          }).toString()}`}
                        >
                          {player.personaname ?? player.playerId}
                        </Link>
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

          <div className={activeTab === "builds" ? "tab-panel" : "tab-panel hidden"}>
            <div className="settings-tabs" role="tablist" aria-label="Hero build sections">
              {[
                ["skills", "Skill build"],
                ["items", "Item build"]
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`settings-tab ${activeBuildTab === key ? "active" : ""}`}
                  onClick={() => setActiveBuildTab(key as HeroBuildTab)}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeBuildTab === "skills" ? (
              <Card title="Skill build">
                {query.data.commonSkillBuilds.length === 0 ? (
                  <p className="muted-inline">No skill order data has been normalized for this hero yet.</p>
                ) : (
                  <div className="stack compact">
                    <p className="muted-inline">
                      {formatNumber(query.data.buildSamples.skillMatches)} matches currently contribute to the skill build sample.
                    </p>
                    <p className="muted-inline">Only locally stored matches that include normalized skill-order telemetry are counted here.</p>
                    {query.data.commonSkillBuilds.map((build, index) => (
                      <div key={`${build.sequence.map((entry) => `${entry.level}-${entry.abilityId}`).join("-")}-${index}`} className="combo-card build-tree-card">
                        <div className="player-panel-header">
                          <strong>Build #{index + 1}</strong>
                          <span className="muted-inline">
                            {formatNumber(build.games)} games | {build.winrate}% winrate
                          </span>
                        </div>
                        <div className="build-tree-row">
                          {build.sequence.filter((ability) => Boolean(ability.imageUrl)).map((ability, levelIndex) => (
                            <div
                              key={`${ability.abilityId}-${levelIndex}`}
                              className="build-tree-node skill-build-chip"
                              title={`${ability.abilityName} · order ${levelIndex + 1}`}
                            >
                              <IconImage src={ability.imageUrl} alt={ability.abilityName} size="sm" />
                              <span className="skill-order-label">{levelIndex + 1}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}

            {activeBuildTab === "items" ? (
              <Card title="Item build">
                {itemBuildTree.length === 0 ? (
                  <EmptyState label="No item build data stored for this hero yet." />
                ) : (
                  <div className="stack compact">
                    <p className="muted-inline">
                      {formatNumber(query.data.buildSamples.itemMatches)} matches currently contribute to the item build sample.
                    </p>
                    <p className="muted-inline">Only matches with stored purchase-log telemetry contribute to this item tree.</p>
                    <div className="item-tree-root">
                      {itemBuildTree.map((node) => (
                        <HeroItemBuildBranch key={node.key} node={node} />
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ) : null}
          </div>

          <div className={activeTab === "matches" ? "tab-panel" : "tab-panel hidden"}>
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
              extra={
                <div className="table-controls">
                  <label>
                    Search
                    <input
                      type="search"
                      value={matchSearch}
                      onChange={(event) => {
                        setMatchSearch(event.target.value);
                        recentMatchesPagination.resetPage();
                      }}
                      placeholder="Match, patch, league"
                    />
                  </label>
                </div>
              }
              empty={<EmptyState label="No stored matches found for this hero." />}
            >
              <DataTable
                rows={pagedRecentMatches}
                getRowKey={(match) => String(match.matchId)}
                rowClassName={(match) =>
                  match.heroWin === true ? "row-win" : match.heroWin === false ? "row-loss" : "row-unknown"
                }
                sortState={recentMatchesSort}
                onSortChange={(key) =>
                  setRecentMatchesSort((current) => ({
                    key: key as "match" | "start" | "duration" | "outcome" | "score" | "kills" | "patch" | "league" | "averageRank" | "parsedData",
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
                      match.heroWin === null ? "Unknown" : match.heroWin ? "Win" : "Loss"
                  },
                  {
                    key: "score",
                    header: "Score",
                    sortable: true,
                    cell: (match) => `${formatNumber(match.radiantScore)} - ${formatNumber(match.direScore)}`
                  },
                  { key: "kills", header: "Total kills", sortable: true, cell: (match) => formatNumber(match.totalKills) },
                  {
                    key: "averageRank",
                    header: "Avg rank",
                    sortable: true,
                    cell: (match) => (
                      <div className="stack compact">
                        <span>{formatRankTier(match.averageRankTier)}</span>
                        <span className="muted-inline">
                          R: {formatRankTier(match.radiantAverageRankTier)} | D: {formatRankTier(match.direAverageRankTier)}
                        </span>
                      </div>
                    )
                  },
                  { key: "patch", header: "Patch", sortable: true, cell: (match) => match.patch ?? "Unknown" },
                  {
                    key: "league",
                    header: "League",
                    sortable: true,
                    cell: (match) =>
                      match.leagueId ? <Link to={`/leagues/${match.leagueId}`}>{match.league ?? `League ${match.leagueId}`}</Link> : "Public"
                  },
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
          </div>
        </>
      ) : null}
    </Page>
  );
}
