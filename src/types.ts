// Shapes shared by the generator (Node) and the viewer (browser).

/** `+` create, `-` delete, `~` update (both sides present). */
export type LineOp = "+" | "-" | "~";

/** `+`, `-`, `~`, `-/+`, `import` (import only), or the raw actions for anything else (e.g. `forget`). */
export type Badge = string;

export interface ViewLine {
  /** lineKey: identifies this exact change (address, path, before, after). */
  key: string;
  /** slotKey: identifies the attribute slot (address, path) regardless of values. */
  slot: string;
  path: string;
  op: LineOp;
  /**
   * Display values. Omitted for the missing side of `+` / `-`, and for
   * sensitive leaves unless the HTML was generated with `--show-sensitive`.
   */
  before?: string;
  after?: string;
  unknown?: true;
  sensitive?: true;
  forcesReplacement?: true;
}

/** Counts of unchanged things folded into a `# (N unchanged ... hidden)` comment. */
export interface Hidden {
  attributes?: number;
  blocks?: number;
  elements?: number;
}

/**
 * How the lines of a resource are laid out, Terraform plan style. Only `line`
 * items are confirmable; groups and context rows are for reading.
 */
export type DisplayItem =
  /** A changed leaf: `lines[i]`. `label` is omitted for list elements. */
  | { t: "line"; i: number; label?: string }
  /** An unchanged attribute shown for orientation (`id`, `name`). */
  | { t: "ctx"; label: string; value: string }
  /**
   * A container with changes inside. `map` renders as `label = { ... }`,
   * `list` as `label = [ ... ]`, `block` (an element of a list of objects) as
   * `label { ... }`. `label` is omitted for containers inside a list.
   */
  | { t: "group"; op: LineOp; style: "map" | "list" | "block"; label?: string; items: DisplayItem[]; hidden?: Hidden };

export interface ViewResource {
  id: string;
  address: string;
  actions: string[];
  badge: Badge;
  /** Used as the confirmation unit when the resource has no lines. */
  resourceKey: string;
  slot: string;
  lines: ViewLine[];
  display: DisplayItem[];
  /** Import ID (or identity JSON) when the resource is imported by an `import` block. */
  importing?: string;
  hidden?: Hidden;
}

export interface ViewModule {
  id: string;
  /** Display name: the module address, or `(root)`. */
  address: string;
  resources: ViewResource[];
}

export interface ViewData {
  version: 1;
  projectId: string;
  generatedAt: string;
  source: string;
  terraformVersion?: string;
  /** Sensitive values are embedded (`--show-sensitive`). */
  showSensitive?: true;
  modules: ViewModule[];
}

/** What is stored in localStorage and exported to / imported from JSON files. */
export interface SavedState {
  version: 1;
  /** Confirmed lineKeys and resourceKeys. */
  confirmed: string[];
  /** slotKeys of confirmed units, used to tell "changed since you confirmed it". */
  slots: string[];
}
