import client from "virtual:tfview-client";
import template from "./template.html";
import type { ViewData } from "./types.ts";

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

export function renderHtml(data: ViewData): string {
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
