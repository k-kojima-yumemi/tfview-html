// Plugins shared by the Rolldown build (rolldown.config.ts) and Vitest (vitest.config.ts).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Plugin, rolldown } from "rolldown";

const textSuffix = "?text";
const textPrefix = "\0tfview-text:";

/**
 * `import css from "./styles.css?text"` gives the file's text.
 * The resolved id no longer ends in `.css`, so Vite's own CSS handling stays out of it.
 */
export function textImport(): Plugin {
    return {
        name: "tfview:text-import",
        resolveId(source, importer) {
            if (!source.endsWith(textSuffix) || !importer) return null;
            return (
                textPrefix +
                resolve(dirname(importer), source.slice(0, -textSuffix.length))
            );
        },
        async load(id) {
            if (!id.startsWith(textPrefix)) return null;
            const text = await readFile(id.slice(textPrefix.length), "utf8");
            return {
                code: `export default ${JSON.stringify(text)};`,
                moduleType: "js",
            };
        },
    };
}

export const clientModule = "virtual:tfview-client";
const resolvedClient = `\0${clientModule}`;
const clientEntry = fileURLToPath(
    new URL("../src/client/app.tsx", import.meta.url),
);

/** Bundles the browser UI and returns it as a string. */
export async function bundleClient(): Promise<string> {
    const bundle = await rolldown({
        input: clientEntry,
        // JSX settings (hono/jsx/dom) come from tsconfig.json.
        platform: "browser",
    });
    try {
        const { output } = await bundle.generate({
            format: "iife",
            minify: true,
        });
        return output[0].code;
    } finally {
        await bundle.close();
    }
}

/** `import client from "virtual:tfview-client"` gives the bundled UI script, to inline into the HTML. */
export function clientBundle(): Plugin {
    return {
        name: "tfview:client-bundle",
        resolveId(id) {
            return id === clientModule ? resolvedClient : null;
        },
        async load(id) {
            if (id !== resolvedClient) return null;
            return {
                code: `export default ${JSON.stringify(await bundleClient())};`,
                moduleType: "js",
            };
        },
    };
}
