// Plugins shared by the Rolldown build (rolldown.config.ts) and Vitest (vitest.config.ts).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown, type Plugin } from "rolldown";

const TEXT_SUFFIX = "?text";
const TEXT_PREFIX = "\0tfview-text:";

/**
 * `import css from "./styles.css?text"` gives the file's text.
 * The resolved id no longer ends in `.css`, so Vite's own CSS handling stays out of it.
 */
export function textImport(): Plugin {
  return {
    name: "tfview:text-import",
    resolveId(source, importer) {
      if (!source.endsWith(TEXT_SUFFIX) || !importer) return null;
      return TEXT_PREFIX + resolve(dirname(importer), source.slice(0, -TEXT_SUFFIX.length));
    },
    async load(id) {
      if (!id.startsWith(TEXT_PREFIX)) return null;
      const text = await readFile(id.slice(TEXT_PREFIX.length), "utf8");
      return { code: `export default ${JSON.stringify(text)};`, moduleType: "js" };
    },
  };
}

export const CLIENT_MODULE = "virtual:tfview-client";
const RESOLVED_CLIENT = `\0${CLIENT_MODULE}`;
const CLIENT_ENTRY = fileURLToPath(new URL("../src/client/app.tsx", import.meta.url));

/** Bundles the browser UI and returns it as a string. */
export async function bundleClient(): Promise<string> {
  const bundle = await rolldown({
    input: CLIENT_ENTRY,
    // JSX settings (hono/jsx/dom) come from tsconfig.json.
    platform: "browser",
  });
  try {
    const { output } = await bundle.generate({ format: "iife", minify: true });
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
      return id === CLIENT_MODULE ? RESOLVED_CLIENT : null;
    },
    async load(id) {
      if (id !== RESOLVED_CLIENT) return null;
      return { code: `export default ${JSON.stringify(await bundleClient())};`, moduleType: "js" };
    },
  };
}
