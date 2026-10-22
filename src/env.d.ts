// Modules provided by the build plugins in build/plugins.ts.

declare module "*?text" {
  /** The file's contents (see textImport). */
  const text: string;
  export default text;
}

declare module "virtual:tfview-client" {
  /** The bundled browser UI (an IIFE). */
  const code: string;
  export default code;
}
