import client from "virtual:tfview-client";
import { jsx } from "hono/jsx";
import { Document } from "./document.tsx";
import css from "./styles.css?text";
import type { ViewData } from "./types.ts";

export async function renderHtml(data: ViewData): Promise<string> {
    return `<!doctype html>\n${await jsx(Document, { data, css, client }).toString()}`;
}
