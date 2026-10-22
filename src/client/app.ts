// Browser side of tfview. Compiled by tsc and inlined into template.html as a module script.
import type { DisplayItem, Hidden, LineOp, SavedState, ViewData, ViewLine, ViewModule, ViewResource } from "../types.ts";

type Granularity = "module" | "resource" | "line";
type Level = 0 | 1 | 2;

const LEVEL: Record<Granularity, Level> = { module: 0, resource: 1, line: 2 };
const UNIT_LABEL: Record<Granularity, string> = { module: "module", resource: "resource", line: "line" };
const CLIP_LENGTH = 120;

interface TreeNode {
  id: string;
  level: Level;
  /** Confirmation units below this node: lineKeys, or the resourceKey of a resource without lines. */
  units: string[];
  parent: TreeNode | undefined;
  children: TreeNode[];
  el: HTMLElement;
  checkbox: HTMLInputElement;
  status?: HTMLElement;
  carriedTag?: HTMLElement;
  updatedTag?: HTMLElement;
}

// ---------------------------------------------------------------------------
// Data and storage

const data = JSON.parse(document.getElementById("tfview-data")!.textContent!) as ViewData;
const STATE_KEY = `tfview:${data.projectId}`;
const PREFS_KEY = "tfview:prefs";

let storageOk = probeStorage();

function probeStorage(): boolean {
  try {
    const k = "tfview:probe";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function readStorage(key: string): string | null {
  if (!storageOk) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    storageOk = false;
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  if (!storageOk) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    storageOk = false;
    showStorageNotice();
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Accepts the current format and a bare array of keys. */
function parseSaved(value: unknown): SavedState | null {
  if (isStringArray(value)) return { version: 1, confirmed: value, slots: [] };
  if (value && typeof value === "object") {
    const v = value as Partial<SavedState>;
    if (isStringArray(v.confirmed)) {
      return { version: 1, confirmed: v.confirmed, slots: isStringArray(v.slots) ? v.slots : [] };
    }
  }
  return null;
}

function loadSaved(): SavedState {
  const text = readStorage(STATE_KEY);
  if (text) {
    try {
      const parsed = parseSaved(JSON.parse(text));
      if (parsed) return parsed;
    } catch {
      // Corrupt entry: start over.
    }
  }
  return { version: 1, confirmed: [], slots: [] };
}

// ---------------------------------------------------------------------------
// State

/** unit key -> slot key */
const unitSlot = new Map<string, string>();
for (const mod of data.modules) {
  for (const res of mod.resources) {
    if (res.lines.length === 0) unitSlot.set(res.resourceKey, res.slot);
    for (const line of res.lines) unitSlot.set(line.key, line.slot);
  }
}
const currentSlots = new Set(unitSlot.values());

const saved = loadSaved();
const savedSlots = new Set(saved.slots);
/** Confirmed units. Keys that are not in this plan are dropped (old-key cleanup). */
const confirmed = new Set(saved.confirmed.filter((k) => unitSlot.has(k)));
/** Units that were already confirmed when the page loaded (carried over from the previous plan). */
const carried = new Set(confirmed);
/** Units whose slot was confirmed before, but whose content changed since. */
const updated = new Set([...unitSlot].filter(([k, s]) => savedSlots.has(s) && !confirmed.has(k)).map(([k]) => k));
/** Slots of confirmed units (plus changed slots still waiting for re-confirmation). */
const slots = new Set([...savedSlots].filter((s) => currentSlots.has(s)));
for (const k of confirmed) slots.add(unitSlot.get(k)!);

const collapsed = new Set<string>();
let granularity: Granularity = loadGranularity();

function loadGranularity(): Granularity {
  try {
    const g = (JSON.parse(readStorage(PREFS_KEY) ?? "{}") as { granularity?: string }).granularity;
    if (g === "module" || g === "resource" || g === "line") return g;
  } catch {
    // ignore
  }
  return "resource";
}

function persist(): void {
  const state: SavedState = { version: 1, confirmed: [...confirmed], slots: [...slots] };
  writeStorage(STATE_KEY, JSON.stringify(state));
}

function setUnit(key: string, on: boolean): void {
  const slot = unitSlot.get(key)!;
  if (on) {
    confirmed.add(key);
    slots.add(slot);
  } else {
    confirmed.delete(key);
    slots.delete(slot);
  }
}

// ---------------------------------------------------------------------------
// DOM construction

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const nodes = new Map<string, TreeNode>();
const allNodes: TreeNode[] = [];

function register(node: TreeNode): TreeNode {
  nodes.set(node.id, node);
  allNodes.push(node);
  node.el.dataset.id = node.id;
  node.checkbox.dataset.id = node.id;
  return node;
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

function valueEl(text: string | undefined): HTMLElement {
  const s = text ?? "null";
  const firstBreak = s.indexOf("\n");
  if (s.length <= CLIP_LENGTH && firstBreak === -1) return h("span", { class: "val" }, s);
  // For heredocs, preview the first line of the content rather than just `<<EOT`.
  const preview = s.startsWith("<<EOT\n") ? `<<EOT ${s.split("\n", 2)[1]}` : s;
  const previewBreak = preview.indexOf("\n");
  const short = `${preview.slice(0, Math.min(CLIP_LENGTH, previewBreak === -1 ? preview.length : previewBreak))} …`;
  const el = h("span", { class: "val clip", title: "クリックで全体を表示" }, short);
  el.dataset.full = s;
  el.dataset.short = short;
  return el;
}

function sideEl(line: ViewLine, side: "before" | "after"): HTMLElement {
  if (side === "after" && line.unknown) return h("span", { class: "val-unknown" }, "(known after apply)");
  // Values of sensitive lines are only present when generated with --show-sensitive.
  if (line.sensitive && line[side] === undefined) return h("span", { class: "val-sensitive" }, "(sensitive)");
  return valueEl(line[side]);
}

const OP_CLASS: Record<LineOp, string> = { "+": "l-add", "-": "l-del", "~": "l-chg" };

const ACTION_TEXT: Record<string, string> = {
  create: "will be created",
  delete: "will be destroyed",
  update: "will be updated in-place",
  "delete,create": "must be replaced",
  "create,delete": "must be replaced (create before destroy)",
  forget: "will be removed from state",
};

/** Read-only rows (group braces) that dim once every line inside them is confirmed. */
const groupRows: { el: HTMLElement; units: string[] }[] = [];

function codeEl(depth: number, ...children: Child[]): HTMLElement {
  const el = h("span", { class: "code" }, ...children);
  el.style.setProperty("--d", String(depth));
  return el;
}

/** `label = ` with the label padded so that `=` lines up within a block, as in `terraform plan`. */
function assignEl(label: string | undefined, width: number): Child[] {
  if (label === undefined) return [];
  return [h("span", { class: "path" }, label.padEnd(width)), h("span", { class: "eq" }, " = ")];
}

function plainRow(cls: string, sign: string, code: HTMLElement): HTMLElement {
  return h("div", { class: `row ${cls}` }, h("span", { class: "cb cb-space" }), h("span", { class: "sign" }, sign), code);
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

function buildLine(line: ViewLine, parent: TreeNode, label: string | undefined, width: number, depth: number, inList: boolean): TreeNode {
  const checkbox = h("input", { type: "checkbox", class: "cb", "aria-label": `${line.path} を確認済みにする` });
  const value: Child[] =
    line.op === "+"
      ? [sideEl(line, "after")]
      : line.op === "-"
        ? [sideEl(line, "before")]
        : [sideEl(line, "before"), h("span", { class: "arrow" }, " -> "), sideEl(line, "after")];
  const code = codeEl(
    depth,
    ...assignEl(label, width),
    ...value,
    inList && h("span", { class: "punct" }, ","),
    line.forcesReplacement && h("span", { class: "tag tag-force" }, "forces replacement"),
    line.sensitive && data.showSensitive && h("span", { class: "tag tag-sensitive" }, "sensitive"),
    updated.has(line.key) && h("span", { class: "tag tag-updated", "data-updated": line.key }, "更新あり"),
  );
  const el = h("div", { class: `row line ${OP_CLASS[line.op]}`, title: line.path }, checkbox, h("span", { class: "sign" }, line.op), code);
  return register({ id: `l:${line.key}`, level: 2, units: [line.key], parent, children: [], el, checkbox });
}

/** Renders display items into `out`; returns the line keys inside them. */
function renderItems(items: DisplayItem[], res: ViewResource, node: TreeNode, out: HTMLElement, depth: number, inList: boolean): string[] {
  const width = Math.max(0, ...items.map((it) => (it.t === "group" && it.style === "block" ? 0 : (it.label?.length ?? 0))));
  const units: string[] = [];
  for (const it of items) {
    if (it.t === "line") {
      const line = res.lines[it.i]!;
      const child = buildLine(line, node, it.label, width, depth, inList);
      node.children.push(child);
      out.append(child.el);
      units.push(line.key);
    } else if (it.t === "ctx") {
      out.append(plainRow("ctx", "", codeEl(depth, ...assignEl(it.label, width), valueEl(it.value))));
    } else {
      const opener: Child[] =
        it.style === "block"
          ? [h("span", { class: "path" }, it.label ?? ""), " {"]
          : [...assignEl(it.label, width), it.style === "list" ? "[" : "{"];
      const open = plainRow(`grp ${OP_CLASS[it.op]}`, it.op, codeEl(depth, ...opener));
      out.append(open);
      const inner = renderItems(it.items, res, node, out, depth + 1, it.style === "list");
      for (const c of hiddenComments(it.hidden)) out.append(plainRow("comment", "", codeEl(depth + 1, c)));
      const close = plainRow("grp-close", "", codeEl(depth, it.style === "list" ? "]" : "}", inList ? "," : ""));
      out.append(close);
      groupRows.push({ el: open, units: inner }, { el: close, units: inner });
      units.push(...inner);
    }
  }
  return units;
}

function buildHead(node: Omit<TreeNode, "el">, hasChildren: boolean, ...middle: Child[]): HTMLElement {
  node.status = h("span", { class: "status" });
  node.carriedTag = h("span", { class: "tag tag-carried" });
  node.updatedTag = h("span", { class: "tag tag-updated" });
  return h(
    "div",
    { class: "head" },
    h("button", { type: "button", class: `caret${hasChildren ? "" : " hidden"}`, "aria-label": "開閉", tabindex: hasChildren ? "0" : "-1" }, "›"),
    node.checkbox,
    ...middle,
    h("span", { class: "spacer" }),
    node.updatedTag,
    node.carriedTag,
    node.status,
  );
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

function buildResource(res: ViewResource, parent: TreeNode): TreeNode {
  const checkbox = h("input", { type: "checkbox", "aria-label": `${res.address} を確認済みにする` });
  const units = res.lines.length > 0 ? res.lines.map((l) => l.key) : [res.resourceKey];
  const partial: Omit<TreeNode, "el"> = { id: res.id, level: 1, units, parent, children: [], checkbox };
  const hasBody = res.lines.length > 0 || res.importing !== undefined;
  const head = buildHead(
    partial,
    hasBody,
    h("span", { class: `badge ${opClass(res.badge)}`, title: res.actions.join(", ") }, res.badge),
    res.importing !== undefined && res.badge !== "import" && h("span", { class: "tag tag-import", title: res.importing }, "import"),
    h("span", { class: "name" }, res.address),
    h("span", { class: "action" }, actionText(res)),
  );
  const el = h("div", { class: "resource node" }, head);
  const node = register({ ...partial, el });
  if (hasBody) {
    const lines = h("div", { class: "lines" });
    if (res.importing !== undefined) lines.append(plainRow("comment import", "", codeEl(0, importComment(res.importing))));
    renderItems(res.display, res, node, lines, 0, false);
    for (const c of hiddenComments(res.hidden)) lines.append(plainRow("comment", "", codeEl(0, c)));
    el.append(h("div", { class: "children" }, lines));
  }
  return node;
}

function countsEl(resources: ViewResource[]): HTMLElement {
  const count = (b: string) => resources.filter((r) => r.badge === b).length;
  const parts: [string, string, number][] = [
    ["c-add", "+", count("+")],
    ["c-chg", "~", count("~")],
    ["c-del", "-", count("-")],
    ["c-rep", "-/+", count("-/+")],
    ["c-imp", "import ", count("import")],
  ];
  return h("span", { class: "counts" }, ...parts.filter(([, , n]) => n > 0).map(([cls, sign, n]) => h("span", { class: cls }, `${sign}${n}`)));
}

function buildModule(mod: ViewModule): TreeNode {
  const checkbox = h("input", { type: "checkbox", "aria-label": `${mod.address} を確認済みにする` });
  const partial: Omit<TreeNode, "el"> = { id: mod.id, level: 0, units: [], parent: undefined, children: [], checkbox };
  const head = buildHead(partial, true, h("span", { class: "name" }, mod.address), countsEl(mod.resources));
  const children = h("div", { class: "children" });
  const el = h("section", { class: "module node" }, head, children);
  const node = register({ ...partial, el });
  for (const res of mod.resources) {
    const child = buildResource(res, node);
    node.children.push(child);
    node.units.push(...child.units);
    children.append(child.el);
  }
  return node;
}

const treeEl = document.getElementById("tree")!;
const modules = data.modules.map(buildModule);
if (modules.length === 0) treeEl.append(h("div", { class: "empty" }, "変更はありません"));
else treeEl.append(...modules.map((m) => m.el));

// ---------------------------------------------------------------------------
// Behaviour

function confirmedCount(node: TreeNode): number {
  let n = 0;
  for (const k of node.units) if (confirmed.has(k)) n++;
  return n;
}

function isDone(node: TreeNode): boolean {
  return node.units.every((k) => confirmed.has(k));
}

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
function toggleNode(node: TreeNode): void {
  const target = !isDone(node);
  for (const k of node.units) setUnit(k, target);
  forEachBranch(node, (n) => (target ? collapsed.add(n.id) : collapsed.delete(n.id)));
  for (let a = node.parent; a; a = a.parent) {
    if (isDone(a)) collapsed.add(a.id);
    else collapsed.delete(a.id);
  }
  persist();
  render();
}

function toggleCollapsed(node: TreeNode): void {
  if (collapsed.has(node.id)) collapsed.delete(node.id);
  else collapsed.add(node.id);
  render();
}

function collapseDone(): void {
  for (const n of allNodes) if (n.level < 2 && isDone(n)) collapsed.add(n.id);
}

function setGranularity(g: Granularity): void {
  granularity = g;
  // Folding below the chosen level is released.
  for (const n of allNodes) if (n.level > LEVEL[g]) collapsed.delete(n.id);
  writeStorage(PREFS_KEY, JSON.stringify({ granularity: g }));
  render();
}

// ---------------------------------------------------------------------------
// Rendering (DOM is built once; this only updates states)

const progressText = document.getElementById("progress-text")!;
const progressFill = document.getElementById("progress-fill")!;
const segButtons = [...document.querySelectorAll<HTMLButtonElement>("#granularity button")];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function render(): void {
  const maxLevel = LEVEL[granularity];
  for (const n of allNodes) {
    const total = n.units.length;
    const done = confirmedCount(n);
    const all = done === total;
    n.el.classList.toggle("done", all);
    n.checkbox.checked = all;
    n.checkbox.indeterminate = done > 0 && !all;
    n.checkbox.classList.toggle("cb-off", n.level > maxLevel);
    if (n.level === 2) continue;

    n.el.classList.toggle("collapsed", collapsed.has(n.id));
    const lineCount = n.children.length === 0 && n.level === 1 ? 0 : total;
    n.status!.textContent =
      lineCount === 0
        ? all ? "確認済み · 属性の変更なし" : "属性の変更なし"
        : all ? `確認済み · ${plural(lineCount, "line")}` : done > 0 ? `${done} / ${plural(lineCount, "line")}` : plural(lineCount, "line");

    let carriedN = 0;
    let updatedN = 0;
    for (const k of n.units) {
      if (carried.has(k) && confirmed.has(k)) carriedN++;
      if (updated.has(k) && !confirmed.has(k)) updatedN++;
    }
    n.carriedTag!.textContent = `前回確認済み ${carriedN} 行`;
    n.carriedTag!.hidden = carriedN === 0;
    n.updatedTag!.textContent = `更新あり ${updatedN}`;
    n.updatedTag!.hidden = updatedN === 0;
  }
  for (const g of groupRows) g.el.classList.toggle("done", g.units.every((k) => confirmed.has(k)));
  document.body.classList.toggle("g-line", granularity === "line");
  for (const tag of document.querySelectorAll<HTMLElement>("[data-updated]")) {
    tag.hidden = confirmed.has(tag.dataset.updated!);
  }

  const units = allNodes.filter((n) => (granularity === "line" ? n.level === 2 || (n.level === 1 && n.children.length === 0) : n.level === maxLevel));
  const doneUnits = units.filter(isDone).length;
  progressText.textContent = `${doneUnits} / ${units.length} ${UNIT_LABEL[granularity]} 確認済み`;
  progressFill.style.width = units.length === 0 ? "100%" : `${(doneUnits / units.length) * 100}%`;
  for (const b of segButtons) b.setAttribute("aria-checked", String(b.dataset.g === granularity));
}

// ---------------------------------------------------------------------------
// Header: meta, carry-over summary, notices

const noticeEl = document.getElementById("notice")!;
let flashTimer: number | undefined;

function storageNoticeText(): string {
  return storageOk ? "" : "状態を保存できません(このブラウザでは localStorage を使えません)。閉じる前にエクスポートしてください。";
}

function showStorageNotice(): void {
  noticeEl.textContent = storageNoticeText();
}

function flash(message: string): void {
  noticeEl.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(showStorageNotice, 4000);
}

{
  const resources = data.modules.flatMap((m) => m.resources);
  const generated = new Date(data.generatedAt);
  const meta = [
    data.source,
    data.terraformVersion && `Terraform ${data.terraformVersion}`,
    `${resources.length} resources`,
    `生成 ${generated.toLocaleString()}`,
  ].filter(Boolean);
  document.getElementById("meta")!.textContent = meta.join(" · ");

  if (data.showSensitive) {
    document.querySelector(".bar")!.append(
      h("div", { class: "warn" }, "この HTML には sensitive な値が平文で含まれています(--show-sensitive)。共有やコミットに注意してください。"),
    );
  }

  const carry = document.getElementById("carry")!;
  if (carried.size > 0) carry.append(h("span", {}, `前回確認済みで内容が同じ ${carried.size} 行を、確認済みとして畳んでいます`));
  if (updated.size > 0) carry.append(h("span", { class: "tag tag-updated" }, `前回から更新あり ${updated.size} 行`));
  showStorageNotice();
}

// ---------------------------------------------------------------------------
// Events

treeEl.addEventListener("change", (e) => {
  const target = e.target as HTMLElement;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  const node = nodes.get(target.dataset.id ?? "");
  if (node) toggleNode(node);
});

treeEl.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const clip = target.closest<HTMLElement>(".val.clip");
  if (clip) {
    const expanded = clip.classList.toggle("expanded");
    clip.textContent = expanded ? clip.dataset.full! : clip.dataset.short!;
    clip.title = expanded ? "クリックで折りたたむ" : "クリックで全体を表示";
    return;
  }
  if (target.closest("input")) return;
  const head = target.closest(".head");
  if (!head) return;
  // Clicking the caret or the header text folds/unfolds, unless the user is selecting text.
  if (!target.closest(".caret") && String(window.getSelection() ?? "") !== "") return;
  const node = nodes.get((head.parentElement as HTMLElement).dataset.id ?? "");
  if (node && node.el.querySelector(":scope > .children")) toggleCollapsed(node);
});

for (const b of segButtons) b.addEventListener("click", () => setGranularity(b.dataset.g as Granularity));

document.getElementById("btn-reset")!.addEventListener("click", () => {
  if (!confirm("確認済み状態をすべて消しますか?")) return;
  confirmed.clear();
  slots.clear();
  carried.clear();
  collapsed.clear();
  persist();
  render();
  flash("確認済み状態をリセットしました");
});

document.getElementById("btn-export")!.addEventListener("click", () => {
  const state: SavedState = { version: 1, confirmed: [...confirmed], slots: [...slots] };
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `tfview-state-${data.projectId}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  flash(`${confirmed.size} 件の確認済み状態を書き出しました`);
});

const fileInput = document.getElementById("file-import") as HTMLInputElement;
document.getElementById("btn-import")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (!file) return;
  let state: SavedState | null = null;
  try {
    state = parseSaved(JSON.parse(await file.text()));
  } catch {
    // handled below
  }
  if (!state) {
    flash(`${file.name}: tfview の状態ファイルとして読めません`);
    return;
  }
  // Merge: imported confirmations are added to the current ones.
  let added = 0;
  for (const k of state.confirmed) {
    if (unitSlot.has(k) && !confirmed.has(k)) {
      setUnit(k, true);
      added++;
    }
  }
  for (const s of state.slots) if (currentSlots.has(s)) slots.add(s);
  collapseDone();
  persist();
  render();
  flash(`${file.name} から ${added} 行を確認済みにしました(この plan に無いキーは無視)`);
});

// ---------------------------------------------------------------------------

persist(); // writes back the cleaned-up state (keys not in this plan are dropped)
collapseDone();
render();
