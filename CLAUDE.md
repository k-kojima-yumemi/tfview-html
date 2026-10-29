# tfview

CLI that turns a Terraform plan into a single static HTML page for reviewing diffs with "Viewed" checkboxes. User-facing behavior is documented in README.md (English) and README_ja.md (Japanese).

When a change affects anything the READMEs describe (CLI options, page behavior, saved state, "How it works", "Known limitations"), update both READMEs in the same change and keep them saying the same thing. In particular, remove or rewrite a known limitation once it no longer holds. Do not use bold or other emphasis in the READMEs.

## Commands

```sh
npm run build      # emit a single dist/tfview.js with Rolldown
npm run format     # biome check --write --unsafe
npm run ci         # biome ci && tsc --noEmit (same as GitHub Actions)
npm test           # Vitest
node dist/tfview.js test/fixtures/plan.json --no-open
```

Run `npm run format` and then `npm run ci` and `npm test` before calling a change done.

## Architecture

- `dist/tfview.js` is one file holding the CLI, the UI (TSX on `hono/jsx/dom`) and the CSS, with no runtime dependencies.
- Flow: `bin/tfview.ts` (args) → `src/generate.ts` → `src/show.ts` (read the plan; runs `terraform show -json` for binary plans) → `src/tree.ts` (plan JSON → module/resource/line tree) → `src/render.ts` / `src/document.tsx` (HTML).
- The UI is `src/client/app.tsx`, bundled by Rolldown into an IIFE string and inlined into the generated HTML. `src/client/state.ts` holds the viewed-state logic as pure functions with no DOM dependency; test logic there rather than through the DOM.
- `build/plugins.ts` (`?text` imports read a file as a string; the UI bundle as a string) is shared by the Rolldown build and Vitest.
- Viewed state lives in `localStorage` under `tfview:<projectId>` and stores only hashes (`src/hash.ts`), never attribute values or resource names. Changing how a key is computed resets everyone's saved state.
- The page HTML is server-rendered with `hono/jsx`, which escapes values. Only the JSON placed in `<script>` goes through `jsonForScript`.

## Conventions

- UI text lives in `src/client/i18n.ts` (English and Japanese). Add every new string to both. To add a language, add an object shaped like `en` and register it in `locales`, `localeNames` and `isLocale`. The CLI is English only.
- Use camelCase names. Where Terraform's JSON field names (`resource_changes`, ...) are needed, suppress `useNamingConvention` with a `biome-ignore` comment, as existing files do.
- Write code that `biome check --unsafe` cannot change in meaning. If an autofix breaks something, fix the code, not the tool.
  - No non-null assertions (`!`); use throwing lookups such as `nodeOf` / `requireElement`, or the test helpers `at` / `lineAtPath`.
  - Build class lists with `classNames()` (one class per argument), never conditional strings with leading spaces.
  - No invisible or fragile non-ASCII characters in source; use escapes such as `﻿`.
- Errors the user can fix are thrown as `UserError` (message and optional hint); the CLI prints them without a stack trace.

## Screenshot

`docs/screenshot.png` (used in both READMEs) is rendered from `docs/demo-plan.json`, a hand-written plan with dummy values. Never build it from a real project's plan. When a UI change makes the screenshot outdated, say so.

## Test fixture

`test/fixtures/plan.json` was generated from a Terraform project that uses only the built-in `terraform_data` resource. It covers create / update / delete / replace / sensitive / unknown / for_each / nested modules. The sensitive value (`hunter2-...`) is a dummy.
