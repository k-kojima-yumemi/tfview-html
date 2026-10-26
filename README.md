# tfview

English | [日本語](README_ja.md)

A review tool for Terraform plan diffs. Like "Viewed" on a GitHub PR, you mark changes as viewed and fold them away.
It generates a single static HTML file from a plan and opens it in the browser.

- Viewed state is stored in the browser. After a re-plan, lines with identical content stay viewed, and only the lines that changed show up open.
- You can mark things as viewed at any level: module, resource or line. Marking a parent folds everything under it.
- No server or resident process. The process exits once the file is generated.
- The page picks its language (English / Japanese) from the browser. Add `?lang=en` or `?lang=ja` to the URL, or use the selector in the top bar, to switch. The CLI is English only.

## Install

Not published to npm. Build it locally. Node.js 24 or later is required.

```sh
git clone git@github.com:k-kojima-yumemi/tfview-html.git
cd tfview-html
npm install
npm run build      # builds dist/tfview.js
npm link           # registers the tfview command (optional)
```

Without `npm link`, run it directly with `node <path to clone>/dist/tfview.js`.
`dist/tfview.js` is a single dependency-free file, so you can also copy it anywhere.

## Usage

Run it in a directory where `terraform init` has been done.

```sh
terraform plan -out=tfplan
tfview tfplan      # without npm link: node <path to clone>/dist/tfview.js tfplan
```

`./tfview.html` is generated (overwritten each time) and opened in your default browser.

You can also pass the output of `terraform show -json`.

```sh
terraform show -json tfplan > plan.json
tfview plan.json
```

### Options

| Option | Description |
|---|---|
| `<planfile>` | A binary plan, or the output of `terraform show -json`. Detected from the first bytes (`PK` is a binary plan, `{` is JSON) |
| `-o, --out <path>` | Output path. Default: `./tfview.html` |
| `--bin <name>` | Terraform command to run. Default: `terraform` (e.g. `--bin tofu`) |
| `--no-open` | Generate only; do not open the browser |
| `--show-sensitive` | Embed and show sensitive values in the HTML (off by default; see below) |

For a binary plan, `terraform show -json <planfile>` runs in the **current directory of the command**. Run it in a directory where `terraform init` has been done.

## The page

- **Checkboxes**: at every level (module / resource / line), each level indented one step to the right. Internally the viewed state is kept per line; a module or resource checkbox toggles all the lines under it.
- **Progress**: the top shows "N / M lines viewed". Resource and module progress appear next to it in smaller text.
- **Sticky headings**: while scrolling, the headings of the current module and resource stick to the top, so you can check things without scrolling back up.
- **Checking**: checking a parent marks every line under it as viewed and folds it. Checking all children marks the parent automatically. A parent with only some children viewed shows the indeterminate state.
- **Folding**: click the caret (›) or the heading to expand / collapse. Expanding does not undo "viewed".
- **Copy address**: the button right of a resource name copies its address (in a form `terraform apply -target=...` accepts). Pressing it does not fold the heading.
- **Carry-over from last time**: lines that were viewed before with identical content are folded as viewed. The heading shows "N viewed before". Lines whose value changed after you viewed them get an "updated" mark.
- **Compare ignoring order** (lists of objects): lists of objects (such as CodeBuild's `environment_variable`) are compared by position by default. When elements that merely changed order show up as diffs, pick a field such as `name` from the selector above the list; elements with the same value of that field are then compared with each other (elements are sorted by that value, and each block starts with the field used for matching). The selector is offered only for lists whose elements have been reordered and have a string field that is unique across all elements and neither sensitive nor unknown. The choice is per list, is not saved, and goes back to by-position when you reopen the page. By-position and by-field comparisons use different line keys, so viewed state is not carried between them.
- **Compare ignoring order** (lists of values): for lists of strings or numbers such as `cidr_blocks` whose order changed, the selector above the list offers "Compare ignoring order". Added values become `+` lines, removed values `-` lines, and values on both sides are summarized as `# (N unchanged elements hidden)`. If only the order changed, no change lines remain. The selector is offered only for lists with no duplicate values and no sensitive or unknown values.
- **Layout**: shown in a nested form close to `terraform plan`.
  - Groups are wrapped and indented, like `tags = { ... }`, `ingress { ... }` and `cidr_blocks = [ ... ]`.
  - Unchanged attributes are summarized as `# (N unchanged attributes hidden)`. `id` and `name` are shown as context even when unchanged.
  - Only changed lines can be checked. Brackets and comment lines are there for reading.
  - The plan JSON carries no provider schema, so whether something is a block is inferred from the shape of the value. Lists of objects count as blocks, and the contents of nested maps count as elements. The counts can therefore differ slightly from Terraform's.
  - Resources imported by an `import` block get an `import` tag in the heading. The body starts with `# (imported from "...")`, as in `terraform plan`. Imports with no diff (actions `no-op`) are not dropped from the list; they are shown as `will be imported`.
  - Resources whose address changed, for example through a `moved` block, get a `moved` tag in the heading, and the body starts with `# (moved from ...)`. Moves with no diff (actions `no-op`) are not dropped either; they are shown as `has moved`. The line keys change with the address, so lines viewed before the move are not carried over.
  - `(known after apply)`, `forces replacement` and `(sensitive)` are highlighted. Long or multi-line values are clipped; click to show them in full. Hovering a line shows the full path of the attribute.

## Sensitive values

By default, sensitive values are **not embedded** in the HTML at all; only `(sensitive)` is shown.

- Values marked in the plan JSON's `before_sensitive` / `after_sensitive` are hidden.
- Only values Terraform marked are hidden. Unmarked values are shown as-is, like `terraform plan` does (for example, a `terraform_data` `output` repeats a sensitive `input` without the mark, so the `output` value is shown).
- The actual values are used to compute the hash keys. If a sensitive value changes, its line goes back to unviewed.

With `--show-sensitive`, the actual values are embedded and shown. Such lines get a `sensitive` tag and a warning appears at the top of the page. The generated HTML contains secrets in plain text, so be careful when sharing or committing it. The keys are the same either way, so viewed state carries over when you toggle this on or off.

## Saving viewed state

- Saved in the browser's `localStorage` under the key `tfview:<projectId>`. `projectId` is a hash of the absolute path of the current directory at generation time.
- Only hashes are stored. Attribute values and resource names are not.
- When a regenerated HTML is opened, keys that no longer exist in the current plan are removed from the saved data.
- Where localStorage is unavailable, it works with in-memory state only and the page shows a message that state cannot be saved.

### Export / import

The buttons at the top of the page write the viewed state to a JSON file and read it back.

- Use it to recover when localStorage is lost, or when switching browsers.
- It also works for sharing within a team. The contents are only hashes, so no values leak.
- Import **adds** (merges). Keys not in the current plan are ignored.
- Hashes are computed from address and value, so a file also applies to the same plan generated in another directory or by another person.

### localStorage behavior on `file://`

| Browser | Regenerating over the same path | Mixing with other directories | How verified |
|---|---|---|---|
| Chrome | Carried over | Not mixed | Verified automatically (headless Chrome) |
| Firefox | Not verified | Not verified | Check manually |
| Safari | Not verified | Not verified | Check manually |

- In Chrome, all `file://` pages shared the same localStorage. State from another directory goes under a key with a different `projectId`, so it does not mix.
- For browsers that give each file its own storage, this relies on the output path being fixed (`./tfview.html`) so the storage stays the same. In a browser where that does not hold, use export / import.

Manual check:

1. Generate with `tfview tfplan` and check a few lines.
2. Run `tfview tfplan` again in the same directory and confirm the checks remain.
3. Open an HTML generated in another directory and confirm the checks are not mixed.

## How it works

1. Exclude no-op and read from the plan JSON's `resource_changes`.
2. Compare `change.before` / `change.after` recursively; each changed leaf becomes one line.
3. Compute a hash key for each line.
   - `lineKey = sha256(address \0 attrPath \0 canonical(before) \0 canonical(after))`
   - `canonical()` is a stable JSON serialization with sorted object keys.
   - A resource with no lines holds its viewed state through `resourceKey = sha256(address \0 actions)`.
4. The module → resource → line tree and the keys are embedded in the HTML. CSS and JS are inline; nothing depends on external resources.

### Known limitations

- Values that change on every plan (timestamps, random IDs) go back to unviewed every time.
- If the order or index of a list changes, the path changes and the line goes back to unviewed.
- A resource whose address changed through `moved` or a refactor is treated as new.
- Nested modules are shown as one level, `module.a.module.b`.

## Development

The Node.js version is pinned to `24.22.1` with [Volta](https://volta.sh/).

```sh
npm install        # install devDependencies
npm run build      # emit a single dist/tfview.js with Rolldown
npm run format     # format and autofix with Biome
npm run ci         # Biome check and tsc type check (same as CI)
npm test           # Vitest
node dist/tfview.js test/fixtures/plan.json --no-open
```

- `dist/tfview.js` is one file containing the CLI, the UI (TSX + `hono/jsx/dom`) and the CSS. It has no runtime dependencies, so handing over just this file is enough: `node tfview.js tfplan`.
- The UI is `src/client/app.tsx` bundled into an IIFE by Rolldown, and inlined into the generated HTML.
- The plugins in `build/plugins.ts` (an import with `?text` reads a file as a string; the UI is bundled into a string) are used by both the Rolldown build and Vitest.
- UI text lives in `src/client/i18n.ts`. To add a language, add an object there with the same shape as `en`, and register it in `locales`, `localeNames` and `isLocale`. The CLI stays English only.

```
bin/tfview.ts        CLI entry (argument parsing, generation, opening the browser)
src/show.ts          input detection, running terraform show -json
src/tree.ts          plan JSON -> module/resource/line tree, expanding lines into display nesting, sensitive masking
src/hash.ts          canonical JSON, key computation
src/render.ts        generates the HTML
src/document.tsx     the HTML document (server-side hono/jsx). JSX escapes values; only the JSON put into <script> is serialized with jsonForScript
src/generate.ts      ties the above together
src/styles.css       CSS
src/client/app.tsx   UI (hono/jsx/dom)
src/client/i18n.ts   UI text per language and locale detection
src/client/state.ts  viewed-state operations (check, fold, carry-over, import). Pure functions with no DOM dependency
src/client/storage.ts reading and writing localStorage
build/plugins.ts     plugins shared by Rolldown / Vitest
test/                Vitest unit tests
test/fixtures/       plan.json for verification
```

`test/fixtures/plan.json` was generated from a Terraform project that uses only the built-in `terraform_data` resource. It covers create / update / delete / replace / sensitive / unknown / for_each / nested modules. The sensitive variable value (`hunter2-...`) is a dummy for testing.
