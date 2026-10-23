import {
    canonical,
    lineKey,
    resourceKey,
    slotKey,
    unknownValue,
} from "./hash.ts";
import type {
    Badge,
    DisplayItem,
    Hidden,
    LineOp,
    ReorderView,
    ViewLine,
    ViewModule,
    ViewResource,
} from "./types.ts";

// Subset of the `terraform show -json` format that tfview reads.
// biome-ignore-start lint/style/useNamingConvention: field names of Terraform's JSON plan format
export interface PlanJson {
    format_version?: string;
    terraform_version?: string;
    resource_changes?: ResourceChange[];
}

export interface ResourceChange {
    address: string;
    module_address?: string;
    deposed?: string;
    change: {
        actions: string[];
        before?: unknown;
        after?: unknown;
        after_unknown?: unknown;
        before_sensitive?: unknown;
        after_sensitive?: unknown;
        replace_paths?: (string | number)[][];
        /** Present when the resource is imported by an `import` block. Terraform 1.12+ may use `identity` instead of `id`. */
        importing?: { id?: string; identity?: unknown };
    };
}
// biome-ignore-end lint/style/useNamingConvention: field names of Terraform's JSON plan format

/** A map key or a list index. */
type Key = string | number;

/**
 * A list element addressed by the value of one of its fields (`[name="FOO"]`),
 * for lists that are compared by that field instead of by position.
 * `indexes` are the positions it had before and after, for `replace_paths`.
 */
interface KeySegment {
    field: string;
    value: string;
    indexes: number[];
}

type Segment = Key | KeySegment;

export const rootModule = "(root)";

const skippedActions = new Set(["no-op", "read"]);

export interface TreeOptions {
    /** Embed sensitive values in the HTML (they are still flagged as sensitive). Off by default. */
    showSensitive?: boolean;
}

interface LineOptions {
    /** Values that must not be shown unless `showSensitive` is set. */
    secrets: ReadonlySet<string>;
    showSensitive: boolean;
}

export function buildTree(
    plan: PlanJson,
    opts: TreeOptions = {},
): ViewModule[] {
    const modules = new Map<string, ViewModule>();
    const changes = plan.resource_changes ?? [];
    const lineOpts: LineOptions = {
        secrets: collectSensitiveStrings(changes),
        showSensitive: opts.showSensitive ?? false,
    };

    for (const rc of changes) {
        const actions = rc.change.actions;
        // An import without changes is a no-op, but still something to review.
        if (
            actions.length === 1 &&
            actions.every((a) => skippedActions.has(a)) &&
            !rc.change.importing
        )
            continue;

        const moduleAddress = rc.module_address ?? "";
        let mod = modules.get(moduleAddress);
        if (!mod) {
            mod = {
                id: `m:${moduleAddress}`,
                address: moduleAddress || rootModule,
                resources: [],
            };
            modules.set(moduleAddress, mod);
        }
        mod.resources.push(buildResource(rc, lineOpts));
    }

    // Root first, then modules by address. Resources keep the plan's order.
    return [...modules.entries()]
        .sort(([a], [b]) =>
            a === "" ? -1 : b === "" ? 1 : a < b ? -1 : a > b ? 1 : 0,
        )
        .map(([, mod]) => mod);
}

// Strings shorter than this are too likely to match unrelated values.
const minSecretLength = 4;

/**
 * Every string value that the plan marks as sensitive, anywhere.
 *
 * Terraform does not always carry the mark along with the value: e.g. the
 * `output` of `terraform_data` repeats a sensitive `input` without marking it.
 * Lines whose displayed value contains one of these strings are masked too.
 */
export function collectSensitiveStrings(
    changes: readonly ResourceChange[],
): Set<string> {
    const secrets = new Set<string>();
    const collectAll = (v: unknown) => {
        if (typeof v === "string") {
            if (v.length >= minSecretLength) secrets.add(v);
        } else if (v !== null && typeof v === "object") {
            for (const c of Object.values(v)) collectAll(c);
        }
    };
    const walk = (v: unknown, mark: unknown) => {
        if (mark === true) return collectAll(v);
        if (mark === null || typeof mark !== "object") return;
        for (const k of childKeys(mark)) walk(child(v, k), child(mark, k));
    };
    for (const rc of changes) {
        walk(rc.change.before, rc.change.before_sensitive);
        walk(rc.change.after, rc.change.after_sensitive);
    }
    return secrets;
}

function containsSecret(value: unknown, secrets: ReadonlySet<string>): boolean {
    if (secrets.size === 0) return false;
    if (typeof value === "string") {
        for (const s of secrets) if (value.includes(s)) return true;
        return false;
    }
    if (value !== null && typeof value === "object") {
        return Object.values(value).some((c) => containsSecret(c, secrets));
    }
    return false;
}

function buildResource(rc: ResourceChange, opts: LineOptions): ViewResource {
    const address = rc.deposed
        ? `${rc.address} (deposed ${rc.deposed})`
        : rc.address;
    const { actions } = rc.change;
    const importing = importSource(rc.change.importing);
    const res: ViewResource = {
        id: `r:${address}`,
        address,
        actions,
        badge: badgeFor(actions, importing !== undefined),
        resourceKey: resourceKey(address, actions, importing),
        slot: slotKey(address),
        ...expandResource(address, rc.change, opts),
    };
    if (importing !== undefined) res.importing = importing;
    return res;
}

/** The import ID, or the identity as canonical JSON. */
function importSource(
    importing: ResourceChange["change"]["importing"],
): string | undefined {
    if (!importing) return undefined;
    if (typeof importing.id === "string" && importing.id !== "")
        return importing.id;
    if (importing.identity !== undefined && importing.identity !== null)
        return canonical(importing.identity);
    return "";
}

export function badgeFor(actions: readonly string[], importing = false): Badge {
    const joined = actions.join(",");
    switch (joined) {
        case "no-op":
            return importing ? "import" : joined;
        case "create":
            return "+";
        case "delete":
            return "-";
        case "update":
            return "~";
        case "delete,create":
        case "create,delete":
            return "-/+";
        default:
            return joined;
    }
}

/**
 * Compares before/after recursively and emits one line per changed leaf.
 * Works for every action: for create `before` is null (every leaf is `+`),
 * for delete `after` is null (every leaf is `-`).
 */
export function expandLines(
    address: string,
    change: ResourceChange["change"],
    opts?: LineOptions,
): ViewLine[] {
    return expandResource(address, change, opts).lines;
}

export interface Expanded {
    /** Changed leaves, in display order. These are the confirmation units. */
    lines: ViewLine[];
    /** The same lines laid out Terraform plan style. */
    display: DisplayItem[];
    hidden?: Hidden;
}

// Unchanged attributes that Terraform keeps showing at the top of a resource.
const contextAttributes = ["id", "name"];

interface Walked {
    items: DisplayItem[];
    /** Unchanged elements of a block list whose other elements changed. */
    hiddenBlocks: number;
}

export function expandResource(
    address: string,
    change: ResourceChange["change"],
    { secrets, showSensitive }: LineOptions = {
        secrets: collectSensitiveStrings([{ address, change }]),
        showSensitive: false,
    },
): Expanded {
    const lines: ViewLine[] = [];
    const replacePaths = change.replace_paths ?? [];
    const isMasked = (v: unknown) => containsSecret(v, secrets);

    /** Adds a line if the leaf changed; returns its index, or -1. */
    const emit = (
        segs: Segment[],
        before: unknown,
        after: unknown,
        unknown: boolean,
        sensitive: boolean,
    ): number => {
        const b = isAbsent(before) ? undefined : before;
        const a = unknown ? unknownValue : isAbsent(after) ? undefined : after;
        if (canonical(b) === canonical(a)) return -1;

        const path = formatPath(segs);
        const op: LineOp = b === undefined ? "+" : a === undefined ? "-" : "~";
        const line: ViewLine = {
            key: lineKey(address, path, b, a),
            slot: slotKey(address, path),
            path,
            op,
        };
        const masked = sensitive || isMasked(b) || (!unknown && isMasked(a));
        if (masked) line.sensitive = true;
        // Unless asked for, a sensitive value is never embedded; it only contributed to the key above.
        if (!masked || showSensitive) {
            if (op !== "+") line.before = display(b);
            if (op !== "-" && !unknown) line.after = display(a);
        }
        if (unknown) line.unknown = true;
        if (replacePaths.some((rp) => overlaps(rp, segs)))
            line.forcesReplacement = true;
        lines.push(line);
        return lines.length - 1;
    };

    const leaf = (
        segs: Segment[],
        label: string | undefined,
        b: unknown,
        a: unknown,
        unknown: boolean,
        sensitive: boolean,
    ): Walked => {
        const i = emit(segs, b, a, unknown, sensitive);
        const items: DisplayItem[] =
            i < 0
                ? []
                : [
                      label === undefined
                          ? { t: "line", i }
                          : { t: "line", i, label },
                  ];
        return { items, hiddenBlocks: 0 };
    };

    const node = (
        segs: Segment[],
        label: string | undefined,
        inList: boolean,
        b: unknown,
        a: unknown,
        u: unknown,
        bs: unknown,
        as: unknown,
    ): Walked => {
        const unknown = u === true;
        const sensitive = bs === true || as === true;
        if (unknown || sensitive)
            return leaf(segs, label, b, a, unknown, sensitive);

        const bk = kindOf(b);
        const ak = kindOf(a);
        const recursable =
            bk !== "scalar" &&
            ak !== "scalar" &&
            (bk === "absent" || ak === "absent" || bk === ak);
        if (!recursable) return leaf(segs, label, b, a, false, false);

        const keys = childKeys(b, a, u);
        if (keys.length === 0) {
            // An empty map/list is itself a value worth showing (e.g. `tags = {}`),
            // except at the top level where it just means "no attributes".
            return segs.length > 0
                ? leaf(segs, label, b, a, false, false)
                : { items: [], hiddenBlocks: 0 };
        }

        if (!inList && label !== undefined && isBlockList(b, a)) {
            // A list of objects reads like repeated nested blocks: `ingress { ... }`.
            // `matchedBy`: the field the elements were paired up by, shown in each block even when unchanged.
            const blocks = (
                entries: BlockEntry[],
                matchedBy?: string,
            ): Walked => {
                const items: DisplayItem[] = [];
                let hiddenBlocks = 0;
                for (const e of entries) {
                    const g = group(
                        e.segs,
                        label,
                        "block",
                        e.b,
                        e.a,
                        e.u,
                        e.bs,
                        e.as,
                        matchedBy === undefined ? [] : [matchedBy],
                    );
                    if (g) items.push(g);
                    else if (!isAbsent(e.b) || !isAbsent(e.a)) hiddenBlocks++;
                }
                return { items, hiddenBlocks };
            };
            const byIndex = blocks(
                keys.map((k) => ({
                    segs: [...segs, k],
                    b: child(b, k),
                    a: child(a, k),
                    u: child(u, k),
                    bs: child(bs, k),
                    as: child(as, k),
                })),
            );
            const lists: BlockLists = { b, a, u, bs, as };
            const fields =
                byIndex.items.length > 0 ? reorderFields(lists, isMasked) : [];
            if (fields.length === 0) return byIndex;

            // The same list compared by the value of one field, for the viewer to switch to.
            const view = ({ items, hiddenBlocks }: Walked): ReorderView => {
                const hidden = compactHidden({
                    attributes: 0,
                    blocks: hiddenBlocks,
                    elements: 0,
                });
                return hidden ? { items, hidden } : { items };
            };
            return {
                items: [
                    {
                        t: "reorder",
                        path: formatPath(segs),
                        label,
                        base: view(byIndex),
                        options: fields.map((field) => ({
                            field,
                            view: view(
                                blocks(matchByField(segs, field, lists), field),
                            ),
                        })),
                    },
                ],
                hiddenBlocks: 0,
            };
        }

        const style = bk === "array" || ak === "array" ? "list" : "map";
        const g = group(segs, label, style, b, a, u, bs, as);
        return { items: g ? [g] : [], hiddenBlocks: 0 };
    };

    const group = (
        segs: Segment[],
        label: string | undefined,
        style: "map" | "list" | "block",
        b: unknown,
        a: unknown,
        u: unknown,
        bs: unknown,
        as: unknown,
        // Unchanged scalar attributes shown for orientation instead of being counted as hidden.
        contextKeys: readonly string[] = segs.length === 0
            ? contextAttributes
            : [],
    ): Extract<DisplayItem, { t: "group" }> | null => {
        const items: DisplayItem[] = [];
        const context: DisplayItem[] = [];
        const hidden = { attributes: 0, blocks: 0, elements: 0 };
        let changed = false;

        for (const k of childKeys(b, a, u)) {
            const cb = child(b, k);
            const ca = child(a, k);
            const r = node(
                [...segs, k],
                style === "list" ? undefined : formatKey(k),
                style === "list",
                cb,
                ca,
                child(u, k),
                child(bs, k),
                child(as, k),
            );
            if (r.items.length > 0) {
                changed = true;
                items.push(...r.items);
                hidden.blocks += r.hiddenBlocks;
                continue;
            }
            if (isAbsent(cb) && isAbsent(ca)) continue;
            const shownAsContext =
                typeof k === "string" &&
                contextKeys.includes(k) &&
                kindOf(ca) === "scalar" &&
                child(bs, k) !== true &&
                child(as, k) !== true &&
                !isMasked(ca);
            if (shownAsContext)
                context.push({ t: "ctx", label: k, value: display(ca) });
            else if (isBlockList(cb, ca))
                hidden.blocks += Math.max(arrayLength(cb), arrayLength(ca));
            // Without the provider schema, a nested map (e.g. `tags`) is told from an object by position only.
            else if (style === "list" || (style === "map" && segs.length > 0))
                hidden.elements++;
            else hidden.attributes++;
        }
        if (!changed) return null;

        const op: LineOp = isAbsent(b)
            ? "+"
            : isAbsent(a) && u !== true
              ? "-"
              : "~";
        const g: Extract<DisplayItem, { t: "group" }> = {
            t: "group",
            op,
            style,
            items: [...context, ...items],
        };
        if (label !== undefined) g.label = label;
        const h = compactHidden(hidden);
        if (h) g.hidden = h;
        return g;
    };

    const root = group(
        [],
        undefined,
        "map",
        change.before,
        change.after,
        change.after_unknown,
        change.before_sensitive,
        change.after_sensitive,
    );
    const result: Expanded = { lines, display: root?.items ?? [] };
    if (root?.hidden) result.hidden = root.hidden;
    return result;
}

function compactHidden(h: Required<Hidden>): Hidden | undefined {
    const out: Hidden = {};
    if (h.attributes) out.attributes = h.attributes;
    if (h.blocks) out.blocks = h.blocks;
    if (h.elements) out.elements = h.elements;
    return Object.keys(out).length > 0 ? out : undefined;
}

/** One element of a block list: its path and its slice of each of the five parallel trees. */
interface BlockEntry {
    segs: Segment[];
    b: unknown;
    a: unknown;
    u: unknown;
    bs: unknown;
    as: unknown;
}

/** The lists as found in before / after / after_unknown / before_sensitive / after_sensitive. */
interface BlockLists {
    b: unknown;
    a: unknown;
    u: unknown;
    bs: unknown;
    as: unknown;
}

/**
 * Fields by which the elements of a block list can be matched up: strings that
 * are known, not masked and unique within each side. Only fields for which some
 * element moved are returned: matching by the field would read the same as
 * matching by position for a list that only grew at the end, or whose elements
 * only changed in place.
 */
function reorderFields(
    { b, a, u, bs, as }: BlockLists,
    isMasked: (v: unknown) => boolean,
): string[] {
    const before = Array.isArray(b) ? b : [];
    const after = Array.isArray(a) ? a : [];
    const first = before[0] ?? after[0];
    if (before.length === 0 || after.length === 0 || kindOf(first) !== "object")
        return [];

    const valueAt = (
        list: unknown[],
        i: number,
        field: string,
        unknownMark: unknown,
        sensitiveMark: unknown,
    ): string | undefined => {
        const v = child(list[i], field);
        if (typeof v !== "string" || v === "" || isMasked(v)) return undefined;
        if (
            child(child(unknownMark, i), field) === true ||
            child(unknownMark, i) === true ||
            child(child(sensitiveMark, i), field) === true ||
            child(sensitiveMark, i) === true
        )
            return undefined;
        return v;
    };
    const valuesOf = (
        list: unknown[],
        field: string,
        unknownMark: unknown,
        sensitiveMark: unknown,
    ): string[] | undefined => {
        const out: string[] = [];
        for (let i = 0; i < list.length; i++) {
            const v = valueAt(list, i, field, unknownMark, sensitiveMark);
            if (v === undefined) return undefined;
            out.push(v);
        }
        return new Set(out).size === out.length ? out : undefined;
    };

    return Object.keys(first as object).filter((field) => {
        const bv = valuesOf(before, field, undefined, bs);
        const av = valuesOf(after, field, u, as);
        if (!bv || !av) return false;
        const afterIndex = new Map(av.map((v, i) => [v, i] as const));
        return bv.some((v, i) => {
            const j = afterIndex.get(v);
            return j !== undefined && j !== i;
        });
    });
}

/** The elements of a block list paired up by the value of `field`, sorted by that value. */
function matchByField(
    segs: Segment[],
    field: string,
    { b, a, u, bs, as }: BlockLists,
): BlockEntry[] {
    const before = Array.isArray(b) ? b : [];
    const after = Array.isArray(a) ? a : [];
    const indexOf = (list: unknown[]) =>
        new Map(list.map((e, i) => [String(child(e, field)), i] as const));
    const bi = indexOf(before);
    const ai = indexOf(after);
    const values = [...new Set([...bi.keys(), ...ai.keys()])].sort();
    return values.map((value) => {
        const ib = bi.get(value);
        const ia = ai.get(value);
        const seg: KeySegment = {
            field,
            value,
            indexes: [ib, ia].filter((i): i is number => i !== undefined),
        };
        return {
            segs: [...segs, seg],
            b: ib === undefined ? undefined : before[ib],
            a: ia === undefined ? undefined : after[ia],
            u: ia === undefined ? undefined : child(u, ia),
            bs: ib === undefined ? undefined : child(bs, ib),
            as: ia === undefined ? undefined : child(as, ia),
        };
    });
}

/** A non-empty list whose elements are all objects (Terraform's nested blocks look like this). */
function isBlockList(...values: unknown[]): boolean {
    const elements = values.filter(Array.isArray).flat();
    return elements.length > 0 && elements.every((e) => kindOf(e) === "object");
}

function arrayLength(v: unknown): number {
    return Array.isArray(v) ? v.length : 0;
}

function formatKey(k: Key): string {
    return typeof k === "string" && identifierPattern.test(k)
        ? k
        : JSON.stringify(String(k));
}

type Kind = "absent" | "scalar" | "array" | "object";

function isAbsent(v: unknown): boolean {
    return v === undefined || v === null;
}

function kindOf(v: unknown): Kind {
    if (isAbsent(v)) return "absent";
    if (Array.isArray(v)) return "array";
    if (typeof v === "object") return "object";
    return "scalar";
}

function child(v: unknown, k: Key): unknown {
    if (Array.isArray(v)) return typeof k === "number" ? v[k] : undefined;
    if (v !== null && typeof v === "object")
        return typeof k === "string"
            ? (v as Record<string, unknown>)[k]
            : undefined;
    return undefined;
}

function childKeys(...values: unknown[]): Key[] {
    const containers = values.filter(
        (v) => v !== null && typeof v === "object",
    );
    if (containers.some(Array.isArray)) {
        const len = Math.max(
            0,
            ...containers
                .filter(Array.isArray)
                .map((v) => (v as unknown[]).length),
        );
        return Array.from({ length: len }, (_, i) => i);
    }
    const keys = new Set<string>();
    for (const v of containers)
        for (const k of Object.keys(v as object)) keys.add(k);
    return [...keys].sort();
}

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function formatPath(segs: readonly Segment[]): string {
    let out = "";
    for (const s of segs) {
        if (typeof s === "number") out += `[${s}]`;
        else if (typeof s === "object")
            out += `[${s.field}=${JSON.stringify(s.value)}]`;
        else if (identifierPattern.test(s)) out += out === "" ? s : `.${s}`;
        else out += `[${JSON.stringify(s)}]`;
    }
    return out;
}

/** True when one path is a prefix of the other. */
function overlaps(rp: readonly Key[], segs: readonly Segment[]): boolean {
    const n = Math.min(rp.length, segs.length);
    for (let i = 0; i < n; i++) {
        const r = rp[i];
        const s = segs[i];
        if (s !== undefined && typeof s === "object") {
            // `replace_paths` address list elements by position.
            if (typeof r !== "number" || !s.indexes.includes(r)) return false;
        } else if (r !== s) return false;
    }
    return true;
}

/** Display text of a present value (callers never pass the missing side of a `+` / `-` line). */
function display(v: unknown): string {
    if (typeof v === "string") {
        // Multi-line strings (policies, user data, ...) read better unescaped.
        return v.includes("\n")
            ? `<<EOT\n${v}${v.endsWith("\n") ? "" : "\n"}EOT`
            : JSON.stringify(v);
    }
    return JSON.stringify(v);
}
