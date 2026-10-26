/** @jsxImportSource hono/jsx */
// The generated HTML page, rendered on the Node side with Hono's JSX.
// Text and attributes are escaped by JSX; the only content inserted raw is
// what JSX cannot escape correctly: the contents of <style> and <script>.
import { raw } from "hono/html";
import type { ViewData } from "./types.ts";

/**
 * JSON for a `<script type="application/json">` element.
 *
 * Script contents are raw text in HTML: entities like `&lt;` are not decoded
 * there, so JSX escaping would corrupt the data. Instead, every character
 * that could end the element or start a comment (`<`, `>`, `&`) becomes a
 * JSON `\u` escape, which `JSON.parse` turns back into the same character.
 * U+2028/U+2029 are escaped too, so the text is also valid JavaScript.
 */
export function jsonForScript(value: unknown): string {
    return JSON.stringify(value).replace(
        scriptUnsafeChars,
        (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

const scriptUnsafeChars = /[<>&\u2028\u2029]/g;

/** Our own bundled code goes in as-is, so it must not be able to close its element. */
function assertScriptSafe(name: string, code: string): string {
    if (/<\/(script|style)/i.test(code) || code.includes("<!--")) {
        throw new Error(
            `${name} contains a sequence that would break out of its element`,
        );
    }
    return code;
}

export function Document({
    data,
    css,
    client,
}: {
    data: ViewData;
    css: string;
    client: string;
}) {
    return (
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1"
                />
                <meta name="color-scheme" content="light dark" />
                <title>tfview · {data.source}</title>
                <style>{raw(assertScriptSafe("CSS", css))}</style>
            </head>
            <body>
                <div id="app" />
                <script type="application/json" id="tfview-data">
                    {raw(jsonForScript(data))}
                </script>
                <script>
                    {raw(assertScriptSafe("client script", client))}
                </script>
            </body>
        </html>
    );
}
