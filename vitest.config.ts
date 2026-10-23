import { defineConfig } from "vitest/config";
import { clientBundle, textImport } from "./build/plugins.ts";

export default defineConfig({
    plugins: [{ ...textImport(), enforce: "pre" }, clientBundle()],
    test: {
        include: ["test/**/*.test.ts"],
    },
});
