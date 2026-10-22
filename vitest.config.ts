import { defineConfig } from "vitest/config";
import { clientBundle, htmlAsText } from "./build/plugins.ts";

export default defineConfig({
  plugins: [{ ...htmlAsText(), enforce: "pre" }, clientBundle()],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
