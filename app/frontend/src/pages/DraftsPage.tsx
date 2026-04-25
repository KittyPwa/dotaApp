import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card } from "../components/Card";
import { IconImage } from "../components/IconImage";
import { MetricGrid } from "../components/MetricGrid";
import { Page } from "../components/Page";
import { EmptyState, LoadingState } from "../components/State";
import {
  useDeleteDraftPlan,
  useDraftContext,
  useDraftPlans,
  useHeroStats,
  useLeague,
  useLeagueTeam,
  useSaveDraftPlan,
  useSettings
} from "../hooks/useQueries";
import {
  createEmptyDraft,
  normalizeDraftPlanOrder,
  type DraftPlan,
  type DraftSide,
  type DraftSlot
} from "../lib/draftStorage";
import { formatNumber } from "../lib/format";

type HeroOption = {
  heroId: number;
  heroName: string;
  heroIconUrl: string | null;
  primaryAttr: string | null;
  games: number;
  winrate: number;
};

type PickerFilter = "attribute" | "league" | "first-team" | "second-team" | "player-comforts" | "combos";
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

function getTeamName(teams: Array<{ teamId: number; name: string; tag: string | null }>, teamId: number | null) {
  if (!teamId) return null;
  const team = teams.find((entry) => entry.teamId === teamId);
  return team ? `${team.name}${team.tag ? ` (${team.tag})` : ""}` : `Team ${teamId}`;
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
      <span>{hero?.heroName ?? "Unknown"}</span>
    </button>
  );
}

function DraftSlotCard({
  slot,
  order,
  side,
  heroesById,
  onOpenPicker,
  onChange
}: {
  slot: DraftSlot;
  order: number;
  side: DraftSide;
  heroesById: Map<number, HeroOption>;
  onOpenPicker: () => void;
  onChange: (heroIds: number[]) => void;
}) {
  const variants = side === "first" ? [...slot.heroIds].reverse() : slot.heroIds;

  return (
    <div className={`draft-slot-card ${slot.kind} ${side}`}>
      <div className="draft-slot-label">
        <small>{order}</small>
        <strong>{slot.label}</strong>
        <span>{slot.kind}</span>
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
  recommended = false
) {
  return [
    currentSlotHeroIds.has(heroId) ? "current" : "",
    !currentSlotHeroIds.has(heroId) && heroDraftState.get(heroId) === "ban" ? "banned" : "",
    !currentSlotHeroIds.has(heroId) && heroDraftState.get(heroId) === "pick" ? "picked" : "",
    recommended ? "recommended" : ""
  ]
    .filter(Boolean)
    .join(" ");
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
  firstTeamHeroes,
  secondTeamHeroes,
  playerComfortColumns,
  currentSlotHeroIds,
  heroDraftState,
  combos,
  onClose,
  onPick
}: {
  open: boolean;
  slot: DraftSlot | null;
  heroOptions: HeroOption[];
  firstTeamHeroes: HeroOption[];
  secondTeamHeroes: HeroOption[];
  playerComfortColumns: PlayerComfortColumn[];
  currentSlotHeroIds: Set<number>;
  heroDraftState: Map<number, HeroDraftState>;
  combos: DraftCombo[];
  onClose: () => void;
  onPick: (heroId: number) => void;
}) {
  const [filter, setFilter] = useState<PickerFilter>("attribute");
  const [search, setSearch] = useState("");
  const [comboSide, setComboSide] = useState<DraftSide>("first");
  if (!open || !slot) return null;

  const firstTeamIds = new Set(firstTeamHeroes.map((hero) => hero.heroId));
  const secondTeamIds = new Set(secondTeamHeroes.map((hero) => hero.heroId));
  const searchedHeroes = heroOptions.filter((hero) => hero.heroName.toLowerCase().includes(search.trim().toLowerCase()));
  const filteredHeroes =
    filter === "first-team"
      ? searchedHeroes.filter((hero) => firstTeamIds.has(hero.heroId))
      : filter === "second-team"
        ? searchedHeroes.filter((hero) => secondTeamIds.has(hero.heroId))
        : searchedHeroes;
  const attrGroups = ["Strength", "Agility", "Intelligence", "Universal"].map((label) => ({
    label,
    heroes: filteredHeroes.filter((hero) => normalizeAttr(hero.primaryAttr) === label)
  }));
  const groups =
    filter === "attribute"
      ? attrGroups
      : [
          {
            label: filter === "league" ? "League pick rate" : filter === "first-team" ? "First side pool" : "Second side pool",
            heroes: filteredHeroes
          }
        ];

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
              ["first-team", "First team"],
              ["second-team", "Second team"],
              ["player-comforts", "Player comforts"]
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
        {filter === "player-comforts" ? (
          <div className="draft-player-comforts">
            {playerComfortColumns.map((column) => (
              <section key={`${column.side}-${column.playerId ?? column.name}`} className={`draft-player-comfort-column ${column.side}`}>
                <h3>{column.name}</h3>
                <div>
                  {column.heroes.slice(0, 10).map((hero) => (
                    <button
                      key={hero.heroId}
                      type="button"
                      className={heroButtonClass(hero.heroId, currentSlotHeroIds, heroDraftState, true)}
                      title={`${hero.heroName} | ${formatNumber(hero.games)} games | ${hero.winrate}%`}
                      onClick={() => onPick(hero.heroId)}
                    >
                      <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="sm" />
                      <span>
                        {formatNumber(hero.games)} | {column.totalGames ? Math.round((hero.games / column.totalGames) * 100) : 0}%
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : filter === "combos" ? (
          <div className="draft-combo-sections tree-mode">
            <div className="segmented-control draft-combo-side-tabs">
              {(["first", "second"] as DraftSide[]).map((side) => (
                <button key={side} type="button" className={comboSide === side ? "active" : ""} onClick={() => setComboSide(side)}>
                  {side === "first" ? "First side combos" : "Second side combos"}
                </button>
              ))}
            </div>
            <ComboRelationshipGraph
              side={comboSide}
              combos={combos}
              currentSlotHeroIds={currentSlotHeroIds}
              heroDraftState={heroDraftState}
              onPick={onPick}
            />
          </div>
        ) : (
          <div className="draft-picker-groups">
            {groups.map((group) => (
              <section key={group.label} className="draft-picker-group">
                <h3>{group.label}</h3>
                <div className="draft-picker-hero-grid">
                  {group.heroes.map((hero) => (
                    <button
                    key={hero.heroId}
                    type="button"
                    className={heroButtonClass(hero.heroId, currentSlotHeroIds, heroDraftState)}
                      title={`${hero.heroName} | ${formatNumber(hero.games)} games | ${hero.winrate}%`}
                      onClick={() => onPick(hero.heroId)}
                    >
                      <IconImage src={hero.heroIconUrl} alt={hero.heroName} size="md" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
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

export function DraftsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const settings = useSettings();
  const initialLeagueId = Number(searchParams.get("leagueId"));
  const [leagueId, setLeagueId] = useState<number | null>(
    Number.isInteger(initialLeagueId) && initialLeagueId > 0 ? initialLeagueId : null
  );
  const [drafts, setDrafts] = useState<DraftPlan[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(searchParams.get("draftId"));
  const [heroSearch, setHeroSearch] = useState("");
  const [targetSlotId, setTargetSlotId] = useState<string | null>(null);
  const [pickerSlotId, setPickerSlotId] = useState<string | null>(null);

  const league = useLeague(leagueId);
  const draftPlans = useDraftPlans(leagueId);
  const saveDraft = useSaveDraftPlan();
  const deleteDraft = useDeleteDraftPlan();
  const heroStats = useHeroStats({ leagueId });
  const selectedDraft = drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  const firstTeam = useLeagueTeam(leagueId, selectedDraft?.firstTeamId ?? null);
  const secondTeam = useLeagueTeam(leagueId, selectedDraft?.secondTeamId ?? null);
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
    if (!leagueId && settings.data?.savedLeagues?.[0]) {
      setLeagueId(settings.data.savedLeagues[0].leagueId);
    }
  }, [leagueId, settings.data?.savedLeagues]);

  useEffect(() => {
    if (draftPlans.data) {
      setDrafts(draftPlans.data.map(normalizeDraftPlanOrder));
    }
  }, [draftPlans.data]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (leagueId) next.set("leagueId", String(leagueId));
    if (selectedDraftId) next.set("draftId", selectedDraftId);
    setSearchParams(next, { replace: true });
  }, [leagueId, selectedDraftId]);

  const leagueDrafts = useMemo(
    () => drafts.filter((draft) => draft.leagueId === leagueId).sort((a, b) => b.updatedAt - a.updatedAt),
    [drafts, leagueId]
  );

  useEffect(() => {
    if (!selectedDraftId && leagueDrafts[0]) {
      setSelectedDraftId(leagueDrafts[0].id);
    }
    if (selectedDraftId && leagueDrafts.length > 0 && !leagueDrafts.some((draft) => draft.id === selectedDraftId)) {
      setSelectedDraftId(leagueDrafts[0].id);
    }
  }, [leagueDrafts, selectedDraftId]);

  const teams = league.data?.teams ?? [];
  const heroOptions = useMemo<HeroOption[]>(() => {
    const needle = heroSearch.trim().toLowerCase();
    return [...(heroStats.data ?? [])]
      .filter((hero) => !needle || hero.heroName.toLowerCase().includes(needle))
      .sort((left, right) => right.games - left.games || right.winrate - left.winrate)
      .map((hero) => ({
        heroId: hero.heroId,
        heroName: hero.heroName,
        heroIconUrl: hero.heroIconUrl,
        primaryAttr: hero.primaryAttr ?? null,
        games: hero.games,
        winrate: hero.winrate
      }));
  }, [heroSearch, heroStats.data]);
  const heroesById = useMemo(() => new Map(heroOptions.map((hero) => [hero.heroId, hero])), [heroOptions]);

  const updateDraft = (draft: DraftPlan) => {
    const nextDraft = { ...draft, updatedAt: Date.now() };
    const nextDrafts = drafts.some((entry) => entry.id === nextDraft.id)
      ? drafts.map((entry) => (entry.id === nextDraft.id ? nextDraft : entry))
      : [nextDraft, ...drafts];
    setDrafts(nextDrafts);
    saveDraft.mutate(nextDraft);
  };

  const createDraft = () => {
    if (!leagueId) return;
    const draft = createEmptyDraft(leagueId, `Draft ${leagueDrafts.length + 1}`);
    const firstTeamId = Number(searchParams.get("firstTeamId"));
    const secondTeamId = Number(searchParams.get("secondTeamId"));
    if (Number.isInteger(firstTeamId) && firstTeamId > 0) draft.firstTeamId = firstTeamId;
    if (Number.isInteger(secondTeamId) && secondTeamId > 0) draft.secondTeamId = secondTeamId;
    const nextDrafts = [draft, ...drafts];
    setDrafts(nextDrafts);
    saveDraft.mutate(draft);
    setSelectedDraftId(draft.id);
  };

  const removeDraft = () => {
    if (!selectedDraft || !leagueId) return;
    const nextDrafts = drafts.filter((draft) => draft.id !== selectedDraft.id);
    setDrafts(nextDrafts);
    setSelectedDraftId(nextDrafts.find((draft) => draft.leagueId === leagueId)?.id ?? null);
    deleteDraft.mutate({ draftId: selectedDraft.id, leagueId });
  };

  const updateSlot = (slotId: string, heroIds: number[]) => {
    if (!selectedDraft) return;
    updateDraft({
      ...selectedDraft,
      slots: selectedDraft.slots.map((slot) => (slot.id === slotId ? { ...slot, heroIds } : slot))
    });
  };

  const firstTeamHeroes = (firstTeam.data?.topHeroes ?? []).map((hero) => ({
    heroId: hero.heroId,
    heroName: hero.heroName,
    heroIconUrl: hero.heroIconUrl,
    primaryAttr: heroesById.get(hero.heroId)?.primaryAttr ?? null,
    games: hero.games,
    winrate: hero.winrate
  }));
  const secondTeamHeroes = (secondTeam.data?.topHeroes ?? []).map((hero) => ({
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

  return (
    <Page
      title="Drafts"
      aside={
        <div className="action-group">
          <button type="button" onClick={createDraft} disabled={!leagueId}>
            New draft
          </button>
          {selectedDraft ? (
            <button type="button" className="ghost-button" onClick={removeDraft}>
              Delete
            </button>
          ) : null}
        </div>
      }
    >
      <div className="draft-layout">
        <aside className="draft-sidebar">
          <Card title="Scope">
            <div className="stack">
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
                  <option value="">Select league</option>
                  {settings.data?.savedLeagues.map((leagueEntry) => (
                    <option key={leagueEntry.leagueId} value={leagueEntry.leagueId}>
                      {leagueEntry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Draft
                <select value={selectedDraftId ?? ""} onChange={(event) => setSelectedDraftId(event.target.value || null)}>
                  <option value="">Select draft</option>
                  {leagueDrafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {draft.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Hero search
                <input value={heroSearch} onChange={(event) => setHeroSearch(event.target.value)} placeholder="Hero name" />
              </label>
            </div>
          </Card>

          <Card title="Drafts">
            {leagueDrafts.length ? (
              <div className="draft-list">
                {leagueDrafts.map((draft) => (
                  <button
                    key={draft.id}
                    type="button"
                    className={draft.id === selectedDraftId ? "active" : ""}
                    onClick={() => setSelectedDraftId(draft.id)}
                  >
                    <strong>{draft.name}</strong>
                    <span>
                      {getTeamName(teams, draft.firstTeamId) ?? "First pick"} vs{" "}
                      {getTeamName(teams, draft.secondTeamId) ?? "Second pick"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState label="No drafts saved for this league yet." />
            )}
          </Card>
        </aside>

        <section className="draft-main">
          {league.isLoading || heroStats.isLoading || draftPlans.isLoading ? <LoadingState label="Loading draft context..." /> : null}
          {selectedDraft ? (
            <>
              <Card>
                <div className="draft-header-grid">
                  <label>
                    Draft name
                    <input
                      value={selectedDraft.name}
                      onChange={(event) => updateDraft({ ...selectedDraft, name: event.target.value })}
                    />
                  </label>
                  <label>
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
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
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
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </Card>

              <MetricGrid
                items={[
                  { label: "League", value: league.data?.name ?? "Unknown" },
                  { label: "First pick", value: getTeamName(teams, selectedDraft.firstTeamId) ?? "Unassigned" },
                  { label: "Second pick", value: getTeamName(teams, selectedDraft.secondTeamId) ?? "Unassigned" },
                  { label: "Saved variants", value: formatNumber(selectedDraft.slots.reduce((sum, slot) => sum + slot.heroIds.length, 0)) }
                ]}
              />

              <HeroPickerModal
                open={pickerSlot !== null}
                slot={pickerSlot}
                heroOptions={heroOptions}
                firstTeamHeroes={firstTeamHeroes}
                secondTeamHeroes={secondTeamHeroes}
                playerComfortColumns={playerComfortColumns}
                currentSlotHeroIds={currentSlotHeroIds}
                heroDraftState={heroDraftState}
                combos={comboRows}
                onClose={() => setPickerSlotId(null)}
                onPick={(heroId) => {
                  if (!pickerSlot) return;
                  if (pickerSlot.heroIds.includes(heroId)) {
                    updateSlot(pickerSlot.id, pickerSlot.heroIds.filter((entry) => entry !== heroId));
                    return;
                  }
                  updateSlot(pickerSlot.id, [...pickerSlot.heroIds, heroId]);
                }}
              />

              <div className="draft-sequence-board">
                <div className="draft-sequence-header first">{getTeamName(teams, selectedDraft.firstTeamId) ?? "First pick side"}</div>
                <div className="draft-sequence-header second">{getTeamName(teams, selectedDraft.secondTeamId) ?? "Second pick side"}</div>
                {selectedDraft.slots.map((slot, index) => (
                  <div key={slot.id} className={`draft-sequence-row ${slot.kind}`}>
                    <div className="draft-sequence-cell first">
                      {slot.side === "first" ? (
                        <div
                          className={`draft-slot-wrapper ${targetSlotId === slot.id ? "active" : ""}`}
                          onClick={() => setTargetSlotId(slot.id)}
                        >
                          <DraftSlotCard
                            slot={slot}
                            order={index + 1}
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
                    <div className="draft-sequence-cell second">
                      {slot.side === "second" ? (
                        <div
                          className={`draft-slot-wrapper ${targetSlotId === slot.id ? "active" : ""}`}
                          onClick={() => setTargetSlotId(slot.id)}
                        >
                          <DraftSlotCard
                            slot={slot}
                            order={index + 1}
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
                ))}
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
          ) : (
            <EmptyState label={leagueId ? "Create a draft for this league." : "Select a league to start drafting."} />
          )}
        </section>
      </div>
    </Page>
  );
}
