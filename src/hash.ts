import { createHash } from "node:crypto";

/** Marks a value that is `(known after apply)`. */
export const UNKNOWN: unique symbol = Symbol("unknown");

/**
 * Stable JSON serialization: object keys are sorted so the result does not
 * depend on key order. `undefined` is treated like `null` (Terraform does not
 * distinguish an absent attribute from a null one). An unknown value becomes a
 * bare token that no JSON value can collide with.
 */
export function canonical(value: unknown): string {
  if (value === UNKNOWN) return "(known after apply)";
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 128 bits of sha256 is plenty to avoid collisions and keeps the HTML smaller.
const KEY_LENGTH = 32;

export function sha256(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, KEY_LENGTH);
}

export function lineKey(address: string, attrPath: string, before: unknown, after: unknown): string {
  return sha256(address, attrPath, canonical(before), canonical(after));
}

/** `importing` is the import source; a different source means a different change to confirm. */
export function resourceKey(address: string, actions: readonly string[], importing?: string): string {
  return importing === undefined ? sha256(address, actions.join(",")) : sha256(address, actions.join(","), `import:${importing}`);
}

export function slotKey(address: string, attrPath?: string): string {
  return attrPath === undefined ? sha256("slot", address) : sha256("slot", address, attrPath);
}

export function projectId(cwd: string): string {
  return sha256("project", cwd).slice(0, 16);
}
