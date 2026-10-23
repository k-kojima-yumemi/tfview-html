// Review state of the viewer, as pure functions (no DOM), so it can be unit tested.
import type {
    DisplayItem,
    ReorderView,
    SavedState,
    ViewData,
    ViewResource,
} from "../types.ts";

export type ReorderItem = Extract<DisplayItem, { t: "reorder" }>;

/** Which field each reorderable list is currently matched by (see `viewKey`). Lists not in it are shown by position. */
export type Views = ReadonlyMap<string, string>;

export function viewKey(resourceId: string, path: string): string {
    return `${resourceId}\0${path}`;
}

/** The layout of a reorderable list that is on display. */
export function viewOf(
    item: ReorderItem,
    resourceId: string,
    views: Views,
): ReorderView {
    const field = views.get(viewKey(resourceId, item.path));
    return item.options.find((o) => o.field === field)?.view ?? item.base;
}

/** Indexes into `res.lines` of the lines on display, in display order. */
export function activeLines(res: ViewResource, views: Views): number[] {
    const out: number[] = [];
    const walk = (items: DisplayItem[]) => {
        for (const it of items) {
            if (it.t === "line") out.push(it.i);
            else if (it.t === "group") walk(it.items);
            else if (it.t === "reorder") walk(viewOf(it, res.id, views).items);
        }
    };
    walk(res.display);
    return out;
}

/** 0: module, 1: resource, 2: line. */
export type Level = 0 | 1 | 2;

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
    /** unit key -> slot key, for the lines of every view (also those not on display) */
    unitSlot: Map<string, string>;
    /** Units on display. */
    active: Set<string>;
    resources: Map<string, ViewResource>;
}

export interface ReviewState {
    confirmed: ReadonlySet<string>;
    /** Slots of confirmed units (plus changed slots still waiting for re-confirmation). */
    slots: ReadonlySet<string>;
    collapsed: ReadonlySet<string>;
}

export function lineNodeId(key: string): string {
    return `l:${key}`;
}

export function buildModel(data: ViewData, views: Views = new Map()): Model {
    const nodes = new Map<string, TreeNode>();
    const unitSlot = new Map<string, string>();
    const active = new Set<string>();
    const resources = new Map<string, ViewResource>();
    const add = (n: TreeNode) => {
        nodes.set(n.id, n);
        return n;
    };

    const modules = data.modules.map((mod) => {
        const m = add({
            id: mod.id,
            level: 0,
            units: [],
            parent: undefined,
            children: [],
        });
        for (const res of mod.resources) {
            resources.set(res.id, res);
            // Lines of every view are known (confirmations of a view not on display are kept), but only those on display are units.
            const shown = activeLines(res, views).map((i) => lineAt(res, i));
            const units =
                shown.length > 0 ? shown.map((l) => l.key) : [res.resourceKey];
            for (const k of units) active.add(k);
            const r = add({
                id: res.id,
                level: 1,
                units,
                parent: m,
                children: [],
            });
            // A view without lines makes the resource its own unit, so its key is always known.
            unitSlot.set(res.resourceKey, res.slot);
            for (const line of res.lines) unitSlot.set(line.key, line.slot);
            for (const line of shown) {
                r.children.push(
                    add({
                        id: lineNodeId(line.key),
                        level: 2,
                        units: [line.key],
                        parent: r,
                        children: [],
                    }),
                );
            }
            m.children.push(r);
            m.units.push(...units);
        }
        return m;
    });
    return { modules, nodes, unitSlot, active, resources };
}

/** A line by index. Display items index into the same resource, so a miss is a bug. */
function lineAt(res: ViewResource, i: number) {
    const line = res.lines[i];
    if (line === undefined) throw new Error(`${res.address}: no line ${i}`);
    return line;
}

/** A node of this model by id. Ids come from the same data, so a miss is a bug. */
export function nodeOf(model: Model, id: string): TreeNode {
    const node = model.nodes.get(id);
    if (node === undefined) throw new Error(`unknown node: ${id}`);
    return node;
}

/** The slot of a unit of this model. Every unit has one, so a miss is a bug. */
function slotOf(model: Model, key: string): string {
    const slot = model.unitSlot.get(key);
    if (slot === undefined) throw new Error(`unknown unit: ${key}`);
    return slot;
}

// ---------------------------------------------------------------------------
// Saved state

function isStringArray(v: unknown): v is string[] {
    return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Accepts the current format and a bare array of keys. */
export function parseSaved(value: unknown): SavedState | null {
    if (isStringArray(value))
        return { version: 1, confirmed: value, slots: [] };
    if (value && typeof value === "object") {
        const v = value as Partial<SavedState>;
        if (isStringArray(v.confirmed)) {
            return {
                version: 1,
                confirmed: v.confirmed,
                slots: isStringArray(v.slots) ? v.slots : [],
            };
        }
    }
    return null;
}

export function toSaved(state: ReviewState): SavedState {
    return {
        version: 1,
        confirmed: [...state.confirmed],
        slots: [...state.slots],
    };
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
export function restore(model: Model, saved: SavedState): Restored {
    const currentSlots = new Set(model.unitSlot.values());
    const savedSlots = new Set(saved.slots);
    const confirmed = new Set(
        saved.confirmed.filter((k) => model.unitSlot.has(k)),
    );
    const updated = new Set(
        [...model.unitSlot]
            .filter(
                ([k, s]) =>
                    model.active.has(k) &&
                    savedSlots.has(s) &&
                    !confirmed.has(k),
            )
            .map(([k]) => k),
    );
    const slots = new Set([...savedSlots].filter((s) => currentSlots.has(s)));
    for (const k of confirmed) slots.add(slotOf(model, k));

    const state: ReviewState = {
        confirmed,
        slots,
        collapsed: new Set(),
    };
    return {
        state: collapseDone(model, state),
        carried: new Set([...confirmed].filter((k) => model.active.has(k))),
        updated,
    };
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

export interface Count {
    done: number;
    total: number;
}

export interface Progress {
    /** Lines, plus resources that have no lines (they are their own unit). */
    lines: Count;
    resources: Count;
    modules: Count;
}

function count(state: ReviewState, nodes: TreeNode[]): Count {
    return {
        done: nodes.filter((n) => isDone(state, n)).length,
        total: nodes.length,
    };
}

export function progress(model: Model, state: ReviewState): Progress {
    const resources = model.modules.flatMap((m) => m.children);
    const lines = resources.flatMap((r) =>
        r.children.length > 0 ? r.children : [r],
    );
    return {
        lines: count(state, lines),
        resources: count(state, resources),
        modules: count(state, model.modules),
    };
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
export function toggleNode(
    model: Model,
    state: ReviewState,
    node: TreeNode,
): ReviewState {
    const target = !isDone(state, node);
    const confirmed = new Set(state.confirmed);
    const slots = new Set(state.slots);
    for (const k of node.units) {
        const slot = slotOf(model, k);
        if (target) {
            confirmed.add(k);
            slots.add(slot);
        } else {
            confirmed.delete(k);
            slots.delete(slot);
        }
    }
    const collapsed = new Set(state.collapsed);
    forEachBranch(node, (n) =>
        target ? collapsed.add(n.id) : collapsed.delete(n.id),
    );
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
    for (const n of model.nodes.values())
        if (n.level < 2 && isDone(state, n)) collapsed.add(n.id);
    return { ...state, collapsed };
}

/** Merges imported confirmations into the current ones. Keys not in this plan are ignored. */
export function importSaved(
    model: Model,
    state: ReviewState,
    saved: SavedState,
): { state: ReviewState; added: number } {
    const currentSlots = new Set(model.unitSlot.values());
    const confirmed = new Set(state.confirmed);
    const slots = new Set(state.slots);
    let added = 0;
    for (const k of saved.confirmed) {
        if (model.unitSlot.has(k) && !confirmed.has(k)) {
            confirmed.add(k);
            slots.add(slotOf(model, k));
            added++;
        }
    }
    for (const s of saved.slots) if (currentSlots.has(s)) slots.add(s);
    return {
        state: collapseDone(model, { ...state, confirmed, slots }),
        added,
    };
}

export function reset(state: ReviewState): ReviewState {
    return {
        ...state,
        confirmed: new Set(),
        slots: new Set(),
        collapsed: new Set(),
    };
}
