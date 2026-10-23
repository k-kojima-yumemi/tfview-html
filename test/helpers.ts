import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { PlanJson, ResourceChange } from "../src/tree.ts";
import type { ViewLine, ViewModule, ViewResource } from "../src/types.ts";

export const fixturePlan = new URL("./fixtures/plan.json", import.meta.url);

export function loadFixture(): PlanJson {
    return JSON.parse(readFileSync(fixturePlan, "utf8")) as PlanJson;
}

export function findResource(
    modules: ViewModule[],
    address: string,
): ViewResource {
    for (const m of modules)
        for (const r of m.resources) if (r.address === address) return r;
    throw new Error(`resource not found: ${address}`);
}

/** Element `i`; fails the test instead of returning undefined. */
export function at<T>(list: readonly T[], i: number): T {
    const item = list[i];
    assert.ok(item !== undefined, `no element at ${i}`);
    return item;
}

export function lineAtPath(res: ViewResource, path: string): ViewLine {
    const line = res.lines.find((l) => l.path === path);
    assert.ok(line, `${res.address}: no line at ${path}`);
    return line;
}

export function findChange(plan: PlanJson, address: string): ResourceChange {
    const change = plan.resource_changes?.find((r) => r.address === address);
    assert.ok(change, `no resource change for ${address}`);
    return change;
}

/** Sets a value inside a resource's planned `after` object, e.g. `["input", "instance_type"]`. */
export function setAfter(
    plan: PlanJson,
    address: string,
    path: readonly string[],
    value: unknown,
): void {
    let target = findChange(plan, address).change.after;
    for (const key of path.slice(0, -1)) {
        assert.ok(
            target !== null && typeof target === "object",
            `no object at ${key}`,
        );
        target = (target as Record<string, unknown>)[key];
    }
    const last = path.at(-1);
    assert.ok(
        last !== undefined && target !== null && typeof target === "object",
        "invalid path",
    );
    (target as Record<string, unknown>)[last] = value;
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
