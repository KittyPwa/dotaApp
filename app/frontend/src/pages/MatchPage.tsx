import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, ErrorState, LoadingState } from "../components/State";
import { useMatch, useRefreshMatch, useSettings } from "../hooks/useQueries";
import { formatDate, formatDuration, formatNumber } from "../lib/format";

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function getKdaRatio(kills: number | null, deaths: number | null, assists: number | null) {
  const total = (kills ?? 0) + (assists ?? 0);
  const safeDeaths = Math.max(deaths ?? 0, 1);
  return (total / safeDeaths).toFixed(2);
}

function formatTimelineMinute(minute: number) {
  return String(minute);
}

function cumulativeTimeline(values: number[]) {
  let running = 0;
  return values.map((value) => {
    running += value;
    return running;
  });
}

function isLikelyCumulativeTimeline(values: number[]) {
  if (values.length < 3) return false;
  let decreases = 0;
  for (let index = 1; index < values.length; index += 1) {
    if ((values[index] ?? 0) < (values[index - 1] ?? 0)) decreases += 1;
  }
  return decreases / Math.max(1, values.length - 1) < 0.08;
}

function perMinuteTimeline(values: number[]) {
  if (!isLikelyCumulativeTimeline(values)) return values;
  return values.map((value, index) => (index === 0 ? value : Math.max(0, value - (values[index - 1] ?? 0))));
}

function totalTimeline(values: number[]) {
  return isLikelyCumulativeTimeline(values) ? values : cumulativeTimeline(values);
}

const xpForLevel = [
  0, 230, 600, 1080, 1660, 2260, 2980, 3730, 4620, 5550, 6525, 7530, 8580, 9805, 11055, 12330, 13630, 14955,
  16455, 18045, 19645, 21495, 23595, 25945, 28545, 32045, 36545, 42045, 48545, 55045
];

const expensiveItemCosts: Record<string, number> = {
  abyssal_blade: 6250,
  aeon_disk: 3000,
  aether_lens: 2275,
  aghanim_scepter: 4200,
  aghanim_shard: 1400,
  armlet: 2500,
  assault: 5125,
  bfury: 4100,
  black_king_bar: 4050,
  blink: 2250,
  bloodstone: 4400,
  bloodthorn: 6625,
  boots_of_bearing: 4125,
  butterfly: 5450,
  crimson_guard: 3725,
  cyclone: 2725,
  dagon: 2850,
  desolator: 3500,
  diffusal_blade: 2500,
  disperser: 6100,
  dragon_lance: 1900,
  echo_sabre: 2700,
  eternal_shroud: 3300,
  ethereal_blade: 4650,
  force_staff: 2200,
  gleipnir: 5750,
  glimmer_cape: 2150,
  greater_crit: 5150,
  guardian_greaves: 5050,
  heart: 5200,
  heavens_halberd: 3550,
  hurricane_pike: 4450,
  invis_sword: 3000,
  kaya: 2100,
  kaya_and_sange: 4200,
  linken_sphere: 4800,
  manta: 4650,
  maelstrom: 2950,
  mage_slayer: 2825,
  mask_of_madness: 1900,
  mekansm: 1775,
  mjollnir: 5500,
  monkey_king_bar: 4700,
  lesser_crit: 1950,
  nullifier: 4375,
  orchid: 3275,
  pipe: 3725,
  radiance: 4700,
  refresher: 5000,
  sange: 2100,
  sange_and_yasha: 4200,
  satanic: 5050,
  sheepstick: 5200,
  shivas_guard: 5175,
  silver_edge: 5450,
  skadi: 5300,
  solar_crest: 2600,
  sphere: 4800,
  travel_boots: 2500,
  ultimate_scepter: 4200,
  veil_of_discord: 1725,
  yasha: 2100,
  yasha_and_kaya: 4200
};

const completedItemSlugs = new Set([
  "abyssal_blade",
  "aeon_disk",
  "aether_lens",
  "aghanim_scepter",
  "armlet",
  "assault",
  "bfury",
  "black_king_bar",
  "blink",
  "bloodstone",
  "bloodthorn",
  "boots_of_bearing",
  "butterfly",
  "crimson_guard",
  "cyclone",
  "dagon",
  "desolator",
  "diffusal_blade",
  "disperser",
  "dragon_lance",
  "echo_sabre",
  "eternal_shroud",
  "ethereal_blade",
  "force_staff",
  "gleipnir",
  "glimmer_cape",
  "greater_crit",
  "guardian_greaves",
  "heart",
  "heavens_halberd",
  "hurricane_pike",
  "invis_sword",
  "kaya_and_sange",
  "linken_sphere",
  "manta",
  "maelstrom",
  "mage_slayer",
  "mask_of_madness",
  "mekansm",
  "mjollnir",
  "monkey_king_bar",
  "nullifier",
  "orchid",
  "pipe",
  "radiance",
  "refresher",
  "sange_and_yasha",
  "satanic",
  "sheepstick",
  "shivas_guard",
  "silver_edge",
  "skadi",
  "solar_crest",
  "travel_boots",
  "ultimate_scepter",
  "veil_of_discord",
  "yasha_and_kaya"
]);

const itemSlugOverrides: Record<string, string> = {
  aghanims_scepter: "aghanim_scepter",
  aghanims_shard: "aghanim_shard",
  aghanims_blessing: "ultimate_scepter_2",
  aghanims_blessing_recipe: "recipe_ultimate_scepter_2",
  aghanim_s_blessing: "ultimate_scepter_2",
  aghanim_s_blessing_recipe: "recipe_ultimate_scepter_2",
  aghanim_s_scepter: "ultimate_scepter",
  aghanim_s_shard: "aghanim_shard",
  blink_dagger: "blink",
  battle_fury: "bfury",
  butterfly: "butterfly",
  black_king_bar: "black_king_bar",
  chrysalis: "lesser_crit",
  crystalis: "lesser_crit",
  crystalys: "lesser_crit",
  daedalus: "greater_crit",
  desolator: "desolator",
  dust_of_appearance: "dust",
  dragon_lance: "dragon_lance",
  eye_of_skadi: "skadi",
  hurricane_pike: "hurricane_pike",
  lincoln_s_sphere: "sphere",
  linken_s_sphere: "sphere",
  linkens_sphere: "sphere",
  linken_sphere: "sphere",
  monkey_king_bar: "monkey_king_bar",
  observer: "ward_observer",
  observer_ward: "ward_observer",
  portal_scroll: "tpscroll",
  scroll_of_town_portal: "tpscroll",
  sentry: "ward_sentry",
  sentry_ward: "ward_sentry",
  shadow_blade: "invis_sword",
  smoke: "smoke_of_deceit",
  teleport_scroll: "tpscroll",
  town_portal_scroll: "tpscroll",
  tp_scroll: "tpscroll",
  swift_blink: "swift_blink"
};

function normalizeItemSlug(itemName: string) {
  const normalized = itemName
    .replace(/^item_/i, "")
    .trim()
    .toLowerCase()
    .replace(/['’]s/g, "s")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return itemSlugOverrides[normalized] ?? normalized;
}

function getItemImageUrl(itemName: string) {
  const slug = normalizeItemSlug(itemName);
  return `/api/assets/opendota?path=${encodeURIComponent(`/apps/dota2/images/dota_react/items/${slug}.png`)}`;
}

function getKnownItemCost(itemName: string) {
  return expensiveItemCosts[normalizeItemSlug(itemName)] ?? null;
}

function isCoreTimelineItem(itemName: string) {
  const slug = normalizeItemSlug(itemName);
  const cost = expensiveItemCosts[slug] ?? null;
  return completedItemSlugs.has(slug) || (cost !== null && cost > 1500);
}

const ignoredInventoryItemSlugs = new Set([
  "tango",
  "enchanted_mango",
  "clarity",
  "faerie_fire",
  "flask",
  "ward_observer",
  "ward_sentry",
  "ward_dispenser",
  "observer",
  "observer_ward",
  "ward_observer",
  "sentry",
  "sentry_ward",
  "ward_sentry",
  "smoke_of_deceit",
  "smoke",
  "dust",
  "dust_of_appearance",
  "tpscroll",
  "tp_scroll",
  "town_portal_scroll",
  "blood_grenade",
  "cheese",
  "aegis",
  "divine_rapier_recipe"
]);

const teleportItemSlugs = new Set(["tpscroll"]);
const startingStackCounts: Record<string, number> = {
  tango: 3,
  enchanted_mango: 1,
  ward_observer: 1,
  ward_sentry: 1,
  blood_grenade: 1,
  clarity: 1,
  faerie_fire: 1,
  iron_branch: 1,
  circlet: 1,
  magic_stick: 1,
  gauntlets: 1,
  slippers: 1,
  mantle: 1
};

function getLevelMarkers(cumulativeXp: number[]) {
  const markers: Array<{ index: number; value: number; label: string }> = [];
  for (let level = 2; level <= xpForLevel.length; level += 1) {
    const requiredXp = xpForLevel[level - 1];
    const index = cumulativeXp.findIndex((value) => value >= requiredXp);
    if (index >= 0) {
      markers.push({ index, value: cumulativeXp[index], label: `L${level}` });
    }
  }
  return markers;
}

function getLevelFromXp(totalXp: number | null) {
  if (totalXp === null) return null;
  let level = 1;
  for (let index = 0; index < xpForLevel.length; index += 1) {
    if (totalXp >= xpForLevel[index]) level = index + 1;
  }
  return level;
}

function getTimelineValueAt(values: number[], minuteIndex: number) {
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.max(0, minuteIndex))] ?? null;
}

function getCssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function getTimelinePalette(side: "radiant" | "dire") {
  if (side === "radiant") {
    return [
      getCssVar("--timeline-radiant-1", "#2ecc71"),
      getCssVar("--timeline-radiant-2", "#27ae60"),
      getCssVar("--timeline-radiant-3", "#16a085"),
      getCssVar("--timeline-radiant-4", "#1abc9c"),
      getCssVar("--timeline-radiant-5", "#58d68d")
    ];
  }

  return [
    getCssVar("--timeline-dire-1", "#e74c3c"),
    getCssVar("--timeline-dire-2", "#c0392b"),
    getCssVar("--timeline-dire-3", "#d35400"),
    getCssVar("--timeline-dire-4", "#e67e22"),
    getCssVar("--timeline-dire-5", "#ff7675")
  ];
}

type TimelinePointSeries = {
  key: string;
  label: string;
  iconUrl?: string | null;
  color: string;
  values: number[];
  plotValues?: number[];
  strokeDasharray?: string;
  strokeWidth?: number;
  opacity?: number;
};

type TimelineEventMarker = {
  key: string;
  label: string;
  index: number;
  yPercent: number;
  iconUrl?: string | null;
  color: string;
};

type TimelineMode = "perMinute" | "cumulative";

type TimelineMarkerSeries = {
  key: string;
  color: string;
  markers: Array<{ index: number; value: number; label: string }>;
};

function TimelinePlot({
  title,
  series,
  markerSeries = [],
  eventMarkers = [],
  timelineMinutes,
  hoveredIndex,
  onHoveredIndexChange
}: {
  title: string;
  series: TimelinePointSeries[];
  markerSeries?: TimelineMarkerSeries[];
  eventMarkers?: TimelineEventMarker[];
  timelineMinutes: number[];
  hoveredIndex: number | null;
  onHoveredIndexChange: (index: number | null) => void;
}) {
  const width = 860;
  const height = 320;
  const innerHeight = height - 26;
  const lengths = series.map((entry) => entry.values.length);
  const maxLength = Math.max(...lengths, 0);
  const allValues = series.flatMap((entry) => entry.plotValues ?? entry.values);
  const maxValue = Math.max(...allValues, 1);

  if (maxLength < 2) {
    return (
      <div className="timeline-plot-panel">
        <div className="timeline-panel-title">{title}</div>
        <p className="muted-inline">No timeline data available for this view.</p>
      </div>
    );
  }

  const effectiveIndex = hoveredIndex === null ? maxLength - 1 : Math.min(maxLength - 1, Math.max(0, hoveredIndex));
  const xForIndex = (index: number) => (index / (maxLength - 1)) * width;
  const yForValue = (value: number) => height - (value / maxValue) * (innerHeight - 20) - 12;
  const verticalMarkers = Array.from({ length: Math.floor((maxLength - 1) / 10) }, (_, index) => (index + 1) * 10).filter(
    (index) => index < maxLength
  );
  const horizontalMarkers = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="timeline-plot-panel">
      <div className="timeline-panel-title">{title}</div>
      <svg
        className="timeline-chart timeline-chart-lg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * width;
          const index = Math.round((Math.max(0, Math.min(width, x)) / width) * (maxLength - 1));
          onHoveredIndexChange(index);
        }}
        onMouseLeave={() => onHoveredIndexChange(null)}
      >
        {horizontalMarkers.map((marker) => {
          const y = height - marker * (innerHeight - 20) - 12;
          return (
            <line
              key={`h-${title}-${marker}`}
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="rgba(23, 32, 42, 0.12)"
              strokeDasharray="4 6"
            />
          );
        })}
        {verticalMarkers.map((minuteIndex) => {
          const x = xForIndex(minuteIndex);
          return (
            <g key={`v-${title}-${minuteIndex}`}>
              <line x1={x} x2={x} y1={0} y2={height} stroke="rgba(23, 32, 42, 0.12)" strokeDasharray="4 6" />
              <text x={x + 4} y={16} fill="rgba(23,32,42,0.55)" fontSize="12">
                {formatTimelineMinute(timelineMinutes[minuteIndex] ?? minuteIndex)}
              </text>
            </g>
          );
        })}
        {series.map((entry) => {
          const chartValues = entry.plotValues ?? entry.values;
          const points = chartValues.map((value, pointIndex) => `${xForIndex(pointIndex)},${yForValue(value)}`).join(" ");
          const hoveredValue = entry.values[effectiveIndex];
          const hoveredPlotValue = chartValues[effectiveIndex];
          return (
            <g key={`${entry.key}-${title}`}>
              <polyline
                fill="none"
                stroke={entry.color}
                strokeWidth={entry.strokeWidth ?? 3}
                strokeDasharray={entry.strokeDasharray}
                strokeOpacity={entry.opacity ?? 1}
                points={points}
              />
              {hoveredValue !== undefined && hoveredPlotValue !== undefined ? (
                <circle cx={xForIndex(effectiveIndex)} cy={yForValue(hoveredPlotValue)} r="4" fill={entry.color} />
              ) : null}
            </g>
          );
        })}
        {markerSeries.map((entry) =>
          entry.markers.map((marker) => (
            <g key={`${entry.key}-${marker.label}-${marker.index}`}>
              <circle cx={xForIndex(marker.index)} cy={yForValue(marker.value)} r="3.5" fill="#fff" stroke={entry.color} strokeWidth="2" />
              <text x={xForIndex(marker.index) + 5} y={Math.max(14, yForValue(marker.value) - 5)} fill={entry.color} fontSize="10">
                {marker.label}
              </text>
            </g>
          ))
        )}
        {eventMarkers.map((marker) => {
          const x = xForIndex(Math.min(maxLength - 1, Math.max(0, marker.index)));
          const y = height * marker.yPercent;
          return (
            <g key={marker.key}>
              <title>{marker.label}</title>
              {marker.iconUrl ? (
                <image href={marker.iconUrl} x={x - 9} y={y - 9} width="18" height="18" opacity="0.92" />
              ) : (
                <circle cx={x} cy={y} r="4" fill={marker.color} />
              )}
              <line x1={x} x2={x} y1={y - 10} y2={height} stroke={marker.color} strokeOpacity="0.22" strokeDasharray="2 5" />
            </g>
          );
        })}
        <line
          x1={xForIndex(effectiveIndex)}
          x2={xForIndex(effectiveIndex)}
          y1={0}
          y2={height}
          stroke="rgba(23, 32, 42, 0.4)"
          strokeWidth="2"
        />
        <g>
          <rect
            x={Math.min(width - 58, Math.max(2, xForIndex(effectiveIndex) - 29))}
            y={2}
            width={56}
            height={18}
            rx={6}
            fill="rgba(23, 32, 42, 0.86)"
          />
          <text
            x={Math.min(width - 30, Math.max(30, xForIndex(effectiveIndex)))}
            y={15}
            textAnchor="middle"
            fill="#fff"
            fontSize="11"
            fontWeight="700"
          >
            {formatTimelineMinute(timelineMinutes[effectiveIndex] ?? effectiveIndex)}
          </text>
        </g>
        {series.map((entry, entryIndex) => {
          const chartValues = entry.plotValues ?? entry.values;
          const hoveredValue = entry.values[effectiveIndex];
          const hoveredPlotValue = chartValues[effectiveIndex];
          if (hoveredValue === undefined || hoveredPlotValue === undefined) return null;

          const x = xForIndex(effectiveIndex);
          const y = yForValue(hoveredPlotValue);
          const labelX = x > width - 88 ? x - 70 : x + 8;
          const labelY = Math.max(28, Math.min(height - 8, y - 8 + (entryIndex % 3) * 14));
          const iconX = labelX;
          const textX = entry.iconUrl ? labelX + 17 : labelX + 10;

          return (
            <g key={`${entry.key}-${title}-hover-label`}>
              {entry.iconUrl ? (
                <image href={entry.iconUrl} x={iconX} y={labelY - 13} width="14" height="14" opacity="0.96" />
              ) : (
                <circle cx={iconX + 4} cy={labelY - 5} r="4" fill={entry.color} stroke="#fff" strokeWidth="1.5" />
              )}
              <text
                x={textX}
                y={labelY}
                fill={entry.color}
                stroke="#fff"
                strokeWidth="3"
                paintOrder="stroke fill"
                fontSize="10"
                fontWeight="800"
              >
                {formatNumber(hoveredValue)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TeamTimelinePanel({
  radiantValues,
  direValues,
  timelineMinutes,
  selectedMode,
  title
}: {
  radiantValues: number[];
  direValues: number[];
  timelineMinutes: number[];
  selectedMode: TimelineMode;
  title?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const radiantStroke = getCssVar("--team-radiant-strong", "rgba(39, 174, 96, 0.95)");
  const direStroke = getCssVar("--team-dire-strong", "rgba(192, 57, 43, 0.95)");
  const activeRadiantValues = radiantValues;
  const activeDireValues = direValues;
  const effectiveIndex =
    hoveredIndex === null
      ? Math.max(activeRadiantValues.length, activeDireValues.length) - 1
      : hoveredIndex;
  const summarySeries = [
    {
      key: "radiant",
      label: "Radiant",
      color: radiantStroke,
      value: activeRadiantValues[effectiveIndex] ?? activeRadiantValues[activeRadiantValues.length - 1] ?? 0
    },
    {
      key: "dire",
      label: "Dire",
      color: direStroke,
      value: activeDireValues[effectiveIndex] ?? activeDireValues[activeDireValues.length - 1] ?? 0
    }
  ];

  return (
    activeRadiantValues.length === 0 && activeDireValues.length === 0 ? (
      <p className="muted-inline">No timeline data available for this tab.</p>
    ) : (
      <div className="stack compact">
        <div className="timeline-hover-header">
          <strong>
            {formatTimelineMinute(
              timelineMinutes[
                hoveredIndex === null ? Math.max(activeRadiantValues.length, activeDireValues.length) - 1 : Math.max(0, hoveredIndex)
              ] ??
                (hoveredIndex === null ? Math.max(activeRadiantValues.length, activeDireValues.length) - 1 : hoveredIndex)
            )}
          </strong>
        </div>
        <div className="timeline-legend">
          {summarySeries.map((entry) => (
            <div key={entry.key} className="timeline-legend-item">
              <span className="timeline-legend-swatch" style={{ backgroundColor: entry.color }} />
              <strong>{entry.label}</strong>
              <span className="timeline-row-values compact single">
                <span>{formatNumber(entry.value)}</span>
              </span>
            </div>
          ))}
        </div>
        <TimelinePlot
          title={title ?? (selectedMode === "perMinute" ? "Per minute" : "Cumulative")}
          series={[
            {
              key: selectedMode === "perMinute" ? "radiant-per-minute" : "radiant-cumulative",
              label: "Radiant",
              color: radiantStroke,
              values: activeRadiantValues
            },
            {
              key: selectedMode === "perMinute" ? "dire-per-minute" : "dire-cumulative",
              label: "Dire",
              color: direStroke,
              values: activeDireValues
            }
          ]}
          timelineMinutes={timelineMinutes}
          hoveredIndex={hoveredIndex}
          onHoveredIndexChange={setHoveredIndex}
        />
      </div>
    )
  );
}

function TeamTimelineOverlayPanel({
  getValues,
  players,
  timelineMinutes,
  selectedTabs
}: {
  getValues: (tab: Exclude<TeamTimelineTab, "items">, mode: TimelineMode) => { radiant: number[]; dire: number[] };
  players: TimelinePlayer[];
  timelineMinutes: number[];
  selectedTabs: OverlaySelection[];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const selectedMetricTabs = selectedTabs.filter((entry) => entry.tab !== "items") as Array<{
    tab: Exclude<TeamTimelineTab, "items">;
    mode: TimelineMode;
  }>;
  const allSeries = selectedMetricTabs.flatMap((selection) => {
    const tab = timelineTabs.find((entry) => entry.key === selection.tab);
    const values = getValues(selection.tab, selection.mode);
    const radiantValues = values.radiant;
    const direValues = values.dire;
    const color = getTimelineMetricColor(selection.tab);
    return [
      {
        key: `team-overlay-${selection.tab}-${selection.mode}-radiant`,
        label: `${tab?.label ?? selection.tab} Radiant`,
        color,
        values: radiantValues,
        plotValues: normalizeTimelineForOverlay(radiantValues),
        strokeDasharray: selection.mode === "cumulative" ? "8 5" : undefined,
        strokeWidth: 2.8
      },
      {
        key: `team-overlay-${selection.tab}-${selection.mode}-dire`,
        label: `${tab?.label ?? selection.tab} Dire`,
        color,
        values: direValues,
        plotValues: normalizeTimelineForOverlay(direValues),
        strokeDasharray: selection.mode === "cumulative" ? "8 5 2 5" : "2 6",
        strokeWidth: 2.8
      }
    ];
  });
  const maxLength = Math.max(...allSeries.map((entry) => entry.values.length), timelineMinutes.length, 0);
  const effectiveIndex = hoveredIndex === null ? maxLength - 1 : Math.min(maxLength - 1, Math.max(0, hoveredIndex));
  const itemSelections = selectedTabs.filter((entry) => entry.tab === "items");
  const itemMarkers = itemSelections.length > 0
    ? players.flatMap((player, playerIndex) =>
        getItemTimingEvents(player, itemSelections.every((entry) => entry.mode === "perMinute")).map((event, eventIndex) => ({
          key: `team-item-${player.playerSlot ?? playerIndex}-${normalizeItemSlug(event.itemName)}-${event.time}-${eventIndex}`,
          label: `${player.heroName ?? "Hero"}: ${event.itemName} at ${formatDuration(event.time)}`,
          index: Math.max(0, Math.round(event.time / 60)),
          yPercent: player.isRadiant ? 0.78 + (playerIndex % 5) * 0.025 : 0.9 + (playerIndex % 5) * 0.018,
          iconUrl: getItemImageUrl(event.itemName),
          color: player.isRadiant ? getCssVar("--team-radiant-strong", "#27ae60") : getCssVar("--team-dire-strong", "#c0392b")
        }))
      )
    : [];

  if (maxLength < 2 && itemMarkers.length === 0) {
    return <p className="muted-inline">No timeline data available for overlay.</p>;
  }

  return (
    <div className="stack compact">
      <div className="timeline-hover-header">
        <strong>{formatTimelineMinute(timelineMinutes[effectiveIndex] ?? effectiveIndex)}</strong>
      </div>
      <div className="timeline-overlay-legend">
        {selectedMetricTabs.map((selection) => {
          const tab = timelineTabs.find((entry) => entry.key === selection.tab);
          const values = getValues(selection.tab, selection.mode);
          const radiantValues = values.radiant;
          const direValues = values.dire;
          return (
            <div key={`team-overlay-legend-${selection.tab}-${selection.mode}`} className="timeline-overlay-legend-item">
              <span className="timeline-legend-swatch" style={{ backgroundColor: getTimelineMetricColor(selection.tab) }} />
              <TimelineMetricIcon type={selection.tab} />
              <strong>{tab?.label ?? selection.tab}</strong>
              <span>{selection.mode === "perMinute" ? "per minute" : "cumulative"}</span>
              <span>R {formatNumber(radiantValues[effectiveIndex] ?? radiantValues[radiantValues.length - 1] ?? 0)}</span>
              <span>D {formatNumber(direValues[effectiveIndex] ?? direValues[direValues.length - 1] ?? 0)}</span>
            </div>
          );
        })}
        {itemSelections.length > 0 ? (
          <div className="timeline-overlay-legend-item">
            <TimelineMetricIcon type="items" />
            <strong>Items</strong>
          </div>
        ) : null}
      </div>
      <TimelinePlot
        title={`Overlay - ${selectedTabs.map(formatTimelineSelectionLabel).join(" / ")}`}
        series={allSeries}
        eventMarkers={itemMarkers}
        timelineMinutes={timelineMinutes}
        hoveredIndex={hoveredIndex}
        onHoveredIndexChange={setHoveredIndex}
      />
    </div>
  );
}

type TimelineTab = "gold" | "xp" | "lastHits" | "heroDamage" | "damageTaken" | "vision" | "items";
type TeamTimelineTab = "gold" | "xp" | "lastHits" | "heroDamage" | "damageTaken" | "vision" | "items";
type OverlayTimelineTab = Exclude<TimelineTab, "items"> | "items";
type OverlaySelection = { tab: OverlayTimelineTab; mode: TimelineMode };
type MatchTab = "overview" | "vision" | "timelines" | "rosters";

const timelineTabs: Array<{ key: Exclude<TimelineTab, "items">; label: string; shortLabel: string }> = [
  { key: "gold", label: "Gold", shortLabel: "G" },
  { key: "xp", label: "XP", shortLabel: "XP" },
  { key: "lastHits", label: "Last hits", shortLabel: "LH" },
  { key: "heroDamage", label: "Hero damage", shortLabel: "HD" },
  { key: "damageTaken", label: "Damage taken", shortLabel: "DT" },
  { key: "vision", label: "Vision", shortLabel: "V" }
];

function formatTimelineModeLabel(label: string, mode: TimelineMode) {
  return `${label} ${mode === "perMinute" ? "per minute" : "cumulative"}`;
}

function formatTimelineSelectionLabel(selection: OverlaySelection) {
  if (selection.tab === "items") {
    return `Items ${selection.mode === "perMinute" ? "core/completed" : "all purchases"}`;
  }
  const tab = timelineTabs.find((entry) => entry.key === selection.tab);
  return formatTimelineModeLabel(tab?.label ?? selection.tab, selection.mode);
}

function getTimelineMetricColor(type: Exclude<TimelineTab, "items">) {
  const colors: Record<Exclude<TimelineTab, "items">, string> = {
    gold: getCssVar("--metric-gold", "#c99700"),
    xp: getCssVar("--metric-xp", "#5c7cfa"),
    lastHits: getCssVar("--metric-last-hits", "#2f9e44"),
    heroDamage: getCssVar("--metric-hero-damage", "#e03131"),
    damageTaken: getCssVar("--metric-damage-taken", "#7048e8"),
    vision: getCssVar("--metric-vision", "#0ea5a4")
  };
  return colors[type];
}

function normalizeTimelineForOverlay(values: number[]) {
  const maxValue = Math.max(...values.map((value) => Math.abs(value)), 1);
  return values.map((value) => (value / maxValue) * 100);
}

function isOverlaySelectionActive(selections: OverlaySelection[], tab: OverlayTimelineTab, mode: TimelineMode) {
  return selections.some((entry) => entry.tab === tab && entry.mode === mode);
}

function toggleOverlaySelection(current: OverlaySelection[], tab: OverlayTimelineTab, mode: TimelineMode) {
  if (isOverlaySelectionActive(current, tab, mode)) {
    const next = current.filter((entry) => !(entry.tab === tab && entry.mode === mode));
    return next.length === 0 ? current : next;
  }
  return [...current, { tab, mode }];
}

function TimelineMetricIcon({ type }: { type: TimelineTab }) {
  if (type === "gold") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M9 9h6M9 12h5M9 15h6" />
      </svg>
    );
  }
  if (type === "xp") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8z" />
      </svg>
    );
  }
  if (type === "lastHits") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 18h14M7 15l4-9 2 6 2-4 2 7" />
      </svg>
    );
  }
  if (type === "heroDamage") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 3L5 14h6l-1 7 9-12h-6z" />
      </svg>
    );
  }
  if (type === "damageTaken") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l7 3v5c0 5-3.1 8.3-7 10-3.9-1.7-7-5-7-10V6z" />
      </svg>
    );
  }
  if (type === "vision") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3.25" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 7h12v10H6zM8 5h8M8 19h8" />
    </svg>
  );
}

type TimelinePlayer = {
  playerId: number | null;
  personaname: string | null;
  heroId: number | null;
  heroName: string | null;
  heroIconUrl: string | null;
  isRadiant: boolean;
  playerSlot: number | null;
  goldTimeline: number[];
  xpTimeline: number[];
  lastHitsTimeline: number[];
  heroDamageTimeline: number[];
  damageTakenTimeline: number[];
  firstPurchaseTimes: Record<string, number>;
  itemUses: Record<string, number>;
  smokeUseEvents: Array<{ time: number; source: string }>;
  purchaseLog: Array<{ time: number; key: string; charges: number | null }>;
  observerLog: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>;
  sentryLog: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>;
  observerWardsPlaced: number | null;
  sentryWardsPlaced: number | null;
  finalInventory: Array<{ name: string; imageUrl: string | null } | null>;
  finalBackpack: Array<{ name: string; imageUrl: string | null } | null>;
  finalNeutral?: { name: string; imageUrl: string | null } | null;
  items: Array<{ name: string; imageUrl: string | null }>;
};

function getPlayerTimelineValues(player: TimelinePlayer, tab: Exclude<TimelineTab, "items">) {
  return tab === "gold"
    ? player.goldTimeline
    : tab === "xp"
      ? player.xpTimeline
      : tab === "lastHits"
        ? player.lastHitsTimeline
        : tab === "heroDamage"
          ? player.heroDamageTimeline
          : tab === "vision"
            ? getWardPlacementTimeline(player.observerLog, Math.max(0, player.goldTimeline.length - 1, player.xpTimeline.length - 1, player.lastHitsTimeline.length - 1, player.heroDamageTimeline.length - 1, player.damageTakenTimeline.length - 1))
            : player.damageTakenTimeline;
}

function getSmokePurchaseCount(player: TimelinePlayer) {
  return player.purchaseLog.filter((entry) => entry.key.toLowerCase().includes("smoke")).length;
}

function getSmokeUseCount(player: TimelinePlayer) {
  return Object.entries(player.itemUses).reduce((sum, [key, value]) => {
    return key.toLowerCase().includes("smoke") ? sum + value : sum;
  }, 0);
}

function getTimelinePurchaseCount(player: TimelinePlayer, keyword: string, second: number) {
  return player.purchaseLog.filter((entry) => entry.time <= second && entry.key.toLowerCase().includes(keyword)).length;
}

function getTimelineWardPlacementCount(
  entries: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>,
  second: number
) {
  return entries.filter((entry) => entry.time <= second && !isWardRemovalAction(entry.action)).length;
}

type WardTimelineEntry = {
  time: number;
  x: number | null;
  y: number | null;
  z: number | null;
  action?: string | null;
  playerKey?: string;
  kind?: string;
};

function isWardRemovalAction(action?: string | null) {
  const normalized = (action ?? "SPAWN").toUpperCase();
  return normalized === "DESPAWN" || normalized === "DESTROY" || normalized === "DEATH" || normalized === "KILL";
}

function hasReliableWardState(entries: WardTimelineEntry[]) {
  const placementCount = entries.filter((entry) => !isWardRemovalAction(entry.action)).length;
  if (placementCount === 0) return false;
  return entries.some((entry) => isWardRemovalAction(entry.action));
}

function getWardLifetimeSeconds(entry: WardTimelineEntry) {
  return entry.kind === "sentry" ? 420 : 360;
}

function getWardCoordinateKey(entry: { x: number | null; y: number | null; z: number | null }) {
  return `${Math.round(entry.x ?? -999)}-${Math.round(entry.y ?? -999)}`;
}

function findMatchingWardIndex<T extends WardTimelineEntry>(active: T[], target: WardTimelineEntry) {
  const scopedActive =
    target.playerKey || target.kind
      ? active
          .map((entry, index) => ({ entry, index }))
          .filter(
            ({ entry }) =>
              (!target.playerKey || entry.playerKey === target.playerKey) &&
              (!target.kind || entry.kind === target.kind)
          )
      : active.map((entry, index) => ({ entry, index }));
  const candidateEntries = scopedActive.length > 0 ? scopedActive : active.map((entry, index) => ({ entry, index }));

  const exactKey = getWardCoordinateKey(target);
  const exactMatch = candidateEntries.find(({ entry }) => getWardCoordinateKey(entry) === exactKey);
  if (exactMatch) return exactMatch.index;

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const { entry, index } of candidateEntries) {
    if (entry.x === null || entry.y === null || target.x === null || target.y === null) continue;
    const distance = Math.hypot(entry.x - target.x, entry.y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  if (bestDistance <= 450) return bestIndex;
  return candidateEntries[0]?.index ?? -1;
}

function buildWardTimelineState<T extends WardTimelineEntry>(entries: T[], second: number) {
  const placed: T[] = [];
  const active: T[] = [];
  const completedLifetimes: number[] = [];
  const sortedEntries = [...entries].sort((left, right) => left.time - right.time);
  for (const entry of sortedEntries) {
    if (entry.time > second) break;
    if (isWardRemovalAction(entry.action)) {
      const matchIndex = findMatchingWardIndex(active, entry);
      if (matchIndex >= 0) {
        const [matchedWard] = active.splice(matchIndex, 1);
        completedLifetimes.push(Math.max(0, entry.time - matchedWard.time));
      }
    } else {
      placed.push(entry);
      active.push(entry);
    }
  }
  const stillActive: T[] = [];
  for (const entry of active) {
    const elapsed = Math.max(0, second - entry.time);
    const lifetime = getWardLifetimeSeconds(entry);
    if (elapsed >= lifetime) {
      completedLifetimes.push(lifetime);
    } else {
      stillActive.push(entry);
    }
  }
  return { placed, active: stillActive, completedLifetimes };
}

function getWardPlacementsPerMinute(
  entries: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>,
  maxMinute: number
) {
  const values = Array.from({ length: maxMinute + 1 }, () => 0);
  for (const entry of entries) {
    if (isWardRemovalAction(entry.action)) continue;
    const minute = Math.max(0, Math.min(maxMinute, Math.floor(entry.time / 60)));
    values[minute] += 1;
  }
  return values;
}

function getWardPlacementTimeline(
  entries: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>,
  maxMinute: number
) {
  return cumulativeTimeline(getWardPlacementsPerMinute(entries, maxMinute));
}

function getActiveWardTimeline(
  entries: Array<{ time: number; x: number | null; y: number | null; z: number | null; action?: string | null }>,
  maxMinute: number
) {
  return Array.from({ length: maxMinute + 1 }, (_, minute) => buildWardTimelineState(entries, minute * 60).active.length);
}

function getWardEfficiencyPercent(entries: WardTimelineEntry[], second: number, wardLifetimeSeconds: number) {
  if (!hasReliableWardState(entries)) return null;
  const { placed, active, completedLifetimes } = buildWardTimelineState(entries, second);
  if (placed.length === 0) return null;

  const actualLifetimeTotal =
    completedLifetimes.reduce((sum, value) => sum + Math.min(value, wardLifetimeSeconds), 0) +
    active.reduce((sum, entry) => sum + Math.min(Math.max(0, second - entry.time), wardLifetimeSeconds), 0);
  const potentialLifetimeTotal = placed.reduce(
    (sum, entry) => sum + Math.min(Math.max(0, second - entry.time), wardLifetimeSeconds),
    0
  );

  if (potentialLifetimeTotal <= 0) return null;
  return (actualLifetimeTotal / potentialLifetimeTotal) * 100;
}

function getItemTimingEvents(player: TimelinePlayer, onlyCoreItems: boolean) {
  const fromFirstPurchase = Object.entries(player.firstPurchaseTimes).map(([itemName, time]) => ({
    itemName,
    time,
    cost: getKnownItemCost(itemName)
  }));
  const fromPurchaseLog = player.purchaseLog.map((entry) => ({
    itemName: entry.key,
    time: entry.time,
    cost: getKnownItemCost(entry.key)
  }));

  const deduped = new Map<string, { itemName: string; time: number; cost: number | null }>();
  for (const event of [...fromFirstPurchase, ...fromPurchaseLog]) {
    if (!Number.isFinite(event.time)) continue;
    if (onlyCoreItems && !isCoreTimelineItem(event.itemName)) continue;
    const key = `${normalizeItemSlug(event.itemName)}-${event.time}`;
    if (!deduped.has(key)) deduped.set(key, event);
  }

  return [...deduped.values()].sort((left, right) => left.time - right.time);
}

function getRosterItemImage(player: TimelinePlayer, itemName: string) {
  const normalizedTarget = normalizeItemSlug(itemName);
  const catalog = [
    ...player.items,
    ...player.finalInventory.filter((item): item is { name: string; imageUrl: string | null } => Boolean(item)),
    ...player.finalBackpack.filter((item): item is { name: string; imageUrl: string | null } => Boolean(item)),
    ...(player.finalNeutral ? [player.finalNeutral] : [])
  ];
  const directMatch = catalog.find((item) => normalizeItemSlug(item.name) === normalizedTarget);
  return directMatch?.imageUrl ?? getItemImageUrl(itemName);
}

type RosterSlot = {
  key: string;
  name: string;
  imageUrl: string | null;
  count?: number;
};

type RosterInventoryState = {
  inventory: Array<RosterSlot | null>;
  backpack: Array<RosterSlot | null>;
  teleport: RosterSlot | null;
  neutral: RosterSlot | null;
};

function toRosterSlot(player: TimelinePlayer, item: { name: string; imageUrl: string | null }, key: string, count = 1): RosterSlot {
  return {
    key,
    name: item.name,
    imageUrl: item.imageUrl ?? getRosterItemImage(player, item.name),
    ...(count > 1 ? { count } : {})
  };
}

function isTeleportItem(itemName: string) {
  return teleportItemSlugs.has(normalizeItemSlug(itemName));
}

function isNeutralItem(itemName: string) {
  return false;
}

function buildFinalRosterInventory(player: TimelinePlayer): RosterInventoryState {
  const inventory = [...player.finalInventory];
  const backpack = [...player.finalBackpack];
  let teleport: RosterSlot | null = null;
  let neutral: RosterSlot | null = player.finalNeutral ? toRosterSlot(player, player.finalNeutral, "neutral-final") : null;

  const extractTeleport = (slots: Array<{ name: string; imageUrl: string | null } | null>, prefix: string) => {
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot || !isTeleportItem(slot.name)) continue;
      teleport = toRosterSlot(player, slot, `${prefix}-tp-${index}`);
      slots[index] = null;
      return;
    }
  };

  extractTeleport(inventory, "inventory");
  if (!teleport) extractTeleport(backpack, "backpack");

  const extractNeutral = (slots: Array<{ name: string; imageUrl: string | null } | null>, prefix: string) => {
    if (neutral) return;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!slot || !isNeutralItem(slot.name)) continue;
      neutral = toRosterSlot(player, slot, `${prefix}-neutral-${index}`);
      slots[index] = null;
      return;
    }
  };

  extractNeutral(inventory, "inventory");
  extractNeutral(backpack, "backpack");

  return {
    inventory: Array.from({ length: 6 }, (_, index) => {
      const slot = inventory[index];
      return slot ? toRosterSlot(player, slot, `inventory-final-${index}`) : null;
    }),
    backpack: Array.from({ length: 3 }, (_, index) => {
      const slot = backpack[index];
      return slot ? toRosterSlot(player, slot, `backpack-final-${index}`) : null;
    }),
    teleport,
    neutral
  };
}

function buildGroupedRosterSlots(
  player: TimelinePlayer,
  events: Array<{ itemName: string; slug: string; time: number; cost: number | null }>,
  options?: { treatStartingStacks?: boolean }
) {
  const grouped = new Map<
    string,
    { itemName: string; slug: string; firstTime: number; imageUrl: string | null; count: number; cost: number | null }
  >();

  for (const event of events) {
    const groupingSlug = event.slug === "ward_observer" || event.slug === "ward_sentry" ? "ward_dispenser" : event.slug;
    const groupingName =
      groupingSlug === "ward_dispenser"
        ? "Observer and Sentry Wards"
        : event.itemName;
    const current = grouped.get(groupingSlug);
    const increment =
      options?.treatStartingStacks && event.time <= 0
        ? startingStackCounts[event.slug] ?? 1
        : 1;
    if (current) {
      current.count += increment;
      current.firstTime = Math.min(current.firstTime, event.time);
      if ((current.cost ?? 0) < (event.cost ?? 0)) {
        current.cost = event.cost ?? current.cost;
      }
      continue;
    }

    grouped.set(groupingSlug, {
      itemName: groupingName,
      slug: groupingSlug,
      firstTime: event.time,
      imageUrl: getRosterItemImage(player, groupingSlug),
      count: increment,
      cost: event.cost,
    });
  }

  return [...grouped.values()].sort((left, right) => {
    const leftWeight = (left.cost ?? 0) >= 1500 || isCoreTimelineItem(left.itemName) ? 1 : 0;
    const rightWeight = (right.cost ?? 0) >= 1500 || isCoreTimelineItem(right.itemName) ? 1 : 0;
    if (leftWeight !== rightWeight) return rightWeight - leftWeight;
    if (left.firstTime !== right.firstTime) return left.firstTime - right.firstTime;
    return left.itemName.localeCompare(right.itemName);
  });
}

function buildInventoryCandidates(player: TimelinePlayer, second: number) {
  const fallbackEvents = Object.entries(player.firstPurchaseTimes).map(([itemName, time]) => ({
    itemName,
    time,
    cost: getKnownItemCost(itemName)
  }));
  const rawEvents = [
    ...player.purchaseLog.map((entry) => ({
      itemName: entry.key,
      time: entry.time,
      cost: getKnownItemCost(entry.key)
    })),
    ...fallbackEvents
  ];

  const deduped = new Map<string, { itemName: string; time: number; cost: number | null; slug: string }>();

  rawEvents
    .filter((event) => Number.isFinite(event.time) && event.time <= second)
    .map((event) => ({
      ...event,
      slug: normalizeItemSlug(event.itemName)
    }))
    .filter((event) => !event.slug.startsWith("recipe_"))
    .sort((left, right) => left.time - right.time)
    .forEach((event) => {
      const key = `${event.slug}-${event.time}`;
      if (!deduped.has(key)) {
        deduped.set(key, event);
      }
    });

  return [...deduped.values()];
}

function getRosterInventory(player: TimelinePlayer, second: number, maxSecond: number): RosterInventoryState {
  const allEvents = buildInventoryCandidates(player, second);
  const earlyWindowSeconds = 120;

  if (second <= 0) {
    const startingEvents = allEvents.filter((event) => event.time <= 0 && !teleportItemSlugs.has(event.slug) && !isNeutralItem(event.itemName));
    const groupedStartingSlots = buildGroupedRosterSlots(player, startingEvents, { treatStartingStacks: true });
    const startingSlots: Array<RosterSlot | null> = Array.from({ length: 9 }, (_, index) => {
      const slot = groupedStartingSlots[index];
      return slot
        ? {
            key: `start-${slot.slug}-${slot.firstTime}-${index}`,
            name: slot.itemName,
            imageUrl: slot.imageUrl,
            ...(slot.count > 1 ? { count: slot.count } : {})
          }
        : null;
    });

    return {
      inventory: startingSlots.slice(0, 6),
      backpack: startingSlots.slice(6, 9),
      teleport: null,
      neutral: null
    };
  }

  const hasFinalSlots =
    player.finalInventory.some((item) => Boolean(item)) ||
    player.finalBackpack.some((item) => Boolean(item)) ||
    Boolean(player.finalNeutral);
  const finalStateThreshold = Math.max(0, Math.floor(maxSecond) - 90);
  if (hasFinalSlots && second >= finalStateThreshold) {
    const finalState = buildFinalRosterInventory(player);
    if (!finalState.teleport) {
      const tpEvent = player.purchaseLog
        .filter((entry) => entry.time <= second && isTeleportItem(entry.key))
        .sort((left, right) => right.time - left.time)[0];
      if (tpEvent) {
        finalState.teleport = {
          key: `tp-final-fallback-${tpEvent.time}`,
          name: "Town Portal Scroll",
          imageUrl: getRosterItemImage(player, tpEvent.key)
        };
      }
    }
    return finalState;
  }

  const tpEvents = allEvents.filter((event) => teleportItemSlugs.has(event.slug));
  const neutralEvents = allEvents.filter((event) => isNeutralItem(event.itemName));
  const durableEvents = allEvents.filter((event) => {
    if (ignoredInventoryItemSlugs.has(event.slug)) {
      return second <= earlyWindowSeconds && event.time <= 0;
    }
    if (teleportItemSlugs.has(event.slug)) return false;
    if (isNeutralItem(event.itemName)) return false;
    return true;
  });

  const groupedDurableSlots = buildGroupedRosterSlots(player, durableEvents);
  const normalizedSlots: Array<RosterSlot | null> = Array.from({ length: 9 }, (_, index) => {
    const slot = groupedDurableSlots[index];
    return slot
      ? {
          key: `${slot.slug}-${slot.firstTime}-${index}`,
          name: slot.itemName,
          imageUrl: slot.imageUrl,
          ...(slot.count > 1 ? { count: slot.count } : {})
        }
      : null;
  });

  const teleportSlot =
    tpEvents.length > 0
      ? {
          key: `tpscroll-${tpEvents[tpEvents.length - 1]?.time ?? 0}`,
          name: "Town Portal Scroll",
          imageUrl: getRosterItemImage(player, "tpscroll"),
          ...(tpEvents.length > 1 ? { count: tpEvents.length } : {})
        }
      : null;

  const neutralSlot =
    neutralEvents.length > 0
      ? {
          key: `${neutralEvents[neutralEvents.length - 1]?.slug ?? "neutral"}-${neutralEvents[neutralEvents.length - 1]?.time ?? 0}`,
          name: neutralEvents[neutralEvents.length - 1]?.itemName ?? "Neutral item",
          imageUrl: getRosterItemImage(player, neutralEvents[neutralEvents.length - 1]?.itemName ?? "Neutral item")
        }
      : second >= 45 * 60 && player.finalNeutral
        ? toRosterSlot(player, player.finalNeutral, "neutral-late-fallback")
        : null;

  return {
    inventory: normalizedSlots.slice(0, 6),
    backpack: normalizedSlots.slice(6, 9),
    teleport: teleportSlot,
    neutral: neutralSlot
  };
}

function ItemTimingTimeline({
  players,
  timelineMinutes,
  onlyCoreItems
}: {
  players: TimelinePlayer[];
  timelineMinutes: number[];
  onlyCoreItems: boolean;
}) {
  const maxSeconds = Math.max((timelineMinutes[timelineMinutes.length - 1] ?? 0) * 60, ...players.flatMap((player) => getItemTimingEvents(player, onlyCoreItems).map((event) => event.time)), 1);
  const rows = players.map((player) => ({
    ...player,
    key: `${player.playerSlot ?? "slot"}-${player.playerId ?? "anon"}-${player.heroId ?? "hero"}`,
    events: getItemTimingEvents(player, onlyCoreItems)
  }));
  const radiantRows = rows.filter((player) => player.isRadiant);
  const direRows = rows.filter((player) => !player.isRadiant);
  const markers = Array.from({ length: Math.floor(maxSeconds / 600) }, (_, index) => (index + 1) * 600);

  if (rows.every((player) => player.events.length === 0)) {
    return <p className="muted-inline">No item timing data available for this view.</p>;
  }

  const renderRows = (sectionRows: typeof rows) =>
    sectionRows.map((player) => (
      <div key={player.key} className="item-timeline-row">
        <div className="item-timeline-hero">
          <IconImage src={player.heroIconUrl} alt={player.heroName ?? "Hero"} size="sm" />
        </div>
        <div className="item-timeline-track">
          {markers.map((second) => (
            <span key={`${player.key}-${second}`} className="item-timeline-marker" style={{ left: `${(second / maxSeconds) * 100}%` }} />
          ))}
          {player.events.map((event, index) => (
            <span
              key={`${player.key}-${normalizeItemSlug(event.itemName)}-${event.time}-${index}`}
              className="item-timeline-event"
              style={{ left: `${(event.time / maxSeconds) * 100}%` }}
              title={`${player.heroName ?? "Hero"}: ${event.itemName} at ${formatDuration(event.time)}`}
            >
              <IconImage src={getItemImageUrl(event.itemName)} alt={event.itemName} size="sm" />
            </span>
          ))}
        </div>
      </div>
    ));

  return (
    <div className="item-timeline">
      <div className="timeline-hover-header">
        <strong>{onlyCoreItems ? "Core and completed item timings" : "All item purchase timings"}</strong>
      </div>
      <div className="item-timeline-scale">
        {markers.map((second) => (
          <span key={second} style={{ left: `${(second / maxSeconds) * 100}%` }}>
            {formatDuration(second)}
          </span>
        ))}
      </div>
      <div className="timeline-side-group">
        <span className="eyebrow">Radiant</span>
        {renderRows(radiantRows)}
      </div>
      <div className="timeline-side-group">
        <span className="eyebrow">Dire</span>
        {renderRows(direRows)}
      </div>
    </div>
  );
}

function normalizeDotaMapCoordinate(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return value * 100;
  if (value >= 0 && value <= 255) return (value / 255) * 100;
  const clamped = Math.max(-8200, Math.min(8200, value));
  return ((clamped + 8200) / 16400) * 100;
}

function projectWardCoordinateToMinimapPercent(value: number | null) {
  const normalized = normalizeDotaMapCoordinate(value);
  if (normalized === null) return null;

  // OpenDota/STRATZ ward coordinates land in a visibly compressed square on the minimap asset.
  // Expand around center so ward overlays use the same visual scale as the map.
  const scale = 1.539;
  return Math.max(1.5, Math.min(98.5, 50 + (normalized - 50) * scale));
}

function VisionMap({ players, durationSeconds }: { players: TimelinePlayer[]; durationSeconds: number | null }) {
  const maxSecond = Math.max(
    durationSeconds ?? 0,
    ...players.flatMap((player) => [...player.observerLog, ...player.sentryLog].map((entry) => entry.time)),
    1
  );
  const [selectedSecond, setSelectedSecond] = useState(0);
  useEffect(() => {
    setSelectedSecond(0);
  }, [maxSecond]);

  const wardEvents = players.flatMap((player) => {
    const base = {
      playerKey: `${player.playerSlot ?? "slot"}-${player.playerId ?? "anon"}-${player.heroId ?? "hero"}`,
      heroName: player.heroName ?? "Hero",
      heroIconUrl: player.heroIconUrl,
      isRadiant: player.isRadiant
    };
    return [
      ...player.observerLog.map((entry, index) => ({ ...base, ...entry, kind: "observer" as const, index })),
      ...player.sentryLog.map((entry, index) => ({ ...base, ...entry, kind: "sentry" as const, index }))
    ];
  });
  const hasReliableVisionState = hasReliableWardState(wardEvents);
  const visibleWardEvents = selectedSecond === 0
    ? wardEvents.filter((entry) => !isWardRemovalAction(entry.action))
    : hasReliableVisionState
      ? buildWardTimelineState(wardEvents, selectedSecond).active
      : [];
  const activeWards = visibleWardEvents
    .map((entry) => ({
      ...entry,
      left: projectWardCoordinateToMinimapPercent(entry.x),
      top: projectWardCoordinateToMinimapPercent(entry.y)
    }))
    .filter((entry): entry is typeof entry & { left: number; top: number } => entry.left !== null && entry.top !== null);
  const radiantCount = activeWards.filter((entry) => entry.isRadiant).length;
  const direCount = activeWards.length - radiantCount;

  if (wardEvents.length === 0) {
    return (
      <Card title="Vision map">
        <p className="muted-inline">No ward placement coordinates are available for this match.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Vision map"
      extra={
        <div className="vision-map-summary">
          <span>{formatDuration(selectedSecond)}</span>
          <span>Radiant {formatNumber(radiantCount)}</span>
          <span>Dire {formatNumber(direCount)}</span>
        </div>
      }
    >
      <div className="vision-map-shell">
        <div className="vision-map-controls">
          <input
            type="range"
            min={0}
            max={Math.ceil(maxSecond)}
            value={Math.min(selectedSecond, Math.ceil(maxSecond))}
            onChange={(event) => setSelectedSecond(Number(event.target.value))}
          />
        </div>
        {selectedSecond > 0 && !hasReliableVisionState ? (
          <div className="empty-state">
            <p>Active ward state is not available from the provider for this match.</p>
          </div>
        ) : (
          <div className="vision-map-board" aria-label="Dota map ward placements">
            <img className="vision-map-image" src="/api/assets/dota-map" alt="Dota 2 minimap" />
            <span className="vision-map-label radiant">Radiant</span>
            <span className="vision-map-label dire">Dire</span>
            {activeWards.map((ward) => (
              <span
                key={`${ward.playerKey}-${ward.kind}-${ward.index}-${ward.time}`}
                className={`vision-ward ${ward.kind} ${ward.isRadiant ? "radiant" : "dire"}`}
                style={{ left: `${ward.left}%`, top: `${100 - ward.top}%` }}
                title={`${ward.heroName}: ${ward.kind} at ${formatDuration(ward.time)}`}
              >
                <IconImage src={ward.heroIconUrl} alt={ward.heroName} size="sm" />
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function MultiPlayerTimeline({
  players,
  timelineMinutes,
  selectedTab,
  selectedMode,
  hiddenKeys,
  onTogglePlayer,
  title
}: {
  players: TimelinePlayer[];
  timelineMinutes: number[];
  selectedTab: TimelineTab;
  selectedMode: TimelineMode;
  hiddenKeys: string[];
  onTogglePlayer: (key: string) => void;
  title?: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (selectedTab === "items") {
    return <ItemTimingTimeline players={players} timelineMinutes={timelineMinutes} onlyCoreItems={selectedMode === "perMinute"} />;
  }

  const series = players.map((player) => ({
    ...player,
    key: `${player.playerSlot ?? "slot"}-${player.playerId ?? "anon"}-${player.heroId ?? "hero"}`,
    perMinuteValues: perMinuteTimeline(getPlayerTimelineValues(player, selectedTab)),
    cumulativeValues: totalTimeline(getPlayerTimelineValues(player, selectedTab))
  }));
  const visibleSeries = series.filter((player) => !hiddenKeys.includes(player.key));
  const radiantPalette = getTimelinePalette("radiant");
  const direPalette = getTimelinePalette("dire");
  const maxLength = Math.max(...visibleSeries.map((player) => player.perMinuteValues.length), 0);
  const effectiveIndex = hoveredIndex === null ? maxLength - 1 : Math.min(maxLength - 1, Math.max(0, hoveredIndex));

  if (maxLength < 2) {
    return <p className="muted-inline">No timeline data available for this tab.</p>;
  }

  const radiantSeries = series.filter((player) => player.isRadiant);
  const direSeries = series.filter((player) => !player.isRadiant);
  const buildColoredSeries = (entries: typeof visibleSeries, valueKey: "perMinuteValues" | "cumulativeValues") =>
    entries.map((player) => {
      const sideEntries = player.isRadiant ? radiantSeries : direSeries;
      const palette = player.isRadiant ? radiantPalette : direPalette;
      const sideIndex = sideEntries.findIndex((entry) => entry.key === player.key);
      return {
        key: `${player.key}-${valueKey}`,
        label: player.heroName ?? "Hero",
        iconUrl: player.heroIconUrl,
        color: palette[(sideIndex < 0 ? 0 : sideIndex) % palette.length],
        values: player[valueKey]
      };
    });
  const perMinuteSeries = buildColoredSeries(visibleSeries, "perMinuteValues");
  const cumulativeSeries = buildColoredSeries(visibleSeries, "cumulativeValues");
  const activeSeries = selectedMode === "perMinute" ? perMinuteSeries : cumulativeSeries;
  const levelMarkerSeries =
    selectedTab === "xp" && selectedMode === "cumulative"
      ? visibleSeries.map((player) => {
          const sideEntries = player.isRadiant ? radiantSeries : direSeries;
          const palette = player.isRadiant ? radiantPalette : direPalette;
          const sideIndex = sideEntries.findIndex((entry) => entry.key === player.key);
          return {
            key: `${player.key}-levels`,
            color: palette[(sideIndex < 0 ? 0 : sideIndex) % palette.length],
            markers: getLevelMarkers(totalTimeline(player.xpTimeline))
          };
        })
      : [];
  const getCurrentValue = (player: (typeof series)[number]) =>
    (selectedMode === "perMinute" ? player.perMinuteValues : player.cumulativeValues)[effectiveIndex] ??
    (selectedMode === "perMinute" ? player.perMinuteValues : player.cumulativeValues)[
      (selectedMode === "perMinute" ? player.perMinuteValues : player.cumulativeValues).length - 1
    ] ??
    0;

  return (
    <div className="timeline-layout">
      <div className="timeline-side-list">
        <div className="timeline-side-group">
          <span className="eyebrow">Radiant</span>
          {radiantSeries.map((player, index) => {
            const color = radiantPalette[index % radiantPalette.length];
            const hidden = hiddenKeys.includes(player.key);
            return (
              <button
                key={player.key}
                type="button"
                className={`timeline-side-row ${hidden ? "hidden" : ""}`}
                onClick={() => onTogglePlayer(player.key)}
                title={player.heroName ?? "Hero"}
              >
                <span className="timeline-legend-swatch" style={{ backgroundColor: color }} />
                <IconImage src={player.heroIconUrl} alt={player.heroName ?? "Hero"} size="sm" />
                <span className="timeline-row-values single">
                  <span>{formatNumber(getCurrentValue(player))}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="timeline-side-group">
          <span className="eyebrow">Dire</span>
          {direSeries.map((player, index) => {
            const color = direPalette[index % direPalette.length];
            const hidden = hiddenKeys.includes(player.key);
            return (
              <button
                key={player.key}
                type="button"
                className={`timeline-side-row ${hidden ? "hidden" : ""}`}
                onClick={() => onTogglePlayer(player.key)}
                title={player.heroName ?? "Hero"}
              >
                <span className="timeline-legend-swatch" style={{ backgroundColor: color }} />
                <IconImage src={player.heroIconUrl} alt={player.heroName ?? "Hero"} size="sm" />
                <span className="timeline-row-values single">
                  <span>{formatNumber(getCurrentValue(player))}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="timeline-main">
        <div className="timeline-hover-header">
          <strong>{formatTimelineMinute(timelineMinutes[effectiveIndex] ?? effectiveIndex)}</strong>
        </div>
        <TimelinePlot
          title={title ?? formatTimelineModeLabel(timelineTabs.find((entry) => entry.key === selectedTab)?.label ?? selectedTab, selectedMode)}
          series={activeSeries}
          markerSeries={levelMarkerSeries}
          timelineMinutes={timelineMinutes}
          hoveredIndex={hoveredIndex}
          onHoveredIndexChange={setHoveredIndex}
        />
      </div>
    </div>
  );
}

function MultiPlayerTimelineOverlay({
  players,
  timelineMinutes,
  selectedTabs,
  hiddenKeys,
  onTogglePlayer
}: {
  players: TimelinePlayer[];
  timelineMinutes: number[];
  selectedTabs: OverlaySelection[];
  hiddenKeys: string[];
  onTogglePlayer: (key: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const series = players.map((player) => ({
    ...player,
    key: `${player.playerSlot ?? "slot"}-${player.playerId ?? "anon"}-${player.heroId ?? "hero"}`
  }));
  const visibleSeries = series.filter((player) => !hiddenKeys.includes(player.key));
  const radiantSeries = series.filter((player) => player.isRadiant);
  const direSeries = series.filter((player) => !player.isRadiant);
  const radiantPalette = getTimelinePalette("radiant");
  const direPalette = getTimelinePalette("dire");
  const selectedMetricTabs = selectedTabs.filter((entry) => entry.tab !== "items") as Array<{
    tab: Exclude<TimelineTab, "items">;
    mode: TimelineMode;
  }>;
  const allPlotSeries = visibleSeries.flatMap((player) =>
    selectedMetricTabs.map((selection) => {
      const baseValues = getPlayerTimelineValues(player, selection.tab);
      const values = selection.mode === "perMinute" ? perMinuteTimeline(baseValues) : totalTimeline(baseValues);
      const sideEntries = player.isRadiant ? radiantSeries : direSeries;
      const sideIndex = sideEntries.findIndex((entry) => entry.key === player.key);
      const sideColor = (player.isRadiant ? radiantPalette : direPalette)[(sideIndex < 0 ? 0 : sideIndex) % 5];
      return {
        key: `player-overlay-${player.key}-${selection.tab}-${selection.mode}`,
        label: `${player.heroName ?? "Hero"} ${timelineTabs.find((entry) => entry.key === selection.tab)?.label ?? selection.tab}`,
        iconUrl: player.heroIconUrl,
        color: sideColor,
        values,
        plotValues: normalizeTimelineForOverlay(values),
        strokeDasharray:
          selection.mode === "cumulative"
            ? "8 5"
            : selection.tab === "gold"
              ? undefined
              : selection.tab === "xp"
                ? "8 5"
                : selection.tab === "lastHits"
                  ? "3 5"
                  : selection.tab === "heroDamage"
                    ? "10 4 2 4"
                    : "2 4",
        opacity: 0.72,
        strokeWidth: 2
      };
    })
  );
  const itemSelections = selectedTabs.filter((entry) => entry.tab === "items");
  const itemMarkers = itemSelections.length > 0
    ? visibleSeries.flatMap((player, playerIndex) =>
        getItemTimingEvents(player, itemSelections.every((entry) => entry.mode === "perMinute")).map((event, eventIndex) => ({
          key: `player-item-${player.key}-${normalizeItemSlug(event.itemName)}-${event.time}-${eventIndex}`,
          label: `${player.heroName ?? "Hero"}: ${event.itemName} at ${formatDuration(event.time)}`,
          index: Math.max(0, Math.round(event.time / 60)),
          yPercent: 0.76 + (playerIndex % 10) * 0.022,
          iconUrl: getItemImageUrl(event.itemName),
          color: player.isRadiant ? getCssVar("--team-radiant-strong", "#27ae60") : getCssVar("--team-dire-strong", "#c0392b")
        }))
      )
    : [];
  const maxLength = Math.max(...allPlotSeries.map((entry) => entry.values.length), timelineMinutes.length, 0);
  const effectiveIndex = hoveredIndex === null ? maxLength - 1 : Math.min(maxLength - 1, Math.max(0, hoveredIndex));

  if (maxLength < 2 && itemMarkers.length === 0) {
    return <p className="muted-inline">No timeline data available for overlay.</p>;
  }

  const renderHeroToggle = (player: (typeof series)[number], index: number) => {
    const palette = player.isRadiant ? radiantPalette : direPalette;
    const hidden = hiddenKeys.includes(player.key);
    return (
      <button
        key={player.key}
        type="button"
        className={`timeline-side-row compact ${hidden ? "hidden" : ""}`}
        onClick={() => onTogglePlayer(player.key)}
        title={player.heroName ?? "Hero"}
      >
        <span className="timeline-legend-swatch" style={{ backgroundColor: palette[index % palette.length] }} />
        <IconImage src={player.heroIconUrl} alt={player.heroName ?? "Hero"} size="sm" />
      </button>
    );
  };

  return (
    <div className="timeline-layout">
      <div className="timeline-side-list">
        <div className="timeline-side-group">
          <span className="eyebrow">Radiant</span>
          {radiantSeries.map(renderHeroToggle)}
        </div>
        <div className="timeline-side-group">
          <span className="eyebrow">Dire</span>
          {direSeries.map(renderHeroToggle)}
        </div>
      </div>
      <div className="timeline-main">
        <div className="timeline-hover-header">
          <strong>{formatTimelineMinute(timelineMinutes[effectiveIndex] ?? effectiveIndex)}</strong>
        </div>
        <div className="timeline-overlay-legend metric-only">
          {selectedMetricTabs.map((selection) => (
            <div key={`player-overlay-legend-${selection.tab}-${selection.mode}`} className="timeline-overlay-legend-item">
              <span className="timeline-legend-swatch" style={{ backgroundColor: getTimelineMetricColor(selection.tab) }} />
              <TimelineMetricIcon type={selection.tab} />
              <strong>{timelineTabs.find((entry) => entry.key === selection.tab)?.label ?? selection.tab}</strong>
              <span>{selection.mode === "perMinute" ? "per minute" : "cumulative"}</span>
            </div>
          ))}
          {itemSelections.length > 0 ? (
            <div className="timeline-overlay-legend-item">
              <TimelineMetricIcon type="items" />
              <strong>Items</strong>
            </div>
          ) : null}
        </div>
        <TimelinePlot
          title={`Overlay - ${selectedTabs.map(formatTimelineSelectionLabel).join(" / ")}`}
          series={allPlotSeries}
          eventMarkers={itemMarkers}
          timelineMinutes={timelineMinutes}
          hoveredIndex={hoveredIndex}
          onHoveredIndexChange={setHoveredIndex}
        />
      </div>
    </div>
  );
}

export function MatchPage() {
  const params = useParams();
  const matchId = params.matchId ? Number(params.matchId) : null;
  const query = useMatch(Number.isFinite(matchId) ? matchId : null);
  const refreshMatch = useRefreshMatch(Number.isFinite(matchId) ? matchId : null);
  const settingsQuery = useSettings();
  const canManageMatchData =
    !(settingsQuery.data?.adminPasswordConfigured ?? false) || (settingsQuery.data?.adminUnlocked ?? false);
  const [timelineTab, setTimelineTab] = useState<TimelineTab>("gold");
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("perMinute");
  const [teamTimelineTab, setTeamTimelineTab] = useState<TeamTimelineTab>("gold");
  const [teamTimelineMode, setTeamTimelineMode] = useState<TimelineMode>("perMinute");
  const [stackTeamTimelines, setStackTeamTimelines] = useState(false);
  const [stackPlayerTimelines, setStackPlayerTimelines] = useState(false);
  const [activeMatchTab, setActiveMatchTab] = useState<MatchTab>("overview");
  const [rosterSecond, setRosterSecond] = useState(0);
  const [teamOverlayTabs, setTeamOverlayTabs] = useState<OverlaySelection[]>([
    { tab: "gold", mode: "perMinute" },
    { tab: "xp", mode: "cumulative" },
    { tab: "items", mode: "perMinute" }
  ]);
  const [playerOverlayTabs, setPlayerOverlayTabs] = useState<OverlaySelection[]>([
    { tab: "gold", mode: "perMinute" },
    { tab: "xp", mode: "cumulative" },
    { tab: "items", mode: "perMinute" }
  ]);
  const [hiddenTimelineKeys, setHiddenTimelineKeys] = useState<string[]>([]);

  useEffect(() => {
    setHiddenTimelineKeys([]);
  }, [matchId]);

  const radiantPlayers = query.data?.participants.filter((player) => player.isRadiant) ?? [];
  const direPlayers = query.data?.participants.filter((player) => !player.isRadiant) ?? [];
  const timelineMinutes = query.data?.timelineMinutes ?? [];
  const rosterMaxSecond = Math.max(query.data?.durationSeconds ?? 0, (timelineMinutes[timelineMinutes.length - 1] ?? 0) * 60, 1);
  const rosterMinuteIndex = Math.max(0, Math.round(rosterSecond / 60));

  useEffect(() => {
    setRosterSecond(rosterMaxSecond);
  }, [matchId, rosterMaxSecond]);
  const buildTeamTimeline = (
    players: typeof radiantPlayers,
    key: "goldTimeline" | "xpTimeline" | "lastHitsTimeline" | "heroDamageTimeline" | "damageTakenTimeline"
  ) => {
    const normalized = players.map((player) => ({
      ...player,
      values: player[key]
    }));
    const length = Math.max(0, ...normalized.map((player) => player.values.length));
    return Array.from({ length }, (_, index) =>
      normalized.reduce((sum, player) => sum + (player.values[index] ?? 0), 0)
    );
  };
  const radiantGoldTimeline = buildTeamTimeline(radiantPlayers, "goldTimeline");
  const direGoldTimeline = buildTeamTimeline(direPlayers, "goldTimeline");
  const radiantXpTimeline = buildTeamTimeline(radiantPlayers, "xpTimeline");
  const direXpTimeline = buildTeamTimeline(direPlayers, "xpTimeline");
  const radiantFarmTimeline = buildTeamTimeline(radiantPlayers, "lastHitsTimeline");
  const direFarmTimeline = buildTeamTimeline(direPlayers, "lastHitsTimeline");
  const radiantHeroDamageTimeline = buildTeamTimeline(radiantPlayers, "heroDamageTimeline");
  const direHeroDamageTimeline = buildTeamTimeline(direPlayers, "heroDamageTimeline");
  const radiantDamageTakenTimeline = buildTeamTimeline(radiantPlayers, "damageTakenTimeline");
  const direDamageTakenTimeline = buildTeamTimeline(direPlayers, "damageTakenTimeline");
  const radiantObserverPlacementTimeline = getWardPlacementTimeline(
    query.data?.participants.filter((player) => player.isRadiant).flatMap((player) => player.observerLog) ?? [],
    Math.max(0, timelineMinutes.length - 1)
  );
  const direObserverPlacementTimeline = getWardPlacementTimeline(
    query.data?.participants.filter((player) => !player.isRadiant).flatMap((player) => player.observerLog) ?? [],
    Math.max(0, timelineMinutes.length - 1)
  );
  const radiantObserverActiveTimeline = getActiveWardTimeline(
    query.data?.participants.filter((player) => player.isRadiant).flatMap((player) => player.observerLog) ?? [],
    Math.max(0, timelineMinutes.length - 1)
  );
  const direObserverActiveTimeline = getActiveWardTimeline(
    query.data?.participants.filter((player) => !player.isRadiant).flatMap((player) => player.observerLog) ?? [],
    Math.max(0, timelineMinutes.length - 1)
  );
  const hasReliableObserverActiveState = hasReliableWardState(
    query.data?.participants.flatMap((player) => player.observerLog) ?? []
  );
  const getTeamTimelineValues = (tab: Exclude<TeamTimelineTab, "items">, mode: TimelineMode) => ({
    radiant:
      tab === "gold"
        ? (mode === "perMinute" ? perMinuteTimeline(radiantGoldTimeline) : totalTimeline(radiantGoldTimeline))
        : tab === "xp"
          ? (mode === "perMinute" ? perMinuteTimeline(radiantXpTimeline) : totalTimeline(radiantXpTimeline))
          : tab === "lastHits"
            ? (mode === "perMinute" ? perMinuteTimeline(radiantFarmTimeline) : totalTimeline(radiantFarmTimeline))
            : tab === "heroDamage"
              ? (mode === "perMinute" ? perMinuteTimeline(radiantHeroDamageTimeline) : totalTimeline(radiantHeroDamageTimeline))
              : tab === "vision"
                ? (mode === "perMinute"
                    ? (hasReliableObserverActiveState ? radiantObserverActiveTimeline : [])
                    : radiantObserverPlacementTimeline)
                : (mode === "perMinute" ? perMinuteTimeline(radiantDamageTakenTimeline) : totalTimeline(radiantDamageTakenTimeline)),
    dire:
      tab === "gold"
        ? (mode === "perMinute" ? perMinuteTimeline(direGoldTimeline) : totalTimeline(direGoldTimeline))
        : tab === "xp"
          ? (mode === "perMinute" ? perMinuteTimeline(direXpTimeline) : totalTimeline(direXpTimeline))
          : tab === "lastHits"
            ? (mode === "perMinute" ? perMinuteTimeline(direFarmTimeline) : totalTimeline(direFarmTimeline))
            : tab === "heroDamage"
              ? (mode === "perMinute" ? perMinuteTimeline(direHeroDamageTimeline) : totalTimeline(direHeroDamageTimeline))
              : tab === "vision"
                ? (mode === "perMinute"
                    ? (hasReliableObserverActiveState ? direObserverActiveTimeline : [])
                    : direObserverPlacementTimeline)
                : (mode === "perMinute" ? perMinuteTimeline(direDamageTakenTimeline) : totalTimeline(direDamageTakenTimeline))
  });
  const selectTeamTimeline = (tab: OverlayTimelineTab, mode: TimelineMode) => {
    setTeamTimelineTab(tab);
    setTeamTimelineMode(mode);
    if (stackTeamTimelines) {
      setTeamOverlayTabs((current) => toggleOverlaySelection(current, tab, mode));
    }
  };
  const selectPlayerTimeline = (tab: OverlayTimelineTab, mode: TimelineMode) => {
    setTimelineTab(tab);
    setTimelineMode(mode);
    if (stackPlayerTimelines) {
      setPlayerOverlayTabs((current) => toggleOverlaySelection(current, tab, mode));
    }
  };
  return (
    <Page
      title={`Match ${params.matchId ?? ""}`}
        aside={
          matchId && canManageMatchData ? (
            <button
              type="button"
              onClick={() => refreshMatch.mutate()}
            disabled={refreshMatch.isPending}
            title="Force a fresh OpenDota fetch and STRATZ telemetry enrichment for this match"
          >
            {refreshMatch.isPending ? "Refreshing..." : "Refresh data"}
          </button>
        ) : null
      }
    >
      {query.isLoading ? <LoadingState label="Loading match detail…" /> : null}
      {query.error ? <ErrorState error={query.error as Error} /> : null}
      {refreshMatch.error ? <ErrorState error={refreshMatch.error as Error} /> : null}
      {refreshMatch.isSuccess ? <p className="success-inline">Match data refreshed.</p> : null}
      {query.data ? (
        <>
          <div className="settings-tabs" role="tablist" aria-label="Match sections">
            {[
              ["overview", "Overview"],
              ["vision", "Vision"],
              ["timelines", "Timelines"],
              ["rosters", "Rosters"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`settings-tab ${activeMatchTab === key ? "active" : ""}`}
                onClick={() => setActiveMatchTab(key as MatchTab)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={activeMatchTab === "overview" ? "tab-panel" : "tab-panel hidden"}>
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

          <div className="match-overview-grid">
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

          </div>

          <div className={activeMatchTab === "vision" ? "tab-panel" : "tab-panel hidden"}>
          <VisionMap players={query.data.participants} durationSeconds={query.data.durationSeconds} />
          </div>

          <div className={activeMatchTab === "timelines" ? "tab-panel" : "tab-panel hidden"}>
          <div className="timeline-section-stack">
            <Card
              title="Team timelines"
              extra={
                <div className="split-tab-grid">
                {timelineTabs.map((tab) => (
                  <div key={tab.key} className="split-tab-group">
                    <span className="split-tab-icon" title={tab.label}>
                      <TimelineMetricIcon type={tab.key} />
                    </span>
                    <button
                      type="button"
                      className={`split-tab-button ${
                        stackTeamTimelines
                          ? isOverlaySelectionActive(teamOverlayTabs, tab.key, "perMinute")
                            ? "active"
                            : ""
                          : teamTimelineTab === tab.key && teamTimelineMode === "perMinute"
                            ? "active"
                            : ""
                      }`}
                      aria-label={formatTimelineModeLabel(tab.label, "perMinute")}
                      title={formatTimelineModeLabel(tab.label, "perMinute")}
                      onClick={() => selectTeamTimeline(tab.key, "perMinute")}
                    />
                    <button
                      type="button"
                      className={`split-tab-button ${
                        stackTeamTimelines
                          ? isOverlaySelectionActive(teamOverlayTabs, tab.key, "cumulative")
                            ? "active"
                            : ""
                          : teamTimelineTab === tab.key && teamTimelineMode === "cumulative"
                            ? "active"
                            : ""
                      }`}
                      aria-label={formatTimelineModeLabel(tab.label, "cumulative")}
                      title={formatTimelineModeLabel(tab.label, "cumulative")}
                      onClick={() => selectTeamTimeline(tab.key, "cumulative")}
                    />
                  </div>
                ))}
                <div className="split-tab-group">
                  <span className="split-tab-icon" title="Items">
                    <TimelineMetricIcon type="items" />
                  </span>
                  <button
                    type="button"
                    className={`split-tab-button ${
                      stackTeamTimelines
                        ? isOverlaySelectionActive(teamOverlayTabs, "items", "perMinute")
                          ? "active"
                          : ""
                        : teamTimelineTab === "items" && teamTimelineMode === "perMinute"
                          ? "active"
                          : ""
                    }`}
                    aria-label="Items core and completed"
                    title="Items: core/completed"
                    onClick={() => selectTeamTimeline("items", "perMinute")}
                  />
                  <button
                    type="button"
                    className={`split-tab-button ${
                      stackTeamTimelines
                        ? isOverlaySelectionActive(teamOverlayTabs, "items", "cumulative")
                          ? "active"
                          : ""
                        : teamTimelineTab === "items" && teamTimelineMode === "cumulative"
                          ? "active"
                          : ""
                    }`}
                    aria-label="Items all purchases"
                    title="Items: all purchases"
                    onClick={() => selectTeamTimeline("items", "cumulative")}
                  />
                </div>
                <button
                  type="button"
                  className={`timeline-stack-toggle ${stackTeamTimelines ? "active" : ""}`}
                  onClick={() =>
                    setStackTeamTimelines((value) => {
                      const next = !value;
                      if (next && teamOverlayTabs.length === 0) {
                        setTeamOverlayTabs([{ tab: teamTimelineTab, mode: teamTimelineMode }]);
                      }
                      return next;
                    })
                  }
                >
                  Overlay
                </button>
                </div>
              }
            >
              {stackTeamTimelines ? (
                <TeamTimelineOverlayPanel
                  getValues={getTeamTimelineValues}
                  players={query.data.participants}
                  timelineMinutes={timelineMinutes}
                  selectedTabs={teamOverlayTabs}
                />
              ) : teamTimelineTab === "items" ? (
                <ItemTimingTimeline
                  players={query.data.participants}
                  timelineMinutes={timelineMinutes}
                  onlyCoreItems={teamTimelineMode === "perMinute"}
                />
              ) : (
                <TeamTimelinePanel
                  radiantValues={getTeamTimelineValues(teamTimelineTab, teamTimelineMode).radiant}
                  direValues={getTeamTimelineValues(teamTimelineTab, teamTimelineMode).dire}
                  timelineMinutes={timelineMinutes}
                  selectedMode={teamTimelineMode}
                  title={
                    teamTimelineTab === "vision"
                      ? teamTimelineMode === "perMinute"
                        ? hasReliableObserverActiveState
                          ? "Active observer wards"
                          : "Active observer wards unavailable"
                        : "Cumulative observer wards placed"
                      : formatTimelineModeLabel(timelineTabs.find((entry) => entry.key === teamTimelineTab)?.label ?? teamTimelineTab, teamTimelineMode)
                  }
                />
              )}
            </Card>

            <Card
              title="Player timelines"
              extra={
                <div className="split-tab-grid">
                {timelineTabs.map((tab) => (
                  <div key={tab.key} className="split-tab-group">
                    <span className="split-tab-icon" title={tab.label}>
                      <TimelineMetricIcon type={tab.key} />
                    </span>
                    <button
                      type="button"
                      className={`split-tab-button ${
                        stackPlayerTimelines
                          ? isOverlaySelectionActive(playerOverlayTabs, tab.key, "perMinute")
                            ? "active"
                            : ""
                          : timelineTab === tab.key && timelineMode === "perMinute"
                            ? "active"
                            : ""
                      }`}
                      aria-label={formatTimelineModeLabel(tab.label, "perMinute")}
                      title={formatTimelineModeLabel(tab.label, "perMinute")}
                      onClick={() => selectPlayerTimeline(tab.key, "perMinute")}
                    />
                    <button
                      type="button"
                      className={`split-tab-button ${
                        stackPlayerTimelines
                          ? isOverlaySelectionActive(playerOverlayTabs, tab.key, "cumulative")
                            ? "active"
                            : ""
                          : timelineTab === tab.key && timelineMode === "cumulative"
                            ? "active"
                            : ""
                      }`}
                      aria-label={formatTimelineModeLabel(tab.label, "cumulative")}
                      title={formatTimelineModeLabel(tab.label, "cumulative")}
                      onClick={() => selectPlayerTimeline(tab.key, "cumulative")}
                    />
                  </div>
                ))}
                <div className="split-tab-group">
                  <span className="split-tab-icon" title="Items">
                    <TimelineMetricIcon type="items" />
                  </span>
                  <button
                    type="button"
                    className={`split-tab-button ${
                      stackPlayerTimelines
                        ? isOverlaySelectionActive(playerOverlayTabs, "items", "perMinute")
                          ? "active"
                          : ""
                        : timelineTab === "items" && timelineMode === "perMinute"
                          ? "active"
                          : ""
                    }`}
                    aria-label="Items core and completed"
                    title="Items: core/completed"
                    onClick={() => selectPlayerTimeline("items", "perMinute")}
                  />
                  <button
                    type="button"
                    className={`split-tab-button ${
                      stackPlayerTimelines
                        ? isOverlaySelectionActive(playerOverlayTabs, "items", "cumulative")
                          ? "active"
                          : ""
                        : timelineTab === "items" && timelineMode === "cumulative"
                          ? "active"
                          : ""
                    }`}
                    aria-label="Items all purchases"
                    title="Items: all purchases"
                    onClick={() => selectPlayerTimeline("items", "cumulative")}
                  />
                </div>
                <button
                  type="button"
                  className={`timeline-stack-toggle ${stackPlayerTimelines ? "active" : ""}`}
                  onClick={() =>
                    setStackPlayerTimelines((value) => {
                      const next = !value;
                      if (next && playerOverlayTabs.length === 0) {
                        setPlayerOverlayTabs([{ tab: timelineTab, mode: timelineMode }]);
                      }
                      return next;
                    })
                  }
                >
                  Overlay
                </button>
                </div>
              }
            >
              {stackPlayerTimelines ? (
                <MultiPlayerTimelineOverlay
                  players={query.data.participants}
                  timelineMinutes={timelineMinutes}
                  selectedTabs={playerOverlayTabs}
                  hiddenKeys={hiddenTimelineKeys}
                  onTogglePlayer={(key) =>
                    setHiddenTimelineKeys((current) =>
                      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
                    )
                  }
                />
              ) : (
                <MultiPlayerTimeline
                  players={query.data.participants}
                  timelineMinutes={timelineMinutes}
                  selectedTab={timelineTab}
                  selectedMode={timelineMode}
                  hiddenKeys={hiddenTimelineKeys}
                  onTogglePlayer={(key) =>
                    setHiddenTimelineKeys((current) =>
                      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]
                    )
                  }
                  title={
                    timelineTab === "vision"
                      ? timelineMode === "perMinute"
                        ? "Observer wards placed"
                        : "Cumulative observer wards placed"
                      : formatTimelineModeLabel(timelineTabs.find((entry) => entry.key === timelineTab)?.label ?? timelineTab, timelineMode)
                  }
                />
              )}
            </Card>
          </div>
          </div>

          <div className={activeMatchTab === "rosters" ? "tab-panel" : "tab-panel hidden"}>
          <div className="roster-timeline-sticky">
            <Card
              title="Roster timeline"
              extra={<span className="muted-inline">{formatDuration(rosterSecond)}</span>}
            >
              <div className="vision-map-controls">
                <input
                  type="range"
                  min={0}
                  max={Math.ceil(rosterMaxSecond)}
                  value={Math.min(rosterSecond, Math.ceil(rosterMaxSecond))}
                  onChange={(event) => setRosterSecond(Number(event.target.value))}
                />
              </div>
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
                    const goldAtTime = getTimelineValueAt(totalTimeline(player.goldTimeline), rosterMinuteIndex);
                    const xpAtTime = getTimelineValueAt(totalTimeline(player.xpTimeline), rosterMinuteIndex);
                    const lastHitsAtTime = getTimelineValueAt(totalTimeline(player.lastHitsTimeline), rosterMinuteIndex);
                    const deniesAtTime = getTimelineValueAt(totalTimeline(player.deniesTimeline), rosterMinuteIndex);
                    const heroDamageAtTime = getTimelineValueAt(totalTimeline(player.heroDamageTimeline), rosterMinuteIndex);
                    const damageTakenAtTime = getTimelineValueAt(totalTimeline(player.damageTakenTimeline), rosterMinuteIndex);
                    const levelAtTime = getLevelFromXp(xpAtTime);
                    const gpmAtTime = getTimelineValueAt(perMinuteTimeline(player.goldTimeline), rosterMinuteIndex);
                    const xpmAtTime = getTimelineValueAt(perMinuteTimeline(player.xpTimeline), rosterMinuteIndex);
                    const rosterInventory = getRosterInventory(player, rosterSecond, rosterMaxSecond);
                    const observerPlacementsAtTime = getTimelineWardPlacementCount(player.observerLog, rosterSecond);
                    const sentryPlacementsAtTime = getTimelineWardPlacementCount(player.sentryLog, rosterSecond);
                    const wardEfficiencyAtTime = getWardEfficiencyPercent(player.observerLog, rosterSecond, 360);
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
                            <strong>{formatNumber(goldAtTime ?? player.netWorth)}</strong>
                          </div>
                          <div>
                            <span className="eyebrow">Farm</span>
                            <strong>
                              {formatNumber(gpmAtTime ?? player.gpm)} GPM / {formatNumber(xpmAtTime ?? player.xpm)} XPM
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">Damage</span>
                            <strong>
                              {formatNumber(heroDamageAtTime ?? player.heroDamage)} hero / {formatNumber(damageTakenAtTime)} taken
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">CS</span>
                            <strong>
                              {formatNumber(lastHitsAtTime ?? player.lastHits)} LH / {formatNumber(deniesAtTime ?? player.denies)} DN
                            </strong>
                          </div>
                          <div>
                            <span className="eyebrow">Level</span>
                            <strong>{formatNumber(levelAtTime ?? player.level)}</strong>
                          </div>
                        </div>

                        <div className="player-build">
                          <span className="eyebrow">Inventory</span>
                            <div className="inventory-panel">
                            <div className="inventory-top-row">
                            <div className="inventory-grid">
                                {rosterInventory.inventory.map((item, slotIndex) => (
                                  <span
                                    key={item?.key ?? `inventory-${slotIndex}`}
                                    className={`item-slot inventory${item ? "" : " empty"}`}
                                    title={item?.name ?? `Inventory slot ${slotIndex + 1}`}
                                  >
                                    {item ? <IconImage src={item.imageUrl} alt={item.name} size="sm" rounded={false} /> : null}
                                    {item?.count && item.count > 1 ? <span className="item-slot-count">{item.count}</span> : null}
                                  </span>
                                ))}
                            </div>
                            </div>
                            <div className="inventory-meta-row">
                              <span className="eyebrow">Backpack</span>
                              <div className="backpack-grid">
                                {rosterInventory.backpack.map((item, slotIndex) => (
                                  <span
                                    key={item?.key ?? `backpack-${slotIndex}`}
                                    className={`item-slot backpack${item ? "" : " empty"}`}
                                    title={item?.name ?? `Backpack slot ${slotIndex + 1}`}
                                  >
                                    {item ? <IconImage src={item.imageUrl} alt={item.name} size="sm" rounded={false} /> : null}
                                    {item?.count && item.count > 1 ? <span className="item-slot-count">{item.count}</span> : null}
                                  </span>
                                ))}
                              </div>
                              <span
                                className={`item-slot utility tp-slot${rosterInventory.teleport ? "" : " empty"}`}
                                title={rosterInventory.teleport?.name ?? "Teleport scroll slot"}
                              >
                                {rosterInventory.teleport ? (
                                  <IconImage
                                    src={rosterInventory.teleport.imageUrl}
                                    alt={rosterInventory.teleport.name}
                                    size="sm"
                                    rounded={false}
                                  />
                                ) : (
                                  <span className="slot-placeholder-icon">
                                    <IconImage
                                      src={getItemImageUrl("tpscroll")}
                                      alt="Teleport scroll slot"
                                      size="sm"
                                      rounded={false}
                                    />
                                  </span>
                                )}
                                  {rosterInventory.teleport?.count && rosterInventory.teleport.count > 1 ? (
                                    <span className="item-slot-count">{rosterInventory.teleport.count}</span>
                                  ) : null}
                                </span>
                              </div>
                          </div>
                        </div>

                        <div className="player-build">
                          <span className="eyebrow">Vision and utility</span>
                          <div className="player-metrics">
                            <div>
                              <span className="eyebrow">Observers</span>
                              <strong>{formatNumber(observerPlacementsAtTime)}</strong>
                            </div>
                            <div>
                              <span className="eyebrow">Sentries</span>
                              <strong>{formatNumber(sentryPlacementsAtTime)}</strong>
                            </div>
                            <div>
                              <span className="eyebrow">Ward efficiency</span>
                              <strong>{wardEfficiencyAtTime === null ? "No data" : formatPercent(wardEfficiencyAtTime)}</strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
          </div>
        </>
      ) : null}
    </Page>
  );
}
