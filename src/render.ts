import { readFile } from "node:fs/promises";
import type { ViewData } from "./types.ts";

// Both files sit next to this module after `npm run build` (dist/src/).
const TEMPLATE_URL = new URL("./template.html", import.meta.url);
const CLIENT_URL = new URL("./client/app.js", import.meta.url);

/** JSON that is safe inside `<script type="application/json">`, even if values contain `</script>` or `<!--`. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

const LINE_SEPARATORS = new RegExp("[\\u2028\\u2029]", "g");

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export async function renderHtml(data: ViewData): Promise<string> {
  const [template, client] = await Promise.all([readFile(TEMPLATE_URL, "utf8"), readFile(CLIENT_URL, "utf8")]);
  const replacements: Record<string, string> = {
    "<!--TFVIEW_TITLE-->": escapeHtml(`tfview · ${data.source}`),
    "/*TFVIEW_DATA*/": embedJson(data),
    "/*TFVIEW_CLIENT*/": client.replace(/<\/script/gi, "<\\/script"),
  };
  for (const token of Object.keys(replacements)) {
    if (!template.includes(token)) throw new Error(`template is missing ${token}`);
  }
  // One pass over the template, so a token that happens to appear inside the
  // plan data is never substituted.
  const pattern = new RegExp(Object.keys(replacements).map((t) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|"), "g");
  return template.replace(pattern, (token) => replacements[token]!);
}
