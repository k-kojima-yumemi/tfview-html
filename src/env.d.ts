// Modules provided by the build plugins in build/plugins.ts.

declare module "*.html" {
  const text: string;
  export default text;
}

declare module "virtual:tfview-client" {
  /** The bundled browser UI (an IIFE). */
  const code: string;
  export default code;
}
