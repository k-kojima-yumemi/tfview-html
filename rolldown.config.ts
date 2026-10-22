import { defineConfig } from "rolldown";
import { clientBundle, textImport } from "./build/plugins.ts";

// The whole tool, UI included, becomes one file: dist/tfview.js.
export default defineConfig({
  input: "bin/tfview.ts",
  platform: "node",
  plugins: [textImport(), clientBundle()],
  transform: { target: "node24" },
  output: {
    file: "dist/tfview.js",
    format: "esm",
  },
});
