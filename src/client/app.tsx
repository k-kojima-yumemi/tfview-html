// Browser side of tfview. Bundled by Rolldown (build/plugins.ts) and inlined into template.html.
import type { Child } from "hono/jsx";
import { render, useEffect, useLayoutEffect, useRef, useState } from "hono/jsx/dom";
import type { DisplayItem, Hidden, LineOp, SavedState, ViewData, ViewLine, ViewModule, ViewResource } from "../types.ts";
import {
  buildModel,
  confirmedCount,
  importSaved,
  isDone,
  LEVEL,
  lineNodeId,
  parseSaved,
  progress,
  reset,
  restore,
  setGranularity,
  toggleCollapsed,
  toggleNode,
  toSaved,
  type Granularity,
  type Model,
  type ReviewState,
  type TreeNode,
} from "./state.ts";
import { readJson, storageAvailable, writeJson } from "./storage.ts";

const CLIP_LENGTH = 120;
const GRANULARITIES: Granularity[] = ["module", "resource", "line"];

const OP_CLASS: Record<LineOp, string> = { "+": "l-add", "-": "l-del", "~": "l-chg" };

const ACTION_TEXT: Record<string, string> = {
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
  onToggle: (node: TreeNode) => void;
  onFold: (node: TreeNode) => void;
}

// ---------------------------------------------------------------------------
// Small pieces

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
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
      return "op-imp";
    default:
      return "op-other";
  }
}

function Checkbox(props: { checked: boolean; indeterminate: boolean; class?: string; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM property only; there is no attribute for it.
  useLayoutEffect(() => {
    if (ref.current) ref.current.indeterminate = props.indeterminate;
  });
  return (
    <input
      ref={ref}
      type="checkbox"
      class={props.class}
      checked={props.checked}
      aria-label={props.label}
      onChange={props.onChange}
    />
  );
}

/** A value, clipped when long or multi-line; click to show it all. */
function Value({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const firstBreak = text.indexOf("\n");
  if (text.length <= CLIP_LENGTH && firstBreak === -1) return <span class="val">{text}</span>;
  // For heredocs, preview the first line of the content rather than just `<<EOT`.
  const preview = text.startsWith("<<EOT\n") ? `<<EOT ${text.split("\n", 2)[1]}` : text;
  const previewBreak = preview.indexOf("\n");
  const short = `${preview.slice(0, Math.min(CLIP_LENGTH, previewBreak === -1 ? preview.length : previewBreak))} …`;
  return (
    <span
      class={`val clip${expanded ? " expanded" : ""}`}
      title={expanded ? "クリックで折りたたむ" : "クリックで全体を表示"}
      onClick={() => setExpanded(!expanded)}
    >
      {expanded ? text : short}
    </span>
  );
}

function Side({ line, side }: { line: ViewLine; side: "before" | "after" }) {
  if (side === "after" && line.unknown) return <span class="val-unknown">(known after apply)</span>;
  // Values of sensitive lines are only present when generated with --show-sensitive.
  if (line.sensitive && line[side] === undefined) return <span class="val-sensitive">(sensitive)</span>;
  return <Value text={line[side] ?? "null"} />;
}

function Code({ depth, children }: { depth: number; children?: Child }) {
  return (
    <span class="code" style={`--d:${depth}`}>
      {children}
    </span>
  );
}

/** `label = ` with the label padded so that `=` lines up within a block, as in `terraform plan`. */
function Assign({ label, width }: { label: string | undefined; width: number }) {
  if (label === undefined) return null;
  return (
    <>
      <span class="path">{label.padEnd(width)}</span>
      <span class="eq"> = </span>
    </>
  );
}

/** A read-only row (braces, context, comments): a blank checkbox column keeps it aligned with lines. */
function PlainRow({ cls, sign, done, children }: { cls: string; sign?: string; done?: boolean; children?: Child }) {
  return (
    <div class={`row ${cls}${done ? " done" : ""}`}>
      <span class="cb cb-space" />
      <span class="sign">{sign ?? ""}</span>
      {children}
    </div>
  );
}

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

function lineKeysOf(items: DisplayItem[], res: ViewResource): string[] {
  return items.flatMap((it) => (it.t === "line" ? [res.lines[it.i]!.key] : it.t === "group" ? lineKeysOf(it.items, res) : []));
}

/** `# (imported from "id")`, as `terraform plan` prints it. An identity (Terraform 1.12+) is shown as JSON. */
function importComment(source: string): string {
  return `# (imported from ${source.startsWith("{") ? source : JSON.stringify(source)})`;
}

function actionText(res: ViewResource): string {
  const actions = res.actions.join(",");
  if (actions === "no-op" && res.importing !== undefined) return "will be imported";
  return ACTION_TEXT[actions] ?? res.actions.join(", ");
}

// ---------------------------------------------------------------------------
// Lines, laid out Terraform plan style

function LineRow(props: { ctx: Ctx; res: ViewResource; line: ViewLine; label: string | undefined; width: number; depth: number; inList: boolean }) {
  const { ctx, line } = props;
  const node = ctx.model.nodes.get(lineNodeId(line.key))!;
  const done = ctx.state.confirmed.has(line.key);
  return (
    <div class={`row line ${OP_CLASS[line.op]}${done ? " done" : ""}`} title={line.path} data-id={node.id}>
      <Checkbox class="cb" checked={done} indeterminate={false} label={`${line.path} を確認済みにする`} onChange={() => ctx.onToggle(node)} />
      <span class="sign">{line.op}</span>
      <Code depth={props.depth}>
        <Assign label={props.label} width={props.width} />
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
        {props.inList && <span class="punct">,</span>}
        {line.forcesReplacement && <span class="tag tag-force">forces replacement</span>}
        {line.sensitive && ctx.showSensitive && <span class="tag tag-sensitive">sensitive</span>}
        {ctx.updated.has(line.key) && !done && <span class="tag tag-updated">更新あり</span>}
      </Code>
    </div>
  );
}

function Items(props: { ctx: Ctx; res: ViewResource; items: DisplayItem[]; depth: number; inList: boolean }) {
  const { ctx, res, items, depth, inList } = props;
  const width = Math.max(0, ...items.map((it) => (it.t === "group" && it.style === "block" ? 0 : (it.label?.length ?? 0))));
  return (
    <>
      {items.map((it) => {
        if (it.t === "line") {
          return <LineRow ctx={ctx} res={res} line={res.lines[it.i]!} label={it.label} width={width} depth={depth} inList={inList} />;
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
        const done = lineKeysOf(it.items, res).every((k) => ctx.state.confirmed.has(k));
        return (
          <>
            <PlainRow cls={`grp ${OP_CLASS[it.op]}`} sign={it.op} done={done}>
              <Code depth={depth}>
                {it.style === "block" ? (
                  <>
                    <span class="path">{it.label ?? ""}</span> {"{"}
                  </>
                ) : (
                  <>
                    <Assign label={it.label} width={width} />
                    {it.style === "list" ? "[" : "{"}
                  </>
                )}
              </Code>
            </PlainRow>
            <Items ctx={ctx} res={res} items={it.items} depth={depth + 1} inList={it.style === "list"} />
            {hiddenComments(it.hidden).map((c) => (
              <PlainRow cls="comment">
                <Code depth={depth + 1}>{c}</Code>
              </PlainRow>
            ))}
            <PlainRow cls="grp-close" done={done}>
              <Code depth={depth}>
                {it.style === "list" ? "]" : "}"}
                {inList ? "," : ""}
              </Code>
            </PlainRow>
          </>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modules and resources

function NodeHead(props: { ctx: Ctx; node: TreeNode; foldable: boolean; label: string; children?: Child }) {
  const { ctx, node } = props;
  const { state } = ctx;
  const total = node.units.length;
  const done = confirmedCount(state, node);
  const all = done === total;
  const lineCount = node.level === 1 && node.children.length === 0 ? 0 : total;
  const status =
    lineCount === 0
      ? all ? "確認済み · 属性の変更なし" : "属性の変更なし"
      : all ? `確認済み · ${plural(lineCount, "line")}` : done > 0 ? `${done} / ${plural(lineCount, "line")}` : plural(lineCount, "line");
  let carriedN = 0;
  let updatedN = 0;
  for (const k of node.units) {
    if (ctx.carried.has(k) && state.confirmed.has(k)) carriedN++;
    if (ctx.updated.has(k) && !state.confirmed.has(k)) updatedN++;
  }

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("input") || !props.foldable) return;
    // Clicking the caret or the header text folds/unfolds, unless the user is selecting text.
    if (!target.closest(".caret") && String(window.getSelection() ?? "") !== "") return;
    ctx.onFold(node);
  };

  return (
    <div class="head" onClick={onClick}>
      <button type="button" class={`caret${props.foldable ? "" : " hidden"}`} aria-label="開閉" tabindex={props.foldable ? 0 : -1}>
        ›
      </button>
      <Checkbox
        class={node.level > LEVEL[state.granularity] ? "cb-off" : undefined}
        checked={all}
        indeterminate={done > 0 && !all}
        label={`${props.label} を確認済みにする`}
        onChange={() => ctx.onToggle(node)}
      />
      {props.children}
      <span class="spacer" />
      {updatedN > 0 && <span class="tag tag-updated">更新あり {updatedN}</span>}
      {carriedN > 0 && <span class="tag tag-carried">前回確認済み {carriedN} 行</span>}
      <span class="status">{status}</span>
    </div>
  );
}

function nodeClass(ctx: Ctx, node: TreeNode, base: string): string {
  return `${base} node${isDone(ctx.state, node) ? " done" : ""}${ctx.state.collapsed.has(node.id) ? " collapsed" : ""}`;
}

function ResourceView({ ctx, res }: { ctx: Ctx; res: ViewResource }) {
  const node = ctx.model.nodes.get(res.id)!;
  const hasBody = res.lines.length > 0 || res.importing !== undefined;
  return (
    <div class={nodeClass(ctx, node, "resource")} data-id={res.id}>
      <NodeHead ctx={ctx} node={node} foldable={hasBody} label={res.address}>
        <span class={`badge ${opClass(res.badge)}`} title={res.actions.join(", ")}>
          {res.badge}
        </span>
        {res.importing !== undefined && res.badge !== "import" && (
          <span class="tag tag-import" title={res.importing}>
            import
          </span>
        )}
        <span class="name">{res.address}</span>
        <span class="action">{actionText(res)}</span>
      </NodeHead>
      {hasBody && (
        <div class="children">
          <div class="lines">
            {res.importing !== undefined && (
              <PlainRow cls="comment import">
                <Code depth={0}>{importComment(res.importing)}</Code>
              </PlainRow>
            )}
            <Items ctx={ctx} res={res} items={res.display} depth={0} inList={false} />
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
}

function Counts({ resources }: { resources: ViewResource[] }) {
  const count = (b: string) => resources.filter((r) => r.badge === b).length;
  const parts: [string, string, number][] = [
    ["c-add", "+", count("+")],
    ["c-chg", "~", count("~")],
    ["c-del", "-", count("-")],
    ["c-rep", "-/+", count("-/+")],
    ["c-imp", "import ", count("import")],
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
}

function ModuleView({ ctx, mod }: { ctx: Ctx; mod: ViewModule }) {
  const node = ctx.model.nodes.get(mod.id)!;
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
}

// ---------------------------------------------------------------------------
// App

const PREFS_KEY = "tfview:prefs";

function loadGranularity(): Granularity {
  const g = (readJson(PREFS_KEY) as { granularity?: unknown } | undefined)?.granularity;
  return GRANULARITIES.includes(g as Granularity) ? (g as Granularity) : "resource";
}

function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function App({ data, model, initial }: { data: ViewData; model: Model; initial: ReturnType<typeof restore> }) {
  const stateKey = `tfview:${data.projectId}`;
  const [state, setState] = useState<ReviewState>(initial.state);
  // Handlers read the latest state from here: several events can arrive before the next render.
  const latest = useRef<ReviewState>(initial.state);
  const current = () => latest.current!;
  const [carried, setCarried] = useState(initial.carried);
  const [storageOk, setStorageOk] = useState(storageAvailable());
  const [flash, setFlash] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Saved synchronously on every change (not in an effect), so closing the tab right after a click loses nothing.
  const commit = (next: ReviewState) => {
    const prev = current();
    latest.current = next;
    setState(next);
    if (!writeJson(stateKey, toSaved(next))) setStorageOk(storageAvailable());
    if (next.granularity !== prev.granularity) writeJson(PREFS_KEY, { granularity: next.granularity });
  };
  // Writes back the cleaned-up state on load (keys not in this plan are dropped).
  useEffect(() => {
    if (!writeJson(stateKey, toSaved(initial.state))) setStorageOk(storageAvailable());
  }, []);
  useEffect(() => {
    document.body.classList.toggle("g-line", state.granularity === "line");
  }, [state.granularity]);
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
    onToggle: (node) => commit(toggleNode(model, current(), node)),
    onFold: (node) => commit(toggleCollapsed(current(), node.id)),
  };

  const onReset = () => {
    if (!confirm("確認済み状態をすべて消しますか?")) return;
    commit(reset(current()));
    setCarried(new Set());
    setFlash("確認済み状態をリセットしました");
  };
  const onExport = () => {
    downloadJson(`tfview-state-${data.projectId}.json`, toSaved(current()));
    setFlash(`${current().confirmed.size} 件の確認済み状態を書き出しました`);
  };
  const onImportFile = async () => {
    const input = fileInput.current;
    const file = input?.files?.[0];
    if (!input || !file) return;
    input.value = "";
    let saved: SavedState | null = null;
    try {
      saved = parseSaved(JSON.parse(await file.text()));
    } catch {
      // handled below
    }
    if (!saved) {
      setFlash(`${file.name}: tfview の状態ファイルとして読めません`);
      return;
    }
    const result = importSaved(model, current(), saved);
    commit(result.state);
    setFlash(`${file.name} から ${result.added} 行を確認済みにしました(この plan に無いキーは無視)`);
  };

  const { done, total } = progress(model, state);
  const meta = [
    data.source,
    data.terraformVersion && `Terraform ${data.terraformVersion}`,
    `${data.modules.reduce((n, m) => n + m.resources.length, 0)} resources`,
    `生成 ${new Date(data.generatedAt).toLocaleString()}`,
  ].filter(Boolean);
  const notice = flash ?? (storageOk ? "" : "状態を保存できません(このブラウザでは localStorage を使えません)。閉じる前にエクスポートしてください。");

  return (
    <>
      <header class="bar">
        <div class="bar-row">
          <span class="brand">tfview</span>
          <span class="meta">{meta.join(" · ")}</span>
          <span class="spacer" />
          <div class="seg" role="radiogroup" aria-label="確認の粒度">
            {GRANULARITIES.map((g) => (
              <button type="button" role="radio" data-g={g} aria-checked={String(state.granularity === g)} onClick={() => commit(setGranularity(model, current(), g))}>
                {g}
              </button>
            ))}
          </div>
          <div class="progress">
            <span id="progress-text">
              {done} / {total} {state.granularity} 確認済み
            </span>
            <div class="progress-bar">
              <div class="progress-fill" style={`width:${total === 0 ? 100 : (done / total) * 100}%`} />
            </div>
          </div>
          <div class="actions">
            <button type="button" title="確認済み状態を JSON ファイルに書き出す" onClick={onExport}>
              エクスポート
            </button>
            <button type="button" title="JSON ファイルから確認済み状態を読み込む" onClick={() => fileInput.current?.click()}>
              インポート
            </button>
            <button type="button" title="確認済み状態をすべて消す" onClick={onReset}>
              リセット
            </button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={onImportFile} />
          </div>
        </div>
        {data.showSensitive && (
          <div class="warn">この HTML には sensitive な値が平文で含まれています(--show-sensitive)。共有やコミットに注意してください。</div>
        )}
        {(carried.size > 0 || initial.updated.size > 0) && (
          <div class="carry" id="carry">
            {carried.size > 0 && <span>前回確認済みで内容が同じ {carried.size} 行を、確認済みとして畳んでいます</span>}
            {initial.updated.size > 0 && <span class="tag tag-updated">前回から更新あり {initial.updated.size} 行</span>}
          </div>
        )}
        <div class="notice" id="notice" role="status">
          {notice}
        </div>
      </header>
      <main id="tree">
        {data.modules.length === 0 ? (
          <div class="empty">変更はありません</div>
        ) : (
          data.modules.map((mod) => <ModuleView ctx={ctx} mod={mod} />)
        )}
      </main>
    </>
  );
}

const data = JSON.parse(document.getElementById("tfview-data")!.textContent!) as ViewData;
const model = buildModel(data);
const saved = parseSaved(readJson(`tfview:${data.projectId}`)) ?? { version: 1, confirmed: [], slots: [] };
render(<App data={data} model={model} initial={restore(model, saved, loadGranularity())} />, document.getElementById("app")!);
