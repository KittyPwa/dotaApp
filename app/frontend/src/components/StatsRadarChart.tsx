import { EmptyState } from "./State";

type RadarStat = { key: string; label: string; value: number; higherIsBetter: boolean };
type RadarPlayer = { playerId: number; personaname: string | null; comparisonStats: RadarStat[] };

const radarColors = ["#2d9cdb", "#f2994a", "#27ae60", "#eb5757", "#9b51e0", "#00a896"];
const singlePlayerBaselines: Record<string, number> = {
  impact: 60,
  mvpRate: 100,
  laneWinRate: 100,
  kills: 15,
  assists: 30,
  gpm: 900,
  xpm: 1100,
  lastHits: 400,
  heroDamage: 50000,
  heroHealing: 18000,
  towerDamage: 15000,
  wardsPlaced: 30,
  wardEfficiency: 100,
  observerWardsDestroyed: 10,
  campStacked: 20,
  courierKills: 5,
  winrate: 100
};

function formatRadarValue(value: number) {
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const closedPoints = [...points, points[0], points[1]];
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index <= points.length; index += 1) {
    const current = closedPoints[index];
    const next = closedPoints[index + 1];
    const controlX = (current.x + next.x) / 2;
    const controlY = (current.y + next.y) / 2;
    path += ` Q ${current.x} ${current.y} ${controlX} ${controlY}`;
  }
  return `${path} Z`;
}

export function StatsRadarChart({
  players,
  compact = false,
  hiddenPlayerIds = [],
  onTogglePlayer
}: {
  players: RadarPlayer[];
  compact?: boolean;
  hiddenPlayerIds?: number[];
  onTogglePlayer?: (playerId: number) => void;
}) {
  const colorByPlayerId = new Map(players.map((player, index) => [player.playerId, radarColors[index % radarColors.length]]));
  const visiblePlayers = players.filter((player) => !hiddenPlayerIds.includes(player.playerId));
  const metrics = visiblePlayers[0]?.comparisonStats ?? players[0]?.comparisonStats ?? [];
  if (players.length === 0 || metrics.length < 3) {
    return <EmptyState label="Not enough local stat data to draw a radar chart yet." />;
  }

  const center = { x: 380, y: 260 };
  const radius = compact ? 142 : 170;
  const labelRadius = compact ? 194 : 220;
  const ringCount = 4;
  const maxByMetric = new Map(
    metrics.map((metric) => [
      metric.key,
      visiblePlayers.length === 1
        ? singlePlayerBaselines[metric.key] ?? Math.max(1, metric.value)
        : Math.max(1, ...visiblePlayers.map((player) => player.comparisonStats.find((entry) => entry.key === metric.key)?.value ?? 0))
    ])
  );
  const pointFor = (index: number, valueRadius: number) => {
    const angle = -Math.PI / 2 + (index / metrics.length) * Math.PI * 2;
    return {
      x: center.x + Math.cos(angle) * valueRadius,
      y: center.y + Math.sin(angle) * valueRadius
    };
  };

  return (
    <div className="radar-shell">
      <svg className={`radar-chart ${compact ? "compact" : ""}`} viewBox="0 0 760 540" role="img" aria-label="Radar chart">
        {[...Array(ringCount)].map((_, ringIndex) => {
          const ringRadius = ((ringIndex + 1) / ringCount) * radius;
          const ringPoints = metrics.map((_, index) => pointFor(index, ringRadius));
          return (
            <polygon
              key={`ring-${ringIndex}`}
              points={ringPoints.map((point) => `${point.x},${point.y}`).join(" ")}
              className="radar-ring"
            />
          );
        })}
        {metrics.map((metric, index) => {
          const end = pointFor(index, radius);
          const label = pointFor(index, labelRadius);
          return (
            <g key={metric.key}>
              <line x1={center.x} y1={center.y} x2={end.x} y2={end.y} className="radar-axis" />
              <text
                x={label.x}
                y={label.y}
                className="radar-axis-label"
                textAnchor={label.x < center.x - 16 ? "end" : label.x > center.x + 16 ? "start" : "middle"}
                dominantBaseline="middle"
              >
                {metric.label}
              </text>
            </g>
          );
        })}
        {visiblePlayers.map((player, playerIndex) => {
          const color = colorByPlayerId.get(player.playerId) ?? radarColors[playerIndex % radarColors.length];
          const points = metrics.map((metric, metricIndex) => {
            const value = player.comparisonStats.find((entry) => entry.key === metric.key)?.value ?? 0;
            const max = maxByMetric.get(metric.key) ?? 1;
            return pointFor(metricIndex, Math.max(0.04, Math.min(1, value / max)) * radius);
          });
          const path = buildSmoothPath(points);
          return (
            <g key={player.playerId} className={onTogglePlayer ? "radar-player-group interactive" : "radar-player-group"}>
              <path
                d={path}
                fill={color}
                stroke={color}
                className="radar-player-area"
                onClick={() => onTogglePlayer?.(player.playerId)}
              />
              {points.map((point, metricIndex) => {
                const metric = metrics[metricIndex];
                const value = player.comparisonStats.find((entry) => entry.key === metric.key)?.value ?? 0;
                return (
                  <circle
                    key={`${player.playerId}-${metric.key}`}
                    cx={point.x}
                    cy={point.y}
                    r="4.5"
                    fill={color}
                    onClick={() => onTogglePlayer?.(player.playerId)}
                  >
                    <title>
                      {(player.personaname ?? `Player ${player.playerId}`)} - {metric.label}: {formatRadarValue(value)}
                    </title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="radar-legend">
        {players.map((player, index) => (
          <button
            key={player.playerId}
            type="button"
            className={`radar-legend-item ${hiddenPlayerIds.includes(player.playerId) ? "muted" : ""}`}
            onClick={() => onTogglePlayer?.(player.playerId)}
            disabled={!onTogglePlayer}
          >
            <span className="radar-legend-swatch" style={{ background: colorByPlayerId.get(player.playerId) ?? radarColors[index % radarColors.length] }} />
            {player.personaname ?? `Player ${player.playerId}`}
          </button>
        ))}
      </div>
      <p className="muted-inline">
        {visiblePlayers.length === 0
          ? "All players are hidden. Use the legend below to show them again."
          : visiblePlayers.length === 1
          ? "Single-player view uses fixed benchmark ranges so the shape remains readable."
          : "Each axis is scaled against the best selected visible player for that stat, so the chart compares relative strengths within this group."}
      </p>
    </div>
  );
}
