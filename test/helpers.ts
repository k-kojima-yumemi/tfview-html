import { readFileSync } from "node:fs";
import type { PlanJson } from "../src/tree.ts";
import type { ViewModule, ViewResource } from "../src/types.ts";

export const FIXTURE_PLAN = new URL("./fixtures/plan.json", import.meta.url);

export function loadFixture(): PlanJson {
  return JSON.parse(readFileSync(FIXTURE_PLAN, "utf8")) as PlanJson;
}

export function findResource(modules: ViewModule[], address: string): ViewResource {
  for (const m of modules) for (const r of m.resources) if (r.address === address) return r;
  throw new Error(`resource not found: ${address}`);
}

/** Deep copy with every object's keys in reverse order. */
export function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    ) as T;
  }
  return value;
}
