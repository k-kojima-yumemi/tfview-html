// Review state of the viewer, as pure functions (no DOM), so it can be unit tested.
import type { SavedState, ViewData, ViewResource } from "../types.ts";

export type Granularity = "module" | "resource" | "line";
export type Level = 0 | 1 | 2;

export const LEVEL: Record<Granularity, Level> = { module: 0, resource: 1, line: 2 };

export interface TreeNode {
  id: string;
  level: Level;
  /** Confirmation units below this node: lineKeys, or the resourceKey of a resource without lines. */
  units: string[];
  parent: TreeNode | undefined;
  /** Modules contain resources, resources contain lines. */
  children: TreeNode[];
}

export interface Model {
  modules: TreeNode[];
  nodes: Map<string, TreeNode>;
  /** unit key -> slot key */
  unitSlot: Map<string, string>;
  resources: Map<string, ViewResource>;
}

export interface ReviewState {
  confirmed: ReadonlySet<string>;
  /** Slots of confirmed units (plus changed slots still waiting for re-confirmation). */
  slots: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
  granularity: Granularity;
}

export function lineNodeId(key: string): string {
  return `l:${key}`;
}

export function buildModel(data: ViewData): Model {
  const nodes = new Map<string, TreeNode>();
  const unitSlot = new Map<string, string>();
  const resources = new Map<string, ViewResource>();
  const add = (n: TreeNode) => {
    nodes.set(n.id, n);
    return n;
  };

  const modules = data.modules.map((mod) => {
    const m = add({ id: mod.id, level: 0, units: [], parent: undefined, children: [] });
    for (const res of mod.resources) {
      resources.set(res.id, res);
      const units = res.lines.length > 0 ? res.lines.map((l) => l.key) : [res.resourceKey];
      const r = add({ id: res.id, level: 1, units, parent: m, children: [] });
      if (res.lines.length === 0) unitSlot.set(res.resourceKey, res.slot);
      for (const line of res.lines) {
        unitSlot.set(line.key, line.slot);
        r.children.push(add({ id: lineNodeId(line.key), level: 2, units: [line.key], parent: r, children: [] }));
      }
      m.children.push(r);
      m.units.push(...units);
    }
    return m;
  });
  return { modules, nodes, unitSlot, resources };
}

// ---------------------------------------------------------------------------
// Saved state

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Accepts the current format and a bare array of keys. */
export function parseSaved(value: unknown): SavedState | null {
  if (isStringArray(value)) return { version: 1, confirmed: value, slots: [] };
  if (value && typeof value === "object") {
    const v = value as Partial<SavedState>;
    if (isStringArray(v.confirmed)) {
      return { version: 1, confirmed: v.confirmed, slots: isStringArray(v.slots) ? v.slots : [] };
    }
  }
  return null;
}

export function toSaved(state: ReviewState): SavedState {
  return { version: 1, confirmed: [...state.confirmed], slots: [...state.slots] };
}

export interface Restored {
  state: ReviewState;
  /** Units that were already confirmed when the page loaded (carried over from the previous plan). */
  carried: ReadonlySet<string>;
  /** Units whose slot was confirmed before, but whose content changed since. */
  updated: ReadonlySet<string>;
}

/**
 * Restores the saved state for this plan. Keys that are not in this plan are
 * dropped (old-key cleanup), and every fully confirmed node starts folded.
 */
export function restore(model: Model, saved: SavedState, granularity: Granularity): Restored {
  const currentSlots = new Set(model.unitSlot.values());
  const savedSlots = new Set(saved.slots);
  const confirmed = new Set(saved.confirmed.filter((k) => model.unitSlot.has(k)));
  const updated = new Set([...model.unitSlot].filter(([k, s]) => savedSlots.has(s) && !confirmed.has(k)).map(([k]) => k));
  const slots = new Set([...savedSlots].filter((s) => currentSlots.has(s)));
  for (const k of confirmed) slots.add(model.unitSlot.get(k)!);

  const state: ReviewState = { confirmed, slots, collapsed: new Set(), granularity };
  return { state: collapseDone(model, state), carried: new Set(confirmed), updated };
}

// ---------------------------------------------------------------------------
// Queries

export function confirmedCount(state: ReviewState, node: TreeNode): number {
  let n = 0;
  for (const k of node.units) if (state.confirmed.has(k)) n++;
  return n;
}

export function isDone(state: ReviewState, node: TreeNode): boolean {
  return node.units.every((k) => state.confirmed.has(k));
}

/** Nodes counted by the progress bar at the current granularity. */
export function progressUnits(model: Model, granularity: Granularity): TreeNode[] {
  const resources = model.modules.flatMap((m) => m.children);
  if (granularity === "module") return model.modules;
  if (granularity === "resource") return resources;
  // Lines, plus resources that have no lines (they are their own unit).
  return resources.flatMap((r) => (r.children.length > 0 ? r.children : [r]));
}

export function progress(model: Model, state: ReviewState): { done: number; total: number } {
  const units = progressUnits(model, state.granularity);
  return { done: units.filter((n) => isDone(state, n)).length, total: units.length };
}

// ---------------------------------------------------------------------------
// Updates (each returns a new state)

function forEachBranch(node: TreeNode, fn: (n: TreeNode) => void): void {
  if (node.level === 2) return;
  fn(node);
  for (const c of node.children) forEachBranch(c, fn);
}

/**
 * Sets every line below the node to the opposite of its current "all confirmed"
 * state, folds/unfolds the node and its descendants the same way, then lets each
 * ancestor fold if everything below it is confirmed (or unfold otherwise).
 */
export function toggleNode(model: Model, state: ReviewState, node: TreeNode): ReviewState {
  const target = !isDone(state, node);
  const confirmed = new Set(state.confirmed);
  const slots = new Set(state.slots);
  for (const k of node.units) {
    const slot = model.unitSlot.get(k)!;
    if (target) {
      confirmed.add(k);
      slots.add(slot);
    } else {
      confirmed.delete(k);
      slots.delete(slot);
    }
  }
  const collapsed = new Set(state.collapsed);
  forEachBranch(node, (n) => (target ? collapsed.add(n.id) : collapsed.delete(n.id)));
  const next: ReviewState = { ...state, confirmed, slots, collapsed };
  for (let a = node.parent; a; a = a.parent) {
    if (isDone(next, a)) collapsed.add(a.id);
    else collapsed.delete(a.id);
  }
  return next;
}

export function toggleCollapsed(state: ReviewState, id: string): ReviewState {
  const collapsed = new Set(state.collapsed);
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  return { ...state, collapsed };
}

/** Folds every module/resource whose lines are all confirmed. */
export function collapseDone(model: Model, state: ReviewState): ReviewState {
  const collapsed = new Set(state.collapsed);
  for (const n of model.nodes.values()) if (n.level < 2 && isDone(state, n)) collapsed.add(n.id);
  return { ...state, collapsed };
}

/** Folding below the chosen level is released. */
export function setGranularity(model: Model, state: ReviewState, granularity: Granularity): ReviewState {
  const collapsed = new Set([...state.collapsed].filter((id) => (model.nodes.get(id)?.level ?? 0) <= LEVEL[granularity]));
  return { ...state, granularity, collapsed };
}

/** Merges imported confirmations into the current ones. Keys not in this plan are ignored. */
export function importSaved(model: Model, state: ReviewState, saved: SavedState): { state: ReviewState; added: number } {
  const currentSlots = new Set(model.unitSlot.values());
  const confirmed = new Set(state.confirmed);
  const slots = new Set(state.slots);
  let added = 0;
  for (const k of saved.confirmed) {
    if (model.unitSlot.has(k) && !confirmed.has(k)) {
      confirmed.add(k);
      slots.add(model.unitSlot.get(k)!);
      added++;
    }
  }
  for (const s of saved.slots) if (currentSlots.has(s)) slots.add(s);
  return { state: collapseDone(model, { ...state, confirmed, slots }), added };
}

export function reset(state: ReviewState): ReviewState {
  return { ...state, confirmed: new Set(), slots: new Set(), collapsed: new Set() };
}
