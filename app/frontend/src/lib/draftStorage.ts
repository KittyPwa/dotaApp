export type DraftSide = "first" | "second";
export type DraftSlotKind = "ban" | "pick";

export type DraftSlot = {
  id: string;
  side: DraftSide;
  kind: DraftSlotKind;
  label: string;
  heroIds: number[];
};

export type DraftPlan = {
  id: string;
  leagueId: number;
  name: string;
  firstTeamId: number | null;
  secondTeamId: number | null;
  updatedAt: number;
  slots: DraftSlot[];
};

const STORAGE_KEY = "dota-draft-plans-v1";

const baseDraftOrder: Array<{ side: DraftSide; kind: DraftSlotKind; label: string }> = [
  { side: "first", kind: "ban", label: "B1" },
  { side: "first", kind: "ban", label: "B2" },
  { side: "second", kind: "ban", label: "B1" },
  { side: "second", kind: "ban", label: "B2" },
  { side: "first", kind: "ban", label: "B3" },
  { side: "second", kind: "ban", label: "B3" },
  { side: "second", kind: "ban", label: "B4" },
  { side: "first", kind: "pick", label: "P1" },
  { side: "second", kind: "pick", label: "P1" },
  { side: "first", kind: "ban", label: "B4" },
  { side: "first", kind: "ban", label: "B5" },
  { side: "second", kind: "ban", label: "B5" },
  { side: "second", kind: "pick", label: "P2" },
  { side: "first", kind: "pick", label: "P2" },
  { side: "first", kind: "pick", label: "P3" },
  { side: "second", kind: "pick", label: "P3" },
  { side: "second", kind: "pick", label: "P4" },
  { side: "first", kind: "pick", label: "P4" },
  { side: "first", kind: "ban", label: "B6" },
  { side: "second", kind: "ban", label: "B6" },
  { side: "first", kind: "ban", label: "B7" },
  { side: "second", kind: "ban", label: "B7" },
  { side: "first", kind: "pick", label: "P5" },
  { side: "second", kind: "pick", label: "P5" }
];

export function createEmptyDraft(leagueId: number, name = "New draft"): DraftPlan {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    leagueId,
    name,
    firstTeamId: null,
    secondTeamId: null,
    updatedAt: Date.now(),
    slots: baseDraftOrder.map((slot, index) => ({
      id: `${id}-${index}`,
      ...slot,
      heroIds: []
    }))
  };
}

export function normalizeDraftPlanOrder(draft: DraftPlan): DraftPlan {
  if (draft.slots.length !== baseDraftOrder.length) return draft;
  return {
    ...draft,
    slots: draft.slots.map((slot, index) => ({
      ...slot,
      ...baseDraftOrder[index]
    }))
  };
}

export function loadDraftPlans(): DraftPlan[] {
  if (typeof window === "undefined") return [];
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue) as DraftPlan[];
    return Array.isArray(parsed)
      ? parsed.filter((draft) => Number.isInteger(draft.leagueId)).map(normalizeDraftPlanOrder)
      : [];
  } catch {
    return [];
  }
}

export function saveDraftPlans(drafts: DraftPlan[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function upsertDraftPlan(nextDraft: DraftPlan) {
  const drafts = loadDraftPlans();
  const nextDrafts = drafts.some((draft) => draft.id === nextDraft.id)
    ? drafts.map((draft) => (draft.id === nextDraft.id ? { ...nextDraft, updatedAt: Date.now() } : draft))
    : [{ ...nextDraft, updatedAt: Date.now() }, ...drafts];
  saveDraftPlans(nextDrafts);
  return nextDrafts;
}

export function deleteDraftPlan(draftId: string) {
  const nextDrafts = loadDraftPlans().filter((draft) => draft.id !== draftId);
  saveDraftPlans(nextDrafts);
  return nextDrafts;
}
