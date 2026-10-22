import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonical, lineKey, projectId, UNKNOWN } from "../src/hash.ts";
import { buildTree, type PlanJson } from "../src/tree.ts";
import type { ViewModule } from "../src/types.ts";
import { loadFixture, reverseKeys } from "./helpers.ts";

const allKeys = (modules: ViewModule[]) =>
  modules.flatMap((m) => m.resources.flatMap((r) => [r.resourceKey, ...r.lines.map((l) => l.key)]));

const keyMap = (modules: ViewModule[]) =>
  new Map(modules.flatMap((m) => m.resources.flatMap((r) => r.lines.map((l) => [`${r.address} ${l.path}`, l.key] as const))));

describe("canonical", () => {
  it("sorts object keys", () => {
    assert.equal(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  });

  it("does not depend on key order", () => {
    assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  });

  it("keeps list order", () => {
    assert.notEqual(canonical([1, 2]), canonical([2, 1]));
  });

  it("distinguishes unknown from every JSON value", () => {
    assert.notEqual(canonical(UNKNOWN), canonical("(known after apply)"));
    assert.notEqual(canonical(UNKNOWN), canonical(null));
  });
});

describe("keys", () => {
  const plan = loadFixture();

  it("are stable for the same input", () => {
    assert.deepEqual(allKeys(buildTree(plan)), allKeys(buildTree(loadFixture())));
  });

  it("do not depend on JSON key order", () => {
    assert.deepEqual(allKeys(buildTree(reverseKeys(plan))), allKeys(buildTree(plan)));
  });

  it("change only for the line whose value changed", () => {
    const changed: PlanJson = structuredClone(plan);
    const web = changed.resource_changes!.find((r) => r.address === "terraform_data.web")!;
    (web.change.after as { input: { instance_type: string } }).input.instance_type = "t3.large";

    const before = keyMap(buildTree(plan));
    const after = keyMap(buildTree(changed));
    const diff = [...before.keys()].filter((k) => before.get(k) !== after.get(k));
    assert.deepEqual(diff, ["terraform_data.web input.instance_type"]);
  });

  it("change when only a sensitive value changes", () => {
    const changed: PlanJson = structuredClone(plan);
    const web = changed.resource_changes!.find((r) => r.address === "terraform_data.web")!;
    (web.change.after as { input: { password: string } }).input.password = "another-secret";

    const before = keyMap(buildTree(plan));
    const after = keyMap(buildTree(changed));
    assert.notEqual(before.get("terraform_data.web input.password"), after.get("terraform_data.web input.password"));
  });

  it("include address, path, before and after", () => {
    const base = lineKey("a.b", "x", 1, 2);
    assert.notEqual(lineKey("a.c", "x", 1, 2), base);
    assert.notEqual(lineKey("a.b", "y", 1, 2), base);
    assert.notEqual(lineKey("a.b", "x", 0, 2), base);
    assert.notEqual(lineKey("a.b", "x", 1, 3), base);
  });

  it("projectId depends on the directory", () => {
    assert.equal(projectId("/a/b"), projectId("/a/b"));
    assert.notEqual(projectId("/a/b"), projectId("/a/c"));
  });
});
