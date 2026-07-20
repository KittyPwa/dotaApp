import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import type { CustomTeam, CustomTeamHeroEvaluation, CustomTeamImportRequest, HeroEvaluationMetrics } from "@dota/shared";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { Page } from "../components/Page";
import { EmptyState, LoadingState } from "../components/State";
import {
  useDeleteDraftPlan,
  useCreateCustomTeam,
  useCustomTeamEvaluations,
  useCustomTeams,
  useDraftContext,
  useDraftPlans,
  useHeroRoster,
  useHeroStats,
  useImportCustomTeamEvaluations,
  useLeague,
  useLeagueTeam,
  useSaveDraftPlan,
  useSettings,
  useUpdateCustomTeam
} from "../hooks/useQueries";
import {
  createEmptyDraft,
  normalizeDraftPlanOrder,
  type DraftPlan,
  type DraftSide,
  type DraftSlot
} from "../lib/draftStorage";
import { formatNumber } from "../lib/format";
import { ensureLocalDraftOwnerKey, getLocalDraftOwnerKey, normalizeDraftOwnerCode, setLocalDraftOwnerCode } from "../api/client";

type HeroOption = {
  heroId: number;
  heroName: string;
  heroIconUrl: string | null;
  primaryAttr: string | null;
  games: number;
  winrate: number;
};

type PickerFilter = "attribute" | "league" | "suggestion";
type EvaluationChoice = {
  playerKey: string;
  playerName: string;
  metrics: HeroEvaluationMetrics;
  color: string;
};
type HeroSuggestion = HeroOption & {
  score: number;
  metricLabel: string;
  playerName: string | null;
  playerKey: string | null;
};
type PlayerComfortColumn = {
  playerId: number | null;
  name: string;
  side: DraftSide;
  totalGames: number;
  heroes: HeroOption[];
};
type DraftCombo = {
  side: DraftSide;
  label: string;
  games: number;
  wins: number;
  winrate: number;
  heroes: HeroOption[];
};
type HeroDraftState = "ban" | "pick";
type DraftLibraryGroup = {
  key: string;
  title: string;
  drafts: Array<{ draft: DraftPlan; matchup: string }>;
};
type DraftTeamOption = { teamId: number; name: string; tag: string | null; isCustom?: boolean };

const evaluationMetricKeys: Array<{ key: keyof HeroEvaluationMetrics; label: string }> = [
  { key: "save", label: "Save" },
  { key: "control", label: "Control" },
  { key: "enabler", label: "Enable" },
  { key: "mobility", label: "Mobility" },
  { key: "teamfight", label: "Fight" },
  { key: "initiation", label: "Init" },
  { key: "heroDamage", label: "Hero dmg" },
  { key: "buildingDamage", label: "Building" },
  { key: "farmDependency", label: "Farm" }
];

const playerColorPalette = ["#33d399", "#f59e0b", "#60a5fa", "#f472b6", "#a78bfa", "#fb7185", "#2dd4bf", "#facc15"];

function playerColorForKey(playerKey: string) {
  let hash = 0;
  for (const char of playerKey) {
    hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  }
  return playerColorPalette[hash % playerColorPalette.length];
}

function getTeamName(teams: DraftTeamOption[], teamId: number | null) {
  if (!teamId) return null;
  const team = teams.find((entry) => entry.teamId === teamId);
  return team ? `${team.name}${team.tag ? ` (${team.tag})` : ""}${team.isCustom ? " - custom" : ""}` : `Team ${teamId}`;
}

function groupDraftsByTeam(drafts: DraftPlan[], teams: DraftTeamOption[]) {
  const groups = new Map<string, DraftLibraryGroup>();
  const ensureGroup = (key: string, title: string) => {
    const existing = groups.get(key);
    if (existing) return existing;
    const group = { key, title, drafts: [] };
    groups.set(key, group);
    return group;
  };

  for (const draft of drafts) {
    const ownerTeamId = draft.firstTeamId ?? draft.secondTeamId;
    const ownerName = getTeamName(teams, ownerTeamId) ?? "Unassigned";
    const opponentTeamId = ownerTeamId === draft.firstTeamId ? draft.secondTeamId : draft.firstTeamId;
    const opponentName = getTeamName(teams, opponentTeamId);
    const matchup = opponentName ? `vs ${opponentName}` : "No opponent assigned";
    ensureGroup(ownerTeamId ? `team-${ownerTeamId}` : "unassigned", ownerName).drafts.push({ draft, matchup });
  }

  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title));
}

function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const [headers, ...body] = rows;
  if (!headers) return [];
  return body.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), cells[index]?.trim() ?? ""]))
  );
}

function evaluationChoicesByHero(evaluations: CustomTeamHeroEvaluation[]) {
  const byHero = new Map<number, EvaluationChoice[]>();
  for (const evaluation of evaluations) {
    if (evaluation.heroId === null) continue;
    const list = byHero.get(evaluation.heroId) ?? [];
    list.push({
      playerKey: evaluation.playerKey,
      playerName: evaluation.pseudonym,
      metrics: evaluation.metrics,
      color: playerColorForKey(evaluation.playerKey)
    });
    byHero.set(evaluation.heroId, list);
  }
  return byHero;
}

function sumEvaluationMetrics(
  evaluations: CustomTeamHeroEvaluation[],
  selectedHeroes: Array<{ heroId: number; playerKey: string | null }>
) {
  const byHero = evaluationChoicesByHero(evaluations);
  const selected = selectedHeroes
    .map(({ heroId, playerKey }) => {
      const choices = byHero.get(heroId) ?? [];
      if (choices.length === 1) return choices[0];
      return playerKey ? choices.find((choice) => choice.playerKey === playerKey) ?? null : null;
    })
    .filter((entry): entry is EvaluationChoice => Boolean(entry));
  if (!selected.length) return null;
  const totals = Object.fromEntries(evaluationMetricKeys.map(({ key }) => [key, 0])) as Record<keyof HeroEvaluationMetrics, number>;
  for (const evaluation of selected) {
    for (const { key } of evaluationMetricKeys) {
      totals[key] += evaluation.metrics[key];
    }
  }
  return Object.fromEntries(evaluationMetricKeys.map(({ key }) => [key, Number(totals[key].toFixed(1))])) as HeroEvaluationMetrics;
}

function buildEvaluationSuggestions(
  heroOptions: HeroOption[],
  evaluations: CustomTeamHeroEvaluation[],
  currentMetrics: HeroEvaluationMetrics | null,
  heroDraftState: Map<number, HeroDraftState>
): HeroSuggestion[] {
  const missingMetric =
    evaluationMetricKeys
      .map((metric) => ({ ...metric, value: currentMetrics?.[metric.key] ?? 0 }))
      .sort((left, right) => left.value - right.value)[0] ?? evaluationMetricKeys[0];
  const choices = evaluationChoicesByHero(evaluations);
  return heroOptions
    .map((hero) => {
      if (heroDraftState.has(hero.heroId)) return null;
      const heroChoices = choices.get(hero.heroId) ?? [];
      if (!heroChoices.length) return null;
      const best = [...heroChoices].sort((left, right) => right.metrics[missingMetric.key] - left.metrics[missingMetric.key])[0];
      return {
        ...hero,
        score: best.metrics[missingMetric.key],
        metricLabel: missingMetric.label,
        playerName: heroChoices.length > 1 ? best.playerName : null,
        playerKey: heroChoices.length > 1 ? best.playerKey : null
      };
    })
    .filter((entry): entry is HeroSuggestion => Boolean(entry))
    .sort((left, right) => right.score - left.score || right.games - left.games || left.heroName.localeCompare(right.heroName))
    .slice(0, 36);
}

function evaluationHeroOptions(evaluations: CustomTeamHeroEvaluation[], heroesById: Map<number, HeroOption>): HeroOption[] {
  const byHero = new Map<number, { evaluation: CustomTeamHeroEvaluation; count: number }>();
  for (const evaluation of evaluations) {
    if (evaluation.heroId === null) continue;
    const current = byHero.get(evaluation.heroId) ?? { evaluation, count: 0 };
    current.count += 1;
    byHero.set(evaluation.heroId, current);
  }
  return [...byHero.entries()]
    .map(([heroId, entry]) => ({
      heroId,
      heroName: heroesById.get(heroId)?.heroName ?? entry.evaluation.heroName,
      heroIconUrl: heroesById.get(heroId)?.heroIconUrl ?? entry.evaluation.heroIconUrl,
      primaryAttr: heroesById.get(heroId)?.primaryAttr ?? null,
      games: entry.count,
      winrate: 0
    }))
    .sort((left, right) => right.games - left.games || left.heroName.localeCompare(right.heroName));
}

function normalizeImportRows(rows: Record<string, string>[]): CustomTeamImportRequest["rows"] {
  const numberValue = (row: Record<string, string>, key: string) => {
    const value = Number(row[key] ?? 0);
    return Number.isFinite(value) ? value : 0;
  };
  return rows
    .filter((row) => row.pseudonym?.trim() && row.hero_id?.trim())
    .map((row) => ({
      player_id: row.player_id?.trim() || null,
      steam_id: row.steam_id?.trim() || null,
      pseudonym: row.pseudonym.trim(),
      hero_id: row.hero_id.trim(),
      save: numberValue(row, "save"),
      control: numberValue(row, "control"),
      enabler: numberValue(row, "enabler"),
      mobility: numberValue(row, "mobility"),
      teamfight: numberValue(row, "teamfight"),
      initiation: numberValue(row, "initiation"),
      hero_damage: numberValue(row, "hero_damage"),
      building_damage: numberValue(row, "building_damage"),
      farm_dependency: numberValue(row, "farm_dependency")
    }));
}

function DraftHeroChip({
  hero,
  onRemove
}: {
  hero: HeroOption | undefined;
  onRemove: () => void;
}) {
  return (
    <button type="button" className="draft-hero-chip" onClick={onRemove} title={hero?.heroName ?? "Unknown hero"}>
      <IconImage src={hero?.heroIconUrl} alt={hero?.heroName ?? "Unknown hero"} size="sm" />
    </button>
  );
}

function DraftSlotCard({
  slot,
  side,
  heroesById,
  onOpenPicker,
  onChange
}: {
  slot: DraftSlot;
  side: DraftSide;
  heroesById: Map<number, HeroOption>;
  onOpenPicker: () => void;
  onChange: (heroIds: number[]) => void;
}) {
  const variants = side === "first" ? [...slot.heroIds].reverse() : slot.heroIds;

  return (
    <div className={`draft-slot-card ${slot.kind} ${side}`}>
      <div className="draft-slot-label">
        <strong>{slot.label}</strong>
      </div>
      <div className="draft-slot-variants">
        {variants.map((heroId) => (
          <DraftHeroChip
            key={heroId}
            hero={heroesById.get(heroId)}
            onRemove={() => onChange(slot.heroIds.filter((entry) => entry !== heroId))}
          />
        ))}
        <button type="button" className="draft-add-hero-button" onClick={onOpenPicker}>
          +
        </button>
      </div>
    </div>
  );
}

function normalizeAttr(value: string | null | undefined) {
  if (value === "str" || value === "strength") return "Strength";
  if (value === "agi" || value === "agility") return "Agility";
  if (value === "int" || value === "intelligence") return "Intelligence";
  if (value === "all" || value === "universal") return "Universal";
  return "Unknown";
}

function heroButtonClass(
  heroId: number,
  currentSlotHeroIds: Set<number>,
  heroDraftState: Map<number, HeroDraftState>,
  recommended = false,
  evaluated = false
) {
  return [
    currentSlotHeroIds.has(heroId) ? "current" : "",
    !currentSlotHeroIds.has(heroId) && heroDraftState.get(heroId) === "ban" ? "banned" : "",
    !currentSlotHeroIds.has(heroId) && heroDraftState.get(heroId) === "pick" ? "picked" : "",
    recommended ? "recommended" : "",
    evaluated ? "evaluated" : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function EvaluationRadar({ title, metrics, emptyLabel }: { title: string; metrics: HeroEvaluationMetrics | null; emptyLabel: string }) {
  if (!metrics) {
    return (
      <div className="draft-evaluation-card">
        <strong>{title}</strong>
        <small>{emptyLabel}</small>
      </div>
    );
  }
  const center = 50;
  const radius = 36;
  const points = evaluationMetricKeys
    .map(({ key }, index) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / evaluationMetricKeys.length;
      const valueRadius = radius * Math.max(0, Math.min(25, metrics[key])) / 25;
      return `${center + Math.cos(angle) * valueRadius},${center + Math.sin(angle) * valueRadius}`;
    })
    .join(" ");

  return (
    <div className="draft-evaluation-card">
      <strong>{title}</strong>
      <svg className="draft-evaluation-radar" viewBox="0 0 100 100" role="img" aria-label={`${title} evaluation radar`}>
        {[1, 2, 3, 4, 5].map((step) => {
          const gridRadius = (radius * step) / 5;
          const gridPoints = evaluationMetricKeys
            .map((_, index) => {
              const angle = -Math.PI / 2 + (Math.PI * 2 * index) / evaluationMetricKeys.length;
              return `${center + Math.cos(angle) * gridRadius},${center + Math.sin(angle) * gridRadius}`;
            })
            .join(" ");
          return <polygon key={step} points={gridPoints} className="radar-grid" />;
        })}
        {evaluationMetricKeys.map(({ label }, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index) / evaluationMetricKeys.length;
          return (
            <text key={label} x={center + Math.cos(angle) * 45} y={center + Math.sin(angle) * 45} textAnchor="middle">
              {label}
            </text>
          );
        })}
        <polygon points={points} className="radar-value" />
      </svg>
      <small>Sum of unique selected evaluated heroes, capped at 25.</small>
    </div>
  );
}

function ComboRelationshipGraph({
  side,
  combos,
  currentSlotHeroIds,
  heroDraftState,
  onPick
}: {
  side: DraftSide;
  combos: DraftCombo[];
  currentSlotHeroIds: Set<number>;
  heroDraftState: Map<number, HeroDraftState>;
  onPick: (heroId: number) => void;
}) {
  const [minimumGames, setMinimumGames] = useState(2);
  const availableCombos = combos
    .filter((combo) => combo.side === side && combo.heroes.length >= 2)
    .sort((left, right) => right.games - left.games || right.winrate - left.winrate);
  const filteredCombos = availableCombos.filter((combo) => combo.games >= minimumGames);
  const sideCombos = (filteredCombos.length >= 6 ? filteredCombos : availableCombos).slice(0, 24);
  const graph = useMemo(() => {
    const heroMap = new Map<number, HeroOption & { comboGames: number; degree: number; x: number; y: number; vx: number; vy: number }>();
    const links: Array<{
      key: string;
      sourceId: number;
      targetId: number;
      games: number;
      winrate: number;
    }> = [];

    for (const combo of sideCombos) {
      const [left, right] = combo.heroes;
      if (!left || !right) continue;
      for (const hero of [left, right]) {
        const seed = (hero.heroId * 9301 + 49297) % 233280;
        const angle = (seed / 233280) * Math.PI * 2;
        const radius = 18 + (seed % 22);
        const existing = heroMap.get(hero.heroId) ?? {
          ...hero,
          comboGames: 0,
          degree: 0,
          x: 50 + Math.cos(angle) * radius,
          y: 50 + Math.sin(angle) * radius * 0.72,
          vx: 0,
          vy: 0
        };
        existing.comboGames += combo.games;
        existing.degree += 1;
        heroMap.set(hero.heroId, existing);
      }
      links.push({
        key: `${left.heroId}-${right.heroId}`,
        sourceId: left.heroId,
        targetId: right.heroId,
        games: combo.games,
        winrate: combo.winrate
      });
    }

    const nodes = [...heroMap.values()].sort(
      (left, right) => right.degree - left.degree || right.comboGames - left.comboGames || left.heroName.localeCompare(right.heroName)
    );

    const nodeMap = new Map(nodes.map((node) => [node.heroId, node]));
    for (let tick = 0; tick < 180; tick += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const left = nodes[i];
          const right = nodes[j];
          const dx = right.x - left.x || 0.01;
          const dy = right.y - left.y || 0.01;
          const distanceSquared = Math.max(dx * dx + dy * dy, 24);
          const force = 24 / distanceSquared;
          left.vx -= dx * force;
          left.vy -= dy * force;
          right.vx += dx * force;
          right.vy += dy * force;
        }
      }

      for (const link of links) {
        const source = nodeMap.get(link.sourceId);
        const target = nodeMap.get(link.targetId);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
        const desired = Math.max(12, 27 - Math.min(link.games, 12));
        const force = (distance - desired) * 0.0045;
        const fx = dx * force;
        const fy = dy * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }

      for (const node of nodes) {
        node.vx += (50 - node.x) * 0.004;
        node.vy += (50 - node.y) * 0.004;
        node.x = Math.min(92, Math.max(8, node.x + node.vx));
        node.y = Math.min(88, Math.max(12, node.y + node.vy));
        node.vx *= 0.82;
        node.vy *= 0.82;
      }
    }

    return { nodes, links, nodeMap };
  }, [sideCombos]);

  if (sideCombos.length === 0) {
    return <EmptyState label="No local combo data for this side yet." />;
  }

  return (
    <div className="draft-combo-network-shell">
      <div className="draft-combo-density">
        {[1, 2, 3].map((value) => (
          <button
            key={value}
            type="button"
            className={minimumGames === value ? "active" : ""}
            onClick={() => setMinimumGames(value)}
          >
            {value}+
          </button>
        ))}
        <span>
          {formatNumber(sideCombos.length)} links shown
        </span>
      </div>
      <div className={`draft-combo-network ${side}`}>
        <svg className="draft-combo-network-svg" viewBox="0 0 100 100" aria-hidden="true">
          <g>
            {graph.links.map((link) => {
              const source = graph.nodeMap.get(link.sourceId);
              const target = graph.nodeMap.get(link.targetId);
              if (!source || !target) return null;
              const labelX = (source.x + target.x) / 2;
              const labelY = (source.y + target.y) / 2;
              return (
                <g key={link.key}>
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="draft-combo-network-link" />
                  <foreignObject x={labelX - 4.4} y={labelY - 2.8} width="8.8" height="5.6">
                    <div className="draft-combo-edge-label">{formatNumber(link.games)}</div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
        {graph.nodes.map((hero) => (
          <button
            key={hero.heroId}
            type="button"
            className={`draft-combo-network-node ${heroButtonClass(hero.heroId, currentSlotHeroIds, heroDraftState, true)}`}
            style={{ left: `${hero.x}%`, top: `${hero.y}%` }}
            title={`${hero.heroName} | ${formatNumber(hero.comboGames)} combo appearances`}
            onClick={() => onPick(hero.heroId)}
          >
            <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="md" />
          </button>
        ))}
      </div>
    </div>
  );
}

function HeroPickerModal({
  open,
  slot,
  heroOptions,
  currentSlotHeroIds,
  heroDraftState,
  evaluatedHeroes,
  suggestions,
  onClose,
  onPick
}: {
  open: boolean;
  slot: DraftSlot | null;
  heroOptions: HeroOption[];
  currentSlotHeroIds: Set<number>;
  heroDraftState: Map<number, HeroDraftState>;
  evaluatedHeroes: Map<number, EvaluationChoice[]>;
  suggestions: HeroSuggestion[];
  onClose: () => void;
  onPick: (heroId: number, playerKey?: string | null) => void;
}) {
  const [filter, setFilter] = useState<PickerFilter>("attribute");
  const [search, setSearch] = useState("");
  const [pendingHero, setPendingHero] = useState<HeroOption | null>(null);
  if (!open || !slot) return null;

  const searchedHeroes = heroOptions.filter((hero) => hero.heroName.toLowerCase().includes(search.trim().toLowerCase()));
  const searchedSuggestions = suggestions.filter((hero) => hero.heroName.toLowerCase().includes(search.trim().toLowerCase()));
  const attrGroups = ["Strength", "Agility", "Intelligence", "Universal"].map((label) => ({
    label,
    heroes: searchedHeroes.filter((hero) => normalizeAttr(hero.primaryAttr) === label)
  }));
  const groups =
    filter === "attribute"
      ? attrGroups
      : filter === "suggestion"
        ? [
            {
              label: searchedSuggestions[0]?.metricLabel ? `Needs ${searchedSuggestions[0].metricLabel}` : "Suggestions",
              heroes: searchedSuggestions
            }
          ]
        : [
          {
            label: "League pick rate",
            heroes: searchedHeroes
          }
        ];
  const pickHero = (hero: HeroOption) => {
    const choices = evaluatedHeroes.get(hero.heroId) ?? [];
    if (slot.kind === "pick" && !currentSlotHeroIds.has(hero.heroId) && choices.length > 1) {
      setPendingHero(hero);
      return;
    }
    onPick(hero.heroId, choices.length === 1 ? choices[0].playerKey : null);
  };
  const heroStyle = (heroId: number) => {
    const choices = evaluatedHeroes.get(heroId) ?? [];
    if (!choices.length) return undefined;
    return { "--evaluation-color": choices[0].color } as CSSProperties;
  };

  return (
    <div className="draft-picker-backdrop" role="presentation" onClick={onClose}>
      <div className="draft-picker-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="draft-picker-header">
          <div>
            <h2>Select hero</h2>
            <span>
              {slot.label} {slot.kind}
            </span>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="draft-picker-controls">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search hero" autoFocus />
          <div className="segmented-control">
            {[
              ["attribute", "Attributes"],
              ["league", "League"],
              ["suggestion", "Suggestion"]
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "active" : ""}
                onClick={() => setFilter(key as PickerFilter)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className={`draft-picker-groups ${filter !== "attribute" ? "full-width" : ""}`}>
          {groups.map((group) => (
            <section key={group.label} className="draft-picker-group">
              <h3>{group.label}</h3>
              <div className="draft-picker-hero-grid">
                {group.heroes.map((hero) => (
                  <button
                    key={hero.heroId}
                    type="button"
                    className={heroButtonClass(hero.heroId, currentSlotHeroIds, heroDraftState, filter === "suggestion", evaluatedHeroes.has(hero.heroId))}
                    style={heroStyle(hero.heroId)}
                    title={`${hero.heroName} | ${formatNumber(hero.games)} games | ${hero.winrate}%`}
                    onClick={() => pickHero(hero)}
                  >
                    <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="md" />
                    {(evaluatedHeroes.get(hero.heroId) ?? []).length > 1 ? (
                      <span className="draft-evaluation-dots">
                        {(evaluatedHeroes.get(hero.heroId) ?? []).slice(0, 4).map((choice) => (
                          <i key={choice.playerKey} style={{ background: choice.color }} />
                        ))}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        {pendingHero ? (
          <div className="draft-player-assignment" role="dialog" aria-modal="true" aria-label="Assign player">
            <div>
              <strong>Assign {pendingHero.heroName}</strong>
              <small>Choose which player row should count for this pick.</small>
            </div>
            <div className="draft-player-assignment-list">
              {(evaluatedHeroes.get(pendingHero.heroId) ?? []).map((choice) => (
                <button
                  key={choice.playerKey}
                  type="button"
                  style={{ "--evaluation-color": choice.color } as CSSProperties}
                  onClick={() => {
                    onPick(pendingHero.heroId, choice.playerKey);
                    setPendingHero(null);
                  }}
                >
                  <span />
                  {choice.playerName}
                </button>
              ))}
            </div>
            <button type="button" className="ghost-button compact" onClick={() => setPendingHero(null)}>
              Cancel
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SuggestionList({
  title,
  heroes,
  onPick
}: {
  title: string;
  heroes: HeroOption[];
  onPick: (heroId: number) => void;
}) {
  return (
    <Card title={title}>
      {heroes.length ? (
        <div className="draft-suggestion-list">
          {heroes.slice(0, 12).map((hero) => (
            <button key={hero.heroId} type="button" className="draft-suggestion" onClick={() => onPick(hero.heroId)}>
              <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
              <span>{hero.heroName}</span>
              <small>
                {formatNumber(hero.games)} games · {hero.winrate}%
              </small>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState label="No local hero data for this filter yet." />
      )}
    </Card>
  );
}

function DraftTeamContextPanel({
  title,
  teamName,
  heroes,
  comfortColumns,
  side
}: {
  title: string;
  teamName: string;
  heroes: HeroOption[];
  comfortColumns: PlayerComfortColumn[];
  side: DraftSide;
}) {
  return (
    <aside className={`draft-team-context ${side}`}>
      <div>
        <span>{title}</span>
        <h3>{teamName}</h3>
      </div>
      <section>
        <h4>Team pool</h4>
        <div className="draft-context-hero-strip">
          {heroes.slice(0, 12).map((hero) => (
            <span key={hero.heroId} title={`${hero.heroName} | ${formatNumber(hero.games)} games`}>
              <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
            </span>
          ))}
          {!heroes.length ? <small>No team hero data yet.</small> : null}
        </div>
      </section>
      <section>
        <h4>Player comforts</h4>
        <div className="draft-context-comforts">
          {comfortColumns.map((column) => (
            <div key={`${column.side}-${column.playerId ?? column.name}`} className="draft-context-comfort-column">
              <strong>{column.name}</strong>
              <div>
                {column.heroes.slice(0, 6).map((hero) => (
                  <span key={hero.heroId} title={`${hero.heroName} | ${formatNumber(hero.games)} games | ${hero.winrate}%`}>
                    <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                    <small>{formatNumber(hero.games)}</small>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {!comfortColumns.length ? <small>Assign a team with local data to see comfort picks.</small> : null}
        </div>
      </section>
    </aside>
  );
}

function DraftLeagueLibrarySection({
  leagueId,
  leagueName,
  drafts,
  onOpenDraft,
  onDeleteDraft
}: {
  leagueId: number;
  leagueName: string;
  drafts: DraftPlan[];
  onOpenDraft: (draft: DraftPlan) => void;
  onDeleteDraft: (draft: DraftPlan) => void;
}) {
  const league = useLeague(leagueId);
  const groups = useMemo(
    () => groupDraftsByTeam([...drafts].sort((left, right) => right.updatedAt - left.updatedAt), league.data?.teams ?? []),
    [drafts, league.data?.teams]
  );

  return (
    <section className="draft-league-library-section">
      <div className="draft-league-library-header">
        <h3>{league.data?.name ?? leagueName}</h3>
        <span>{formatNumber(drafts.length)} drafts</span>
      </div>
      {groups.length ? (
        <div className="draft-library">
          {groups.map((group) => (
            <section key={`${leagueId}-${group.key}`} className="draft-library-group">
              <div className="draft-library-group-header">
                <h4>{group.title}</h4>
              </div>
              <div className="draft-library-links">
                {group.drafts.map(({ draft, matchup }) => (
                  <div key={`${group.key}-${draft.id}`} className="draft-library-link">
                    <button type="button" onClick={() => onOpenDraft(draft)}>
                      <strong>{draft.name}</strong>
                      <span>{matchup}</span>
                    </button>
                    <button type="button" className="ghost-button compact" onClick={() => onDeleteDraft(draft)}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState label="No saved drafts for this league yet." />
      )}
    </section>
  );
}

function CustomTeamCard({
  team,
  saving,
  onSave,
  onDraft
}: {
  team: CustomTeam;
  saving: boolean;
  onSave: (teamId: number, values: { name: string; tag: string | null }) => void;
  onDraft: (teamId: number) => void;
}) {
  const [name, setName] = useState(team.name);
  const [tag, setTag] = useState(team.tag ?? "");

  useEffect(() => {
    setName(team.name);
    setTag(team.tag ?? "");
  }, [team.name, team.tag]);

  const changed = name.trim() !== team.name || (tag.trim() || null) !== team.tag;

  return (
    <article className="draft-team-card custom editable">
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Tag
        <input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Optional" />
      </label>
      <small>
        {formatNumber(team.evaluations)} evaluations · {formatNumber(team.heroes)} heroes · {formatNumber(team.players)} players
      </small>
      <div className="draft-team-card-actions">
        <button
          type="button"
          className="ghost-button compact"
          onClick={() => onSave(team.teamId, { name: name.trim(), tag: tag.trim() || null })}
          disabled={!name.trim() || !changed || saving}
        >
          Save
        </button>
        <button type="button" className="ghost-button compact" onClick={() => onDraft(team.teamId)}>
          Draft with team
        </button>
      </div>
    </article>
  );
}

export function DraftsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useSettings();
  const initialLeagueId = Number(searchParams.get("leagueId"));
  const [leagueId, setLeagueId] = useState<number | null>(
    Number.isInteger(initialLeagueId) && initialLeagueId > 0 ? initialLeagueId : null
  );
  const [drafts, setDrafts] = useState<DraftPlan[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(searchParams.get("draftId"));
  const [heroSearch, setHeroSearch] = useState("");
  const [draftOwnerKey, setDraftOwnerKey] = useState<string | null>(() => getLocalDraftOwnerKey());
  const [accessCodeInput, setAccessCodeInput] = useState(() => getLocalDraftOwnerKey() ?? "");
  const [accessCodeMessage, setAccessCodeMessage] = useState<string | null>(null);
  const [teamImportMessage, setTeamImportMessage] = useState<string | null>(null);
  const [customTeamName, setCustomTeamName] = useState("");
  const [draftSection, setDraftSection] = useState<"drafts" | "teams">("drafts");
  const [newAccessCode, setNewAccessCode] = useState<string | null>(null);
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);

  const league = useLeague(leagueId);
  const draftPlans = useDraftPlans(leagueId, draftOwnerKey !== null);
  const saveDraft = useSaveDraftPlan();
  const deleteDraft = useDeleteDraftPlan();
  const heroStats = useHeroStats({ leagueId });
  const heroRoster = useHeroRoster();
  const customTeams = useCustomTeams();
  const createCustomTeam = useCreateCustomTeam();
  const updateCustomTeam = useUpdateCustomTeam();
  const importCustomTeam = useImportCustomTeamEvaluations();
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const customTeamIds = useMemo(() => new Set((customTeams.data ?? []).map((team) => team.teamId)), [customTeams.data]);
  const firstLeagueTeamId = selectedDraft?.firstTeamId && selectedDraft.firstTeamId > 0 ? selectedDraft.firstTeamId : null;
  const secondLeagueTeamId = selectedDraft?.secondTeamId && selectedDraft.secondTeamId > 0 ? selectedDraft.secondTeamId : null;
  const firstTeam = useLeagueTeam(leagueId, firstLeagueTeamId);
  const secondTeam = useLeagueTeam(leagueId, secondLeagueTeamId);
  const firstEvaluationTeamId =
    selectedDraft?.firstTeamId && (selectedDraft.firstTeamId < 0 || customTeamIds.has(selectedDraft.firstTeamId))
      ? selectedDraft.firstTeamId
      : null;
  const secondEvaluationTeamId =
    selectedDraft?.secondTeamId && (selectedDraft.secondTeamId < 0 || customTeamIds.has(selectedDraft.secondTeamId))
      ? selectedDraft.secondTeamId
      : null;
  const firstTeamEvaluations = useCustomTeamEvaluations(firstEvaluationTeamId);
  const secondTeamEvaluations = useCustomTeamEvaluations(secondEvaluationTeamId);
  const firstTeamPlayerIds = useMemo(
    () =>
      (firstTeam.data?.players ?? [])
        .filter((player) => player.playerId !== null)
        .sort((left, right) => right.games - left.games)
        .slice(0, 5)
        .map((player) => player.playerId as number),
    [firstTeam.data?.players]
  );
  const secondTeamPlayerIds = useMemo(
    () =>
      (secondTeam.data?.players ?? [])
        .filter((player) => player.playerId !== null)
        .sort((left, right) => right.games - left.games)
        .slice(0, 5)
        .map((player) => player.playerId as number),
    [secondTeam.data?.players]
  );
  const draftContext = useDraftContext(firstTeamPlayerIds, secondTeamPlayerIds);

  useEffect(() => {
    if (draftPlans.data) {
      setDrafts(draftPlans.data.map(normalizeDraftPlanOrder));
    }
  }, [draftPlans.data]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (leagueId) next.set("leagueId", String(leagueId));
    else next.delete("leagueId");
    if (selectedDraftId) next.set("draftId", selectedDraftId);
    else next.delete("draftId");
    setSearchParams(next, { replace: true });
  }, [leagueId, selectedDraftId]);

  const visibleDrafts = useMemo(
    () =>
      (leagueId ? drafts.filter((draft) => draft.leagueId === leagueId) : [...drafts]).sort(
        (left, right) => right.updatedAt - left.updatedAt
      ),
    [drafts, leagueId]
  );

  useEffect(() => {
    if (selectedDraftId && !visibleDrafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(null);
    }
  }, [visibleDrafts, selectedDraftId]);

  const teams = useMemo<DraftTeamOption[]>(
    () => [
      ...(league.data?.teams ?? []).map((team) => ({ ...team, isCustom: false })),
      ...(customTeams.data ?? []).map((team) => ({ teamId: team.teamId, name: team.name, tag: team.tag, isCustom: true }))
    ],
    [customTeams.data, league.data?.teams]
  );
  const draftGroups = useMemo(() => groupDraftsByTeam(visibleDrafts, teams), [visibleDrafts, teams]);
  const leagueLibrarySections = useMemo(() => {
    const byLeague = new Map<number, DraftPlan[]>();
    for (const draft of drafts) {
      const list = byLeague.get(draft.leagueId) ?? [];
      list.push(draft);
      byLeague.set(draft.leagueId, list);
    }
    return [...byLeague.entries()]
      .map(([sectionLeagueId, sectionDrafts]) => ({
        leagueId: sectionLeagueId,
        leagueName:
          settings.data?.savedLeagues.find((entry) => entry.leagueId === sectionLeagueId)?.name ?? `League ${sectionLeagueId}`,
        drafts: [...sectionDrafts].sort((left, right) => right.updatedAt - left.updatedAt)
      }))
      .sort((left, right) => left.leagueName.localeCompare(right.leagueName));
  }, [drafts, settings.data?.savedLeagues]);
  const heroOptions = useMemo<HeroOption[]>(() => {
    const statsByHeroId = new Map((heroStats.data ?? []).map((hero) => [hero.heroId, hero]));
    const roster = heroRoster.data?.length ? heroRoster.data : (heroStats.data ?? []);
    return roster
      .map((hero) => {
        const stats = statsByHeroId.get(hero.heroId);
        return {
          heroId: hero.heroId,
          heroName: hero.heroName,
          heroIconUrl: hero.heroIconUrl,
          primaryAttr: hero.primaryAttr ?? stats?.primaryAttr ?? null,
          games: stats?.games ?? 0,
          winrate: stats?.winrate ?? 0
        };
      })
      .sort((left, right) => right.games - left.games || left.heroName.localeCompare(right.heroName));
  }, [heroRoster.data, heroStats.data]);
  const heroesById = useMemo(() => new Map(heroOptions.map((hero) => [hero.heroId, hero])), [heroOptions]);

  const updateDraft = (draft: DraftPlan) => {
    const nextDraft = { ...draft, updatedAt: Date.now() };
    const nextDrafts = drafts.some((entry) => entry.id === nextDraft.id)
      ? drafts.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry))
      : [nextDraft, ...drafts];
    setDrafts(nextDrafts);
    saveDraft.mutate(nextDraft);
  };

  const createDraft = async (options?: { firstTeamId?: number | null; secondTeamId?: number | null }) => {
    const draftLeagueId = leagueId ?? settings.data?.savedLeagues?.[0]?.leagueId ?? null;
    if (!draftLeagueId) return;
    const owner = await ensureLocalDraftOwnerKey();
    setDraftOwnerKey(owner.ownerKey);
    setAccessCodeInput(owner.ownerKey);
    if (owner.created) {
      setNewAccessCode(owner.ownerKey);
    }
    const draft = createEmptyDraft(draftLeagueId, `Draft ${visibleDrafts.length + 1}`);
    const firstTeamId = Number(searchParams.get("firstTeamId"));
    const secondTeamId = Number(searchParams.get("secondTeamId"));
    if (options && "firstTeamId" in options) draft.firstTeamId = options.firstTeamId ?? null;
    else if (Number.isInteger(firstTeamId) && firstTeamId > 0) draft.firstTeamId = firstTeamId;
    if (options && "secondTeamId" in options) draft.secondTeamId = options.secondTeamId ?? null;
    else if (Number.isInteger(secondTeamId) && secondTeamId > 0) draft.secondTeamId = secondTeamId;
    const nextDrafts = [draft, ...drafts];
    setDrafts(nextDrafts);
    setLeagueId(draftLeagueId);
    saveDraft.mutate(draft);
    setSelectedDraftId(draft.id);
  };

  const openDraft = (draft: DraftPlan) => {
    setLeagueId(draft.leagueId);
    setSelectedDraftId(draft.id);
  };

  const removeDraft = () => {
    if (!selectedDraft) return;
    const nextDrafts = drafts.filter((draft) => draft.id !== selectedDraft.id);
    setDrafts(nextDrafts);
    setSelectedDraftId(nextDrafts.find((draft) => draft.leagueId === selectedDraft.leagueId)?.id ?? null);
    deleteDraft.mutate({ draftId: selectedDraft.id, leagueId: selectedDraft.leagueId });
  };

  const removeDraftById = (draft: DraftPlan) => {
    const nextDrafts = drafts.filter((entry) => entry.id !== draft.id);
    setDrafts(nextDrafts);
    if (selectedDraftId === draft.id) setSelectedDraftId(null);
    deleteDraft.mutate({ draftId: draft.id, leagueId: draft.leagueId });
  };

  const applyAccessCode = async () => {
    const normalized = setLocalDraftOwnerCode(accessCodeInput);
    if (!normalized) {
      setAccessCodeMessage("Enter the draft access code exactly as it was given to you.");
      return;
    }
    setAccessCodeInput(normalized);
    setDraftOwnerKey(normalized);
    setSelectedDraftId(null);
    setDrafts([]);
    await queryClient.invalidateQueries({ queryKey: ["draft-plans"] });
    setAccessCodeMessage("Draft library refreshed for this access code.");
  };

  const importEvaluationCsv = async (file: File | null) => {
    if (!file) return;
    const name = customTeamName.trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      const rows = normalizeImportRows(parseCsvRows(await file.text()));
      if (!rows.length) {
        setTeamImportMessage("No CSV rows found.");
        return;
      }
      const result = await importCustomTeam.mutateAsync({ name, rows });
      setCustomTeamName(result.team.name);
      setTeamImportMessage(
        `Imported ${formatNumber(result.evaluations.length)} hero evaluations for ${result.team.name}.`
      );
      if (selectedDraft) {
        const nextDraft =
          selectedDraft.firstTeamId === null
            ? { ...selectedDraft, firstTeamId: result.team.teamId }
            : selectedDraft.secondTeamId === null
              ? { ...selectedDraft, secondTeamId: result.team.teamId }
              : selectedDraft;
        if (nextDraft !== selectedDraft) updateDraft(nextDraft);
      }
    } catch (error) {
      setTeamImportMessage(error instanceof Error ? error.message : "Failed to import CSV.");
    }
  };

  const createCustomTeamFromName = async () => {
    const name = customTeamName.trim();
    if (!name) {
      setTeamImportMessage("Enter a team name first.");
      return;
    }
    try {
      const team = await createCustomTeam.mutateAsync({ name });
      setCustomTeamName(team.name);
      setTeamImportMessage(`Created ${team.name}.`);
    } catch (error) {
      setTeamImportMessage(error instanceof Error ? error.message : "Failed to create team.");
    }
  };

  const updateSlot = (slotId: string, heroIds: number[], playerKeysByHero?: Record<string, string>) => {
    if (!selectedDraft) return;
    updateDraft({
      ...selectedDraft,
      slots: selectedDraft.slots.map((slot) => {
        if (slot.id !== slotId) return slot;
        const allowedHeroIds = new Set(heroIds.map(String));
        const nextPlayerKeys = Object.fromEntries(
          Object.entries(playerKeysByHero ?? slot.playerKeysByHero ?? {}).filter(([heroId]) => allowedHeroIds.has(heroId))
        );
        return { ...slot, heroIds, playerKeysByHero: nextPlayerKeys };
      })
    });
  };

  const firstTeamHeroes =
    firstTeamEvaluations.data?.evaluations.length
      ? evaluationHeroOptions(firstTeamEvaluations.data.evaluations, heroesById)
      : (firstTeam.data?.topHeroes ?? []).map((hero) => ({
          heroId: hero.heroId,
          heroName: hero.heroName,
          heroIconUrl: hero.heroIconUrl,
          primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
          games: hero.games,
          winrate: hero.winrate
        }));
  const secondTeamHeroes =
    secondTeamEvaluations.data?.evaluations.length
      ? evaluationHeroOptions(secondTeamEvaluations.data.evaluations, heroesById)
      : (secondTeam.data?.topHeroes ?? []).map((hero) => ({
          heroId: hero.heroId,
          heroName: hero.heroName,
          heroIconUrl: hero.heroIconUrl,
          primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
          games: hero.games,
          winrate: hero.winrate
        }));
  const pickerSlot = selectedDraft?.slots.find((slot) => slot.id === pickerSlotId) ?? null;
  const heroDraftState = useMemo(() => {
    const map = new Map<number, HeroDraftState>();
    for (const slot of selectedDraft?.slots ?? []) {
      for (const heroId of slot.heroIds) {
        if (!map.has(heroId) || slot.kind === "ban") {
          map.set(heroId, slot.kind);
        }
      }
    }
    return map;
  }, [selectedDraft?.slots]);
  const playerComfortColumns = useMemo<PlayerComfortColumn[]>(() => {
    if (draftContext.data?.players.length) {
      const sideByPlayerId = new Map<number, DraftSide>();
      firstTeamPlayerIds.forEach((playerId) => sideByPlayerId.set(playerId, "first"));
      secondTeamPlayerIds.forEach((playerId) => sideByPlayerId.set(playerId, "second"));
      return draftContext.data.players
        .map((player) => ({
          playerId: player.playerId,
          name: player.personaname ?? `Player ${player.playerId}`,
          side: sideByPlayerId.get(player.playerId) ?? "first",
          totalGames: player.totalGames,
          heroes: player.heroes.map((hero) => ({
            heroId: hero.heroId,
            heroName: hero.heroName,
            heroIconUrl: hero.heroIconUrl,
            primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
            games: hero.games,
            winrate: hero.winrate
          }))
        }))
        .sort((left, right) => {
          if (left.side !== right.side) return left.side === "first" ? -1 : 1;
          return right.totalGames - left.totalGames;
        });
    }

    const heroPlayerRows = league.data?.heroPlayers ?? [];
    const makeColumns = (
      players: Array<{ playerId: number | null; personaname: string | null; games: number }>,
      side: DraftSide
    ) =>
      players
        .filter((player) => player.playerId !== null)
        .sort((left, right) => right.games - left.games)
        .slice(0, 5)
        .map((player) => {
          const heroes = heroPlayerRows
            .filter((row) => row.playerId === player.playerId)
            .sort((left, right) => right.games - left.games)
            .map((row) => ({
              heroId: row.heroId,
              heroName: heroesById.get(row.heroId)?.heroName ?? `Hero ${row.heroId}`,
              heroIconUrl: heroesById.get(row.heroId)?.heroIconUrl ?? null,
              primaryAttr: heroesById.get(row.heroId)?.primaryAttr ?? null,
              games: row.games,
              winrate: row.winrate
            }));
          return {
            playerId: player.playerId,
            name: player.personaname ?? `Player ${player.playerId}`,
            side,
            totalGames: player.games,
            heroes
          };
        });

    return [...makeColumns(firstTeam.data?.players ?? [], "first"), ...makeColumns(secondTeam.data?.players ?? [], "second")];
  }, [
    draftContext.data?.players,
    firstTeam.data?.players,
    firstTeamPlayerIds,
    heroesById,
    league.data?.heroPlayers,
    secondTeam.data?.players,
    secondTeamPlayerIds
  ]);
  const comboRows = useMemo<DraftCombo[]>(() => {
    if (draftContext.data?.combos.length) {
      return draftContext.data.combos.map((combo) => ({
        side: combo.side,
        label: combo.comboKey,
        games: combo.games,
        wins: combo.wins,
        winrate: combo.winrate,
        heroes: combo.heroes.map((hero) => ({
          heroId: hero.heroId,
          heroName: hero.heroName,
          heroIconUrl: hero.heroIconUrl,
          primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
          games: 0,
          winrate: 0
        }))
      }));
    }

    const rows = league.data?.matchPlayers ?? [];
    const makeCombos = (playerIds: Array<number | null>, side: DraftSide) => {
      const scopedPlayerIds = new Set(playerIds.filter((id): id is number => id !== null));
      const byMatch = new Map<number, typeof rows>();
      for (const row of rows) {
        if (!row.playerId || !scopedPlayerIds.has(row.playerId)) continue;
        const list = byMatch.get(row.matchId) ?? [];
        list.push(row);
        byMatch.set(row.matchId, list);
      }

      const comboMap = new Map<string, DraftCombo>();
      for (const matchRows of byMatch.values()) {
        const uniqueHeroes = [...new Map(matchRows.map((row) => [row.heroId, row])).values()];
        for (let i = 0; i < uniqueHeroes.length; i += 1) {
          for (let j = i + 1; j < uniqueHeroes.length; j += 1) {
            const pair = [uniqueHeroes[i], uniqueHeroes[j]].sort((left, right) => left.heroId - right.heroId);
            const key = pair.map((hero) => hero.heroId).join("-");
            const existing =
              comboMap.get(key) ??
              ({
                side,
                label: key,
                games: 0,
                wins: 0,
                winrate: 0,
                heroes: pair.map((hero) => ({
                  heroId: hero.heroId,
                  heroName: heroesById.get(hero.heroId)?.heroName ?? hero.heroName,
                  heroIconUrl: heroesById.get(hero.heroId)?.heroIconUrl ?? hero.heroIconUrl,
                  primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
                  games: 0,
                  winrate: 0
                }))
              } satisfies DraftCombo);
            existing.games += 1;
            if (pair.some((hero) => hero.win === true)) existing.wins += 1;
            existing.winrate = existing.games ? Number(((existing.wins / existing.games) * 100).toFixed(1)) : 0;
            comboMap.set(key, existing);
          }
        }
      }
      return [...comboMap.values()].sort((left, right) => right.games - left.games || right.winrate - left.winrate);
    };

    return [
      ...makeCombos((firstTeam.data?.players ?? []).map((player) => player.playerId).slice(0, 5), "first"),
      ...makeCombos((secondTeam.data?.players ?? []).map((player) => player.playerId).slice(0, 5), "second")
    ];
  }, [draftContext.data?.combos, firstTeam.data?.players, heroesById, league.data?.matchPlayers, secondTeam.data?.players]);
  const currentSlotHeroIds = useMemo(() => new Set(pickerSlot?.heroIds ?? []), [pickerSlot?.heroIds]);
  const firstEvaluatedHeroes = useMemo(
    () => evaluationChoicesByHero(firstTeamEvaluations.data?.evaluations ?? []),
    [firstTeamEvaluations.data?.evaluations]
  );
  const secondEvaluatedHeroes = useMemo(
    () => evaluationChoicesByHero(secondTeamEvaluations.data?.evaluations ?? []),
    [secondTeamEvaluations.data?.evaluations]
  );
  const pickerEvaluatedHeroes = pickerSlot?.side === "second" ? secondEvaluatedHeroes : firstEvaluatedHeroes;
  const pickedHeroesBySide = useMemo(() => {
    const bySide: Record<DraftSide, Array<{ heroId: number; playerKey: string | null }>> = { first: [], second: [] };
    for (const slot of selectedDraft?.slots ?? []) {
      if (slot.kind !== "pick") continue;
      bySide[slot.side].push(
        ...slot.heroIds.map((heroId) => ({
          heroId,
          playerKey: slot.playerKeysByHero?.[String(heroId)] ?? null
        }))
      );
    }
    return bySide;
  }, [selectedDraft?.slots]);
  const firstEvaluationMetrics = useMemo(
    () => sumEvaluationMetrics(firstTeamEvaluations.data?.evaluations ?? [], pickedHeroesBySide.first),
    [firstTeamEvaluations.data?.evaluations, pickedHeroesBySide.first]
  );
  const secondEvaluationMetrics = useMemo(
    () => sumEvaluationMetrics(secondTeamEvaluations.data?.evaluations ?? [], pickedHeroesBySide.second),
    [pickedHeroesBySide.second, secondTeamEvaluations.data?.evaluations]
  );
  const pickerSuggestions = useMemo(
    () =>
      pickerSlot?.side === "second"
        ? buildEvaluationSuggestions(heroOptions, secondTeamEvaluations.data?.evaluations ?? [], secondEvaluationMetrics, heroDraftState)
        : buildEvaluationSuggestions(heroOptions, firstTeamEvaluations.data?.evaluations ?? [], firstEvaluationMetrics, heroDraftState),
    [
      firstEvaluationMetrics,
      firstTeamEvaluations.data?.evaluations,
      heroDraftState,
      heroOptions,
      pickerSlot?.side,
      secondEvaluationMetrics,
      secondTeamEvaluations.data?.evaluations
    ]
  );

  return (
    <Page title="Drafts">
      <div className={`draft-layout ${selectedDraft ? "editor" : ""}`}>
        {!selectedDraft ? (
          <section className="draft-scope-panel">
            <h2>Scope</h2>
            <div className="draft-scope-bar">
              <label>
                League
                <select
                  value={leagueId ?? ""}
                  onChange={(event) => {
                    const nextLeagueId = Number(event.target.value);
                    setLeagueId(Number.isInteger(nextLeagueId) && nextLeagueId > 0 ? nextLeagueId : null);
                    setSelectedDraftId(null);
                  }}
                >
                  <option value="">All leagues</option>
                  {settings.data?.savedLeagues.map((leagueEntry) => (
                    <option key={leagueEntry.leagueId} value={leagueEntry.leagueId}>
                      {leagueEntry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hero search
                <input value={heroSearch} onChange={(event) => setHeroSearch(event.target.value)} placeholder="Hero name" />
              </label>
              <label>
                Access code
                <input
                  value={accessCodeInput}
                  onChange={(event) => setAccessCodeInput(normalizeDraftOwnerCode(event.target.value))}
                  placeholder="Draft access code"
                  maxLength={128}
                />
              </label>
              <button type="button" className="ghost-button" onClick={applyAccessCode}>
                Use code
              </button>
            </div>
            {accessCodeMessage ? <small className="draft-access-message">{accessCodeMessage}</small> : null}
          </section>
        ) : null}

        {!selectedDraft ? (
          <div className="draft-section-tabs" role="tablist" aria-label="Draft sections">
            <button
              type="button"
              className={draftSection === "drafts" ? "active" : ""}
              onClick={() => setDraftSection("drafts")}
            >
              Drafts
            </button>
            <button
              type="button"
              className={draftSection === "teams" ? "active" : ""}
              onClick={() => setDraftSection("teams")}
            >
              Teams
            </button>
          </div>
        ) : null}

        <section className="draft-main">
          {league.isLoading || heroStats.isLoading || heroRoster.isLoading || draftPlans.isLoading ? (
            <LoadingState label="Loading draft context..." />
          ) : null}
          {newAccessCode ? (
            <div className="draft-access-modal-backdrop" role="presentation">
              <div className="draft-access-modal" role="dialog" aria-modal="true" aria-labelledby="draft-access-title">
                <h2 id="draft-access-title">Draft access code</h2>
                <p>Keep this code somewhere safe. It is the only way to load these drafts from another browser or device.</p>
                <code>{newAccessCode}</code>
                <button type="button" onClick={() => setNewAccessCode(null)}>
                  I saved it
                </button>
              </div>
            </div>
          ) : null}
          {selectedDraft ? (
            <>
              <div className="draft-editor-topbar">
                <button type="button" className="ghost-button draft-back-button" onClick={() => setSelectedDraftId(null)}>
                  Back to drafts
                </button>
                {accessCodeMessage ? <small className="draft-access-message inline">{accessCodeMessage}</small> : null}
              </div>

              <HeroPickerModal
                open={pickerSlot !== null}
                slot={pickerSlot}
                heroOptions={heroOptions}
                currentSlotHeroIds={currentSlotHeroIds}
                heroDraftState={heroDraftState}
                evaluatedHeroes={pickerEvaluatedHeroes}
                suggestions={pickerSuggestions}
                onClose={() => setPickerSlotId(null)}
                onPick={(heroId, playerKey) => {
                  if (!pickerSlot) return;
                  if (pickerSlot.heroIds.includes(heroId)) {
                    updateSlot(pickerSlot.id, pickerSlot.heroIds.filter((entry) => entry !== heroId));
                    return;
                  }
                  updateSlot(pickerSlot.id, [...pickerSlot.heroIds, heroId], {
                    ...(pickerSlot.playerKeysByHero ?? {}),
                    ...(playerKey ? { [String(heroId)]: playerKey } : {})
                  });
                }}
              />

              <div className="draft-workspace">
                <div className="draft-side-shell first">
                  <label className="draft-side-select">
                    First pick side
                    <select
                      value={selectedDraft.firstTeamId ?? ""}
                      onChange={(event) =>
                        updateDraft({
                          ...selectedDraft,
                          firstTeamId: event.target.value ? Number(event.target.value) : null
                        })
                      }
                    >
                      <option value="">No team assigned</option>
                      {teams.map((team) => (
                        <option key={team.teamId} value={team.teamId}>
                          {team.name}{team.isCustom ? " - custom" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <DraftTeamContextPanel
                    title="First pick"
                    teamName={getTeamName(teams, selectedDraft.firstTeamId) ?? "Unassigned"}
                    heroes={firstTeamHeroes}
                    comfortColumns={playerComfortColumns.filter((column) => column.side === "first")}
                    side="first"
                  />
                  <EvaluationRadar
                    title="First side profile"
                    metrics={firstEvaluationMetrics}
                    emptyLabel="Pick evaluated heroes to see the team profile."
                  />
                </div>
                <div className="draft-sequence-board">
                  {selectedDraft.slots.map((slot, index) => {
                    const previousSlot = selectedDraft.slots[index - 1];
                    const nextSlot = selectedDraft.slots[index + 1];
                    const startsPhase = index === 0 || previousSlot?.kind !== slot.kind;
                    const endsPhase = index === selectedDraft.slots.length - 1 || nextSlot?.kind !== slot.kind;
                    const hasPhaseGap = startsPhase && index > 0;
                    return (
                      <div
                        key={slot.id}
                        className={`draft-sequence-row ${slot.kind} ${startsPhase ? "phase-start" : ""} ${endsPhase ? "phase-end" : ""} ${hasPhaseGap ? "phase-gap" : ""}`}
                      >
                        <div className="draft-sequence-cell first">
                          {slot.side === "first" ? (
                            <div
                              className={`draft-slot-wrapper ${slot.kind} ${targetSlotId === slot.id ? "active" : ""}`}
                              onClick={() => setTargetSlotId(slot.id)}
                            >
                              <DraftSlotCard
                                slot={slot}
                                side="first"
                                heroesById={heroesById}
                                onOpenPicker={() => {
                                  setTargetSlotId(slot.id);
                                  setPickerSlotId(slot.id);
                                }}
                                onChange={(heroIds) => updateSlot(slot.id, heroIds)}
                              />
                            </div>
                          ) : null}
                        </div>
                        <div className="draft-sequence-number" aria-label={`Draft row ${index + 1}`}>
                          {index + 1}
                        </div>
                        <div className="draft-sequence-cell second">
                          {slot.side === "second" ? (
                            <div
                              className={`draft-slot-wrapper ${slot.kind} ${targetSlotId === slot.id ? "active" : ""}`}
                              onClick={() => setTargetSlotId(slot.id)}
                            >
                              <DraftSlotCard
                                slot={slot}
                                side="second"
                                heroesById={heroesById}
                                onOpenPicker={() => {
                                  setTargetSlotId(slot.id);
                                  setPickerSlotId(slot.id);
                                }}
                                onChange={(heroIds) => updateSlot(slot.id, heroIds)}
                              />
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="draft-side-shell second">
                  <div className="draft-editor-actions">
                    <div className="draft-editor-button-row">
                      <button type="button" onClick={() => void createDraft()} disabled={!leagueId}>
                        New draft
                      </button>
                      <button type="button" className="ghost-button" onClick={removeDraft}>
                        Delete
                      </button>
                    </div>
                    <input
                      aria-label="Draft name"
                      value={selectedDraft.name}
                      onChange={(event) => updateDraft({ ...selectedDraft, name: event.target.value })}
                    />
                  </div>
                  <label className="draft-side-select">
                    Second pick side
                    <select
                      value={selectedDraft.secondTeamId ?? ""}
                      onChange={(event) =>
                        updateDraft({
                          ...selectedDraft,
                          secondTeamId: event.target.value ? Number(event.target.value) : null
                        })
                      }
                    >
                      <option value="">No team assigned</option>
                      {teams.map((team) => (
                        <option key={team.teamId} value={team.teamId}>
                          {team.name}{team.isCustom ? " - custom" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <DraftTeamContextPanel
                    title="Second pick"
                    teamName={getTeamName(teams, selectedDraft.secondTeamId) ?? "Unassigned"}
                    heroes={secondTeamHeroes}
                    comfortColumns={playerComfortColumns.filter((column) => column.side === "second")}
                    side="second"
                  />
                  <EvaluationRadar
                    title="Second side profile"
                    metrics={secondEvaluationMetrics}
                    emptyLabel="Pick evaluated heroes to see the team profile."
                  />
                </div>
              </div>

              <div className="two-column draft-removed-context">
                <Card title="First side players">
                  {firstTeam.data?.players.length ? (
                    <div className="draft-player-list">
                      {firstTeam.data.players.slice(0, 10).map((player) =>
                        player.playerId ? (
                          <Link key={player.playerId} to={`/players/${player.playerId}?leagueId=${leagueId}`}>
                            {player.personaname ?? player.playerId} · {formatNumber(player.games)}
                          </Link>
                        ) : null
                      )}
                    </div>
                  ) : (
                    <EmptyState label="Assign a team with local match data to see players." />
                  )}
                </Card>
                <Card title="Second side players">
                  {secondTeam.data?.players.length ? (
                    <div className="draft-player-list">
                      {secondTeam.data.players.slice(0, 10).map((player) =>
                        player.playerId ? (
                          <Link key={player.playerId} to={`/players/${player.playerId}?leagueId=${leagueId}`}>
                            {player.personaname ?? player.playerId} · {formatNumber(player.games)}
                          </Link>
                        ) : null
                      )}
                    </div>
                  ) : (
                    <EmptyState label="Assign a team with local match data to see players." />
                  )}
                </Card>
              </div>
            </>
          ) : draftSection === "teams" ? (
            <Card
              title="Teams"
              extra={
                <button
                  type="button"
                  onClick={() => void createCustomTeamFromName()}
                  disabled={createCustomTeam.isPending || !customTeamName.trim()}
                >
                  Add team
                </button>
              }
            >
              <div className="draft-team-tools">
                <label>
                  Team name
                  <input
                    value={customTeamName}
                    onChange={(event) => setCustomTeamName(event.target.value)}
                    placeholder="Custom team name"
                  />
                </label>
                <label className="draft-file-import">
                  Import hero evaluation CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      void importEvaluationCsv(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                {teamImportMessage ? <small>{teamImportMessage}</small> : null}
              </div>

              <div className="draft-team-directory">
                {(customTeams.data ?? []).length ? (
                  <section>
                    <h3>Custom teams</h3>
                    <div className="draft-team-grid">
                      {(customTeams.data ?? []).map((team) => (
                        <CustomTeamCard
                          key={team.teamId}
                          team={team}
                          saving={updateCustomTeam.isPending}
                          onSave={(teamId, values) => {
                            void updateCustomTeam
                              .mutateAsync({ teamId, payload: values })
                              .then((updated) => {
                                setTeamImportMessage(`Updated ${updated.name}.`);
                              })
                              .catch((error) => {
                                setTeamImportMessage(error instanceof Error ? error.message : "Failed to update team.");
                              });
                          }}
                          onDraft={(teamId) => void createDraft({ firstTeamId: teamId })}
                        />
                      ))}
                    </div>
                  </section>
                ) : (
                  <EmptyState label="No custom teams yet." />
                )}

                {league.data?.teams.length ? (
                  <section>
                    <h3>League teams</h3>
                    <div className="draft-team-grid">
                      {league.data.teams.map((team) => (
                        <article key={team.teamId} className="draft-team-card">
                          <strong>{team.name}</strong>
                          <span>{team.tag ?? `Team ${team.teamId}`}</span>
                          <small>
                            {formatNumber(team.games)} games · {team.winrate.toFixed(1)}% winrate
                          </small>
                          <button type="button" className="ghost-button compact" onClick={() => void createDraft({ firstTeamId: team.teamId })}>
                            Draft with team
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card title="Draft library">
              <div className="draft-library-toolbar">
                <button type="button" onClick={() => void createDraft()} disabled={!leagueId && !settings.data?.savedLeagues?.length}>
                  New draft
                </button>
              </div>
              {leagueId ? (
                <>
                  {draftGroups.length ? (
                    <div className="draft-library">
                      {draftGroups.map((group) => (
                        <section key={group.key} className="draft-library-group">
                          <div className="draft-library-group-header">
                            <h3>{group.title}</h3>
                          </div>
                          <div className="draft-library-links">
                            {group.drafts.map(({ draft, matchup }) => (
                              <div key={`${group.key}-${draft.id}`} className="draft-library-link">
                                <button type="button" onClick={() => openDraft(draft)}>
                                  <strong>{draft.name}</strong>
                                  <span>{matchup}</span>
                                </button>
                                <button type="button" className="ghost-button compact" onClick={() => removeDraftById(draft)}>
                                  Delete
                                </button>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <EmptyState label="No saved drafts for this league yet." />
                  )}
                </>
              ) : leagueLibrarySections.length ? (
                <div className="draft-league-library">
                  {leagueLibrarySections.map((section) => (
                    <DraftLeagueLibrarySection
                      key={section.leagueId}
                      leagueId={section.leagueId}
                      leagueName={section.leagueName}
                      drafts={section.drafts}
                      onOpenDraft={openDraft}
                      onDeleteDraft={removeDraftById}
                    />
                  ))}
                </div>
              ) : (
                <EmptyState label="No saved drafts for this access code yet. Select a league to create the first one." />
              )}
            </Card>
          )}
        </section>
      </div>
    </Page>
  );
}
