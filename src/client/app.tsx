// Browser side of tfview. Bundled by Rolldown (build/plugins.ts) and inlined by document.tsx.
import type { Child, FC } from "hono/jsx";
import {
    render,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "hono/jsx/dom";
import type {
    DisplayItem,
    Hidden,
    LineOp,
    ReorderOption,
    ViewData,
    ViewLine,
    ViewModule,
    ViewResource,
} from "../types.ts";
import {
    detectLocale,
    isLocale,
    type Locale,
    localeNames,
    locales,
} from "./i18n.ts";
import {
    buildModel,
    confirmedCount,
    isDone,
    lineNodeId,
    type Model,
    nodeOf,
    parseSaved,
    progress,
    type ReorderItem,
    type ReviewState,
    reset,
    restore,
    type TreeNode,
    toggleCollapsed,
    toggleNode,
    toSaved,
    type Views,
    viewKey,
    viewOf,
} from "./state.ts";
import { readJson, storageAvailable, writeJson } from "./storage.ts";

const clipLength = 120;

const lineOpClass: Record<LineOp, string> = {
    "+": "l-add",
    "-": "l-del",
    "~": "l-chg",
};

const actionTexts: Record<string, string> = {
    create: "will be created",
    delete: "will be destroyed",
    update: "will be updated in-place",
    "delete,create": "must be replaced",
    "create,delete": "must be replaced (create before destroy)",
    forget: "will be removed from state",
};

// ---------------------------------------------------------------------------
// Everything the tree components need, passed down as one prop.

interface Ctx {
    model: Model;
    state: ReviewState;
    carried: ReadonlySet<string>;
    updated: ReadonlySet<string>;
    showSensitive: boolean;
    views: Views;
    /** `optionId` is a `ReorderOption.id`, or "" for by position. */
    onView: (resourceId: string, path: string, optionId: string) => void;
    onToggle: (node: TreeNode) => void;
    onFold: (node: TreeNode) => void;
}

// ---------------------------------------------------------------------------
// Small pieces

const locale: Locale = detectLocale(location.search, navigator.languages);
const t = locales[locale];
document.documentElement.lang = locale;

/** Reloads with `?lang=`; the viewed state lives in localStorage, so nothing is lost. */
function switchLocale(next: Locale): void {
    const url = new URL(location.href);
    url.searchParams.set("lang", next);
    location.assign(url);
}

function opClass(badge: string): string {
    switch (badge) {
        case "+":
            return "op-add";
        case "-":
            return "op-del";
        case "~":
            return "op-chg";
        case "-/+":
            return "op-rep";
        case "import":
        case "moved":
            return "op-imp";
        default:
            return "op-other";
    }
}

const Checkbox: FC<{
    checked: boolean;
    indeterminate: boolean;
    class?: string;
    label: string;
    onChange: () => void;
}> = ({ checked, indeterminate, class: className, label, onChange }) => {
    const ref = useRef<HTMLInputElement>(null);
    // `indeterminate` is a DOM property only; there is no attribute for it.
    useLayoutEffect(() => {
        if (ref.current) ref.current.indeterminate = indeterminate;
    });
    return (
        <input
            ref={ref}
            type="checkbox"
            class={className}
            checked={checked}
            aria-label={label}
            onChange={onChange}
        />
    );
};

/** Joins class names, skipping falsy ones. Each argument is one class, so nothing relies on leading spaces. */
function classNames(...names: (string | false | undefined)[]): string {
    return names.filter(Boolean).join(" ");
}

/** A line by index. Display items index into the same resource, so a miss is a bug. */
function lineAt(res: ViewResource, i: number): ViewLine {
    const line = res.lines[i];
    if (line === undefined) throw new Error(`${res.address}: no line ${i}`);
    return line;
}

/** Copies with the Clipboard API. Where that API is unavailable or refuses, nothing is copied. */
async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/** Copies `text` without folding the header it sits in, and shows a check mark for a moment. */
const CopyButton: FC<{ text: string; label: string }> = ({ text, label }) => {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied) return;
        const t = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(t);
    }, [copied]);
    return (
        <button
            type="button"
            class={classNames("copy", copied && "copied")}
            title={copied ? t.copied : `${label}: ${text}`}
            aria-label={label}
            onClick={async () => setCopied(await copyText(text))}
        >
            {copied ? (
                "✓"
            ) : (
                <svg
                    viewBox="0 0 16 16"
                    width="14"
                    height="14"
                    aria-hidden="true"
                >
                    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                    <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
                </svg>
            )}
        </button>
    );
};

/** A value, clipped when long or multi-line; click to show it all. */
const Value: FC<{ text: string }> = ({ text }) => {
    const [expanded, setExpanded] = useState(false);
    const firstBreak = text.indexOf("\n");
    if (text.length <= clipLength && firstBreak === -1)
        return <span class="val">{text}</span>;
    // For heredocs, preview the first line of the content rather than just `<<EOT`.
    const preview = text.startsWith("<<EOT\n")
        ? `<<EOT ${text.split("\n", 2)[1]}`
        : text;
    const previewBreak = preview.indexOf("\n");
    const short = `${preview.slice(0, Math.min(clipLength, previewBreak === -1 ? preview.length : previewBreak))} …`;
    return (
        <button
            type="button"
            class={classNames("val", "clip", expanded && "expanded")}
            title={expanded ? t.clickToCollapse : t.clickToExpand}
            onClick={() => setExpanded(!expanded)}
        >
            {expanded ? text : short}
        </button>
    );
};

const Side: FC<{ line: ViewLine; side: "before" | "after" }> = ({
    line,
    side,
}) => {
    if (side === "after" && line.unknown)
        return <span class="val-unknown">(known after apply)</span>;
    // Values of sensitive lines are only present when generated with --show-sensitive.
    if (line.sensitive && line[side] === undefined)
        return <span class="val-sensitive">(sensitive)</span>;
    return <Value text={line[side] ?? "null"} />;
};

const Code: FC<{ depth: number; children?: Child }> = ({ depth, children }) => {
    return (
        <span class="code" style={`--d:${depth}`}>
            {children}
        </span>
    );
};

/** `label = ` with the label padded so that `=` lines up within a block, as in `terraform plan`. */
const Assign: FC<{
    label: string | undefined;
    width: number;
}> = ({ label, width }) => {
    if (label === undefined) return null;
    return (
        <>
            <span class="path">{label.padEnd(width)}</span>
            <span class="eq"> = </span>
        </>
    );
};

/** A read-only row (braces, context, comments): a blank checkbox column keeps it aligned with lines. */
const PlainRow: FC<{
    cls: string;
    sign?: string;
    done?: boolean;
    children?: Child;
}> = ({ cls, sign, done, children }) => {
    return (
        <div class={classNames("row", cls, done && "done")}>
            <span class="cb cb-space" />
            <span class="sign">{sign ?? ""}</span>
            {children}
        </div>
    );
};

function hiddenComments(hidden: Hidden | undefined): string[] {
    if (!hidden) return [];
    const out: string[] = [];
    const add = (n: number | undefined, one: string, many: string) => {
        if (n) out.push(`# (${n} unchanged ${n === 1 ? one : many} hidden)`);
    };
    add(hidden.attributes, "attribute", "attributes");
    add(hidden.elements, "element", "elements");
    add(hidden.blocks, "block", "blocks");
    return out;
}

function lineKeysOf(
    ctx: Ctx,
    items: DisplayItem[],
    res: ViewResource,
): string[] {
    return items.flatMap((it) =>
        it.t === "line"
            ? [lineAt(res, it.i).key]
            : it.t === "group"
              ? lineKeysOf(ctx, it.items, res)
              : it.t === "reorder"
                ? lineKeysOf(ctx, viewOf(it, res.id, ctx.views).items, res)
                : [],
    );
}

/** `# (imported from "id")`, as `terraform plan` prints it. An identity (Terraform 1.12+) is shown as JSON. */
function importComment(source: string): string {
    return `# (imported from ${source.startsWith("{") ? source : JSON.stringify(source)})`;
}

/** `# (moved from addr)`, as `terraform plan` prints it. */
function movedComment(from: string): string {
    return `# (moved from ${from})`;
}

function actionText(res: ViewResource): string {
    const actions = res.actions.join(",");
    if (actions === "no-op" && res.importing !== undefined)
        return "will be imported";
    if (actions === "no-op" && res.movedFrom !== undefined) return "has moved";
    return actionTexts[actions] ?? res.actions.join(", ");
}

// ---------------------------------------------------------------------------
// Lines, laid out Terraform plan style

const LineRow: FC<{
    ctx: Ctx;
    res: ViewResource;
    line: ViewLine;
    label: string | undefined;
    width: number;
    depth: number;
    inList: boolean;
}> = ({ ctx, line, label, width, depth, inList }) => {
    const node = nodeOf(ctx.model, lineNodeId(line.key));
    const done = ctx.state.confirmed.has(line.key);
    return (
        <div
            class={classNames(
                "row",
                "line",
                lineOpClass[line.op],
                done && "done",
            )}
            title={line.path}
            data-id={node.id}
        >
            <Checkbox
                class="cb"
                checked={done}
                indeterminate={false}
                label={t.markViewed(line.path)}
                onChange={() => ctx.onToggle(node)}
            />
            <span class="sign">{line.op}</span>
            <Code depth={depth}>
                <Assign label={label} width={width} />
                {line.op === "+" ? (
                    <Side line={line} side="after" />
                ) : line.op === "-" ? (
                    <Side line={line} side="before" />
                ) : (
                    <>
                        <Side line={line} side="before" />
                        <span class="arrow"> -&gt; </span>
                        <Side line={line} side="after" />
                    </>
                )}
                {inList && <span class="punct">,</span>}
                {line.forcesReplacement && (
                    <span class="tag tag-force">forces replacement</span>
                )}
                {line.sensitive && ctx.showSensitive && (
                    <span class="tag tag-sensitive">sensitive</span>
                )}
                {ctx.updated.has(line.key) && !done && (
                    <span class="tag tag-updated">{t.updated}</span>
                )}
            </Code>
        </div>
    );
};

/** A list of plain values that can be compared by value, ignoring order. */
function isValueList(it: ReorderItem): boolean {
    return it.options.some((o) => o.field === undefined);
}

/** Renders as `label = [ ... ]` (plain values, or objects inside JSON), not as repeated blocks. */
function isAssignment(it: ReorderItem): boolean {
    return !it.base.items.some((b) => b.t === "group" && b.style === "block");
}

function reorderOptionText(o: ReorderOption): string {
    return o.field === undefined
        ? t.compareIgnoringOrder
        : t.compareByField(o.field);
}

const Items: FC<{
    ctx: Ctx;
    res: ViewResource;
    items: DisplayItem[];
    depth: number;
    inList: boolean;
    /** Width to pad labels to; the default is the widest label among `items`. */
    width?: number;
}> = ({ ctx, res, items, depth, inList, width: givenWidth }) => {
    const width =
        givenWidth ??
        Math.max(
            0,
            ...items.map((it) =>
                (it.t === "group" && it.style === "block") ||
                (it.t === "reorder" && !isAssignment(it))
                    ? 0
                    : (it.label?.length ?? 0),
            ),
        );
    return (
        <>
            {items.map((it) => {
                if (it.t === "line") {
                    return (
                        <LineRow
                            ctx={ctx}
                            res={res}
                            line={lineAt(res, it.i)}
                            label={it.label}
                            width={width}
                            depth={depth}
                            inList={inList}
                        />
                    );
                }
                if (it.t === "ctx") {
                    return (
                        <PlainRow cls="ctx">
                            <Code depth={depth}>
                                <Assign label={it.label} width={width} />
                                <Value text={it.value} />
                            </Code>
                        </PlainRow>
                    );
                }
                if (it.t === "reorder") {
                    const view = viewOf(it, res.id, ctx.views);
                    const chosen =
                        ctx.views.get(viewKey(res.id, it.path)) ?? "";
                    return (
                        <>
                            <PlainRow cls="comment reorder">
                                <Code depth={depth}>
                                    {`# ${it.label}: `}
                                    <select
                                        class="reorder-select"
                                        aria-label={t.compareLabel(it.label)}
                                        title={
                                            isValueList(it)
                                                ? t.compareByValueHint
                                                : t.compareByFieldHint
                                        }
                                        value={chosen}
                                        onChange={(e) =>
                                            ctx.onView(
                                                res.id,
                                                it.path,
                                                (e.target as HTMLSelectElement)
                                                    .value,
                                            )
                                        }
                                    >
                                        <option value="">
                                            {t.compareByPosition}
                                        </option>
                                        {it.options.map((o) => (
                                            <option value={o.id}>
                                                {reorderOptionText(o)}
                                            </option>
                                        ))}
                                    </select>
                                </Code>
                            </PlainRow>
                            <Items
                                ctx={ctx}
                                res={res}
                                items={view.items}
                                depth={depth}
                                inList={false}
                                width={isAssignment(it) ? width : undefined}
                            />
                            {hiddenComments(view.hidden).map((c) => (
                                <PlainRow cls="comment">
                                    <Code depth={depth}>{c}</Code>
                                </PlainRow>
                            ))}
                        </>
                    );
                }
                const done = lineKeysOf(ctx, it.items, res).every((k) =>
                    ctx.state.confirmed.has(k),
                );
                return (
                    <>
                        <PlainRow
                            cls={`grp ${lineOpClass[it.op]}`}
                            sign={it.op}
                            done={done}
                        >
                            <Code depth={depth}>
                                {it.style === "block" ? (
                                    <>
                                        <span class="path">
                                            {it.label ?? ""}
                                        </span>{" "}
                                        {"{"}
                                    </>
                                ) : (
                                    <>
                                        <Assign
                                            label={it.label}
                                            width={width}
                                        />
                                        {it.json && "jsonencode("}
                                        {it.style === "list" ? "[" : "{"}
                                    </>
                                )}
                            </Code>
                        </PlainRow>
                        <Items
                            ctx={ctx}
                            res={res}
                            items={it.items}
                            depth={depth + 1}
                            inList={it.style === "list"}
                        />
                        {hiddenComments(it.hidden).map((c) => (
                            <PlainRow cls="comment">
                                <Code depth={depth + 1}>{c}</Code>
                            </PlainRow>
                        ))}
                        <PlainRow cls="grp-close" done={done}>
                            <Code depth={depth}>
                                {it.style === "list" ? "]" : "}"}
                                {it.json && ")"}
                                {inList ? "," : ""}
                            </Code>
                        </PlainRow>
                    </>
                );
            })}
        </>
    );
};

// ---------------------------------------------------------------------------
// Modules and resources

const NodeHead: FC<{
    ctx: Ctx;
    node: TreeNode;
    foldable: boolean;
    label: string;
    children?: Child;
}> = ({ ctx, node, foldable, label, children }) => {
    const { state } = ctx;
    const total = node.units.length;
    const done = confirmedCount(state, node);
    const all = done === total;
    const lineCount =
        node.level === 1 && node.children.length === 0 ? 0 : total;
    const status =
        lineCount === 0
            ? all
                ? `${t.viewed} · ${t.noAttributeChanges}`
                : t.noAttributeChanges
            : all
              ? `${t.viewed} · ${t.lines(lineCount)}`
              : done > 0
                ? `${done} / ${t.lines(lineCount)}`
                : t.lines(lineCount);
    let carriedN = 0;
    let updatedN = 0;
    for (const k of node.units) {
        if (ctx.carried.has(k) && state.confirmed.has(k)) carriedN++;
        if (ctx.updated.has(k) && !state.confirmed.has(k)) updatedN++;
    }

    const onClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest("input, .copy") || !foldable) return;
        // Clicking the caret or the header text folds/unfolds, unless the user is selecting text.
        if (
            !target.closest(".caret") &&
            String(window.getSelection() ?? "") !== ""
        )
            return;
        ctx.onFold(node);
    };

    return (
        // A mouse shortcut for the caret button, which is the keyboard-accessible control.
        // biome-ignore lint/a11y/noStaticElementInteractions: see above
        // biome-ignore lint/a11y/useKeyWithClickEvents: see above
        <div class="head" onClick={onClick}>
            <button
                type="button"
                class={classNames("caret", !foldable && "hidden")}
                aria-label={t.toggleFold}
                tabindex={foldable ? 0 : -1}
            >
                ›
            </button>
            <Checkbox
                checked={all}
                indeterminate={done > 0 && !all}
                label={t.markViewed(label)}
                onChange={() => ctx.onToggle(node)}
            />
            {children}
            <span class="spacer" />
            {updatedN > 0 && (
                <span class="tag tag-updated">{t.updatedCount(updatedN)}</span>
            )}
            {carriedN > 0 && (
                <span class="tag tag-carried">{t.carriedCount(carriedN)}</span>
            )}
            <span class="status">{status}</span>
        </div>
    );
};

function nodeClass(ctx: Ctx, node: TreeNode, base: string): string {
    return classNames(
        base,
        "node",
        isDone(ctx.state, node) && "done",
        ctx.state.collapsed.has(node.id) && "collapsed",
    );
}

const ResourceView: FC<{ ctx: Ctx; res: ViewResource }> = ({ ctx, res }) => {
    const node = nodeOf(ctx.model, res.id);
    const hasBody =
        res.lines.length > 0 ||
        res.importing !== undefined ||
        res.movedFrom !== undefined;
    return (
        <div class={nodeClass(ctx, node, "resource")} data-id={res.id}>
            <NodeHead
                ctx={ctx}
                node={node}
                foldable={hasBody}
                label={res.address}
            >
                <span
                    class={`badge ${opClass(res.badge)}`}
                    title={res.actions.join(", ")}
                >
                    {res.badge}
                </span>
                {res.importing !== undefined && res.badge !== "import" && (
                    <span class="tag tag-import" title={res.importing}>
                        import
                    </span>
                )}
                {res.movedFrom !== undefined && res.badge !== "moved" && (
                    <span class="tag tag-import" title={res.movedFrom}>
                        moved
                    </span>
                )}
                <span class="name">{res.address}</span>
                <CopyButton text={res.target} label={t.copyResourceName} />
                <span class="action">{actionText(res)}</span>
            </NodeHead>
            {hasBody && (
                <div class="children">
                    <div class="lines">
                        {res.movedFrom !== undefined && (
                            <PlainRow cls="comment import">
                                <Code depth={0}>
                                    {movedComment(res.movedFrom)}
                                </Code>
                            </PlainRow>
                        )}
                        {res.importing !== undefined && (
                            <PlainRow cls="comment import">
                                <Code depth={0}>
                                    {importComment(res.importing)}
                                </Code>
                            </PlainRow>
                        )}
                        <Items
                            ctx={ctx}
                            res={res}
                            items={res.display}
                            depth={0}
                            inList={false}
                        />
                        {hiddenComments(res.hidden).map((c) => (
                            <PlainRow cls="comment">
                                <Code depth={0}>{c}</Code>
                            </PlainRow>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const Counts: FC<{ resources: ViewResource[] }> = ({ resources }) => {
    const count = (b: string) => resources.filter((r) => r.badge === b).length;
    const parts: [string, string, number][] = [
        ["c-add", "+", count("+")],
        ["c-chg", "~", count("~")],
        ["c-del", "-", count("-")],
        ["c-rep", "-/+", count("-/+")],
        ["c-imp", "import ", count("import")],
        ["c-imp", "moved ", count("moved")],
    ];
    return (
        <span class="counts">
            {parts
                .filter(([, , n]) => n > 0)
                .map(([cls, sign, n]) => (
                    <span class={cls}>
                        {sign}
                        {n}
                    </span>
                ))}
        </span>
    );
};

const ModuleView: FC<{ ctx: Ctx; mod: ViewModule }> = ({ ctx, mod }) => {
    const node = nodeOf(ctx.model, mod.id);
    return (
        <section class={nodeClass(ctx, node, "module")} data-id={mod.id}>
            <NodeHead ctx={ctx} node={node} foldable={true} label={mod.address}>
                <span class="name">{mod.address}</span>
                <Counts resources={mod.resources} />
            </NodeHead>
            <div class="children">
                {mod.resources.map((res) => (
                    <ResourceView ctx={ctx} res={res} />
                ))}
            </div>
        </section>
    );
};

// ---------------------------------------------------------------------------
// App

const App: FC<{
    data: ViewData;
    initial: ReturnType<typeof restore>;
}> = ({ data, initial }) => {
    const stateKey = `tfview:${data.projectId}`;
    // Not saved: every list starts out matched by position, and the viewer switches the ones it wants to read in another order.
    const [views, setViews] = useState<Views>(new Map());
    const model = useMemo(() => buildModel(data, views), [views]);
    const [state, setState] = useState<ReviewState>(initial.state);
    // Handlers read the latest state from here: several events can arrive before the next render.
    const [latest] = useState(() => ({ state: initial.state }));
    const current = () => latest.state;
    const [carried, setCarried] = useState(initial.carried);
    const [storageOk, setStorageOk] = useState(storageAvailable());
    const [flash, setFlash] = useState<string | null>(null);
    const bar = useRef<HTMLElement>(null);

    // Module and resource headers stick right below the top bar, whose height changes
    // with the window width and with the notices shown in it.
    useLayoutEffect(() => {
        const el = bar.current;
        if (!el) return;
        const update = () =>
            document.documentElement.style.setProperty(
                "--bar-height",
                `${el.offsetHeight}px`,
            );
        update();
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // Saved synchronously on every change (not in an effect), so closing the tab right after a click loses nothing.
    const commit = (next: ReviewState) => {
        latest.state = next;
        setState(next);
        if (!writeJson(stateKey, toSaved(next)))
            setStorageOk(storageAvailable());
    };
    // Writes back the cleaned-up state on load (keys not in this plan are dropped).
    useEffect(() => {
        if (!writeJson(stateKey, toSaved(initial.state)))
            setStorageOk(storageAvailable());
    }, []);
    useEffect(() => {
        if (flash === null) return;
        const t = setTimeout(() => setFlash(null), 4000);
        return () => clearTimeout(t);
    }, [flash]);

    const ctx: Ctx = {
        model,
        state,
        carried,
        updated: initial.updated,
        showSensitive: data.showSensitive === true,
        views,
        onView: (resourceId, path, optionId) => {
            const next = new Map(views);
            if (optionId === "") next.delete(viewKey(resourceId, path));
            else next.set(viewKey(resourceId, path), optionId);
            setViews(next);
        },
        onToggle: (node) => {
            commit(toggleNode(model, current(), node));
            keepInView(node);
        },
        onFold: (node) => {
            commit(toggleCollapsed(current(), node.id));
            keepInView(node);
        },
    };

    const onReset = () => {
        if (!confirm(t.confirmReset)) return;
        commit(reset(current()));
        setCarried(new Set());
        setFlash(t.flashReset);
    };

    const { lines, resources, modules } = progress(model, state);
    const meta = [
        data.source,
        data.terraformVersion && `Terraform ${data.terraformVersion}`,
        t.resources(data.modules.reduce((n, m) => n + m.resources.length, 0)),
        t.generatedAt(new Date(data.generatedAt).toLocaleString(locale)),
    ].filter(Boolean);
    const notice = flash ?? (storageOk ? "" : t.storageUnavailable);

    return (
        <>
            <header class="bar" ref={bar}>
                <div class="bar-row">
                    <span class="brand">tfview</span>
                    <span class="meta">{meta.join(" · ")}</span>
                    <span class="spacer" />
                    <div class="progress">
                        <span id="progress-text">
                            {t.linesViewed(lines.done, lines.total)}
                        </span>
                        <span class="progress-sub">
                            {t.resourceProgress(
                                resources.done,
                                resources.total,
                            )}{" "}
                            · {t.moduleProgress(modules.done, modules.total)}
                        </span>
                        <div class="progress-bar">
                            <div
                                class="progress-fill"
                                style={`width:${lines.total === 0 ? 100 : (lines.done / lines.total) * 100}%`}
                            />
                        </div>
                    </div>
                    <div class="actions">
                        <button
                            type="button"
                            title={t.resetHint}
                            onClick={onReset}
                        >
                            {t.reset}
                        </button>
                        <select
                            class="lang-select"
                            aria-label={t.language}
                            title={t.language}
                            value={locale}
                            onChange={(e) => {
                                const next = (e.target as HTMLSelectElement)
                                    .value;
                                if (isLocale(next)) switchLocale(next);
                            }}
                        >
                            {(Object.keys(localeNames) as Locale[]).map((l) => (
                                <option value={l}>{localeNames[l]}</option>
                            ))}
                        </select>
                    </div>
                </div>
                {data.showSensitive && (
                    <div class="warn">{t.sensitiveWarning}</div>
                )}
                {(carried.size > 0 || initial.updated.size > 0) && (
                    <div class="carry" id="carry">
                        {carried.size > 0 && (
                            <span>{t.carriedNotice(carried.size)}</span>
                        )}
                        {initial.updated.size > 0 && (
                            <span class="tag tag-updated">
                                {t.updatedNotice(initial.updated.size)}
                            </span>
                        )}
                    </div>
                )}
                <div class="notice" id="notice" role="status">
                    {notice}
                </div>
            </header>
            <main id="tree">
                {data.modules.length === 0 ? (
                    <div class="empty">{t.noChanges}</div>
                ) : (
                    data.modules.map((mod) => (
                        <ModuleView ctx={ctx} mod={mod} />
                    ))
                )}
            </main>
        </>
    );
};

/** Height of a sticky header layer, from the CSS custom property that positions it. */
function cssPixels(name: string): number {
    return (
        Number.parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(name),
        ) || 0
    );
}

/**
 * After a check or fold from a sticky header, the node may have shrunk so its
 * header is now above the viewport. Scroll it back to just below the sticky layers.
 */
function keepInView(node: TreeNode): void {
    const target = node.level === 2 ? node.parent : node;
    if (!target) return;
    // Wait for the re-render, then for layout.
    setTimeout(() =>
        requestAnimationFrame(() => {
            const el = document.querySelector(
                `[data-id="${CSS.escape(target.id)}"]`,
            );
            if (!el) return;
            const offset =
                cssPixels("--bar-height") +
                (target.level === 1 ? cssPixels("--module-head-height") : 0);
            const top = el.getBoundingClientRect().top;
            if (top < offset) window.scrollBy({ top: top - offset });
        }),
    );
}

/** An element the page is built with (see document.tsx). */
function requireElement(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (el === null) throw new Error(`#${id} is missing`);
    return el;
}

const data = JSON.parse(
    requireElement("tfview-data").textContent ?? "",
) as ViewData;
const initialModel = buildModel(data);
const saved = parseSaved(readJson(`tfview:${data.projectId}`)) ?? {
    version: 1,
    confirmed: [],
    slots: [],
};
render(
    <App data={data} initial={restore(initialModel, saved)} />,
    requireElement("app"),
);
