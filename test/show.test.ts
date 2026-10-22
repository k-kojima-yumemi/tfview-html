import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectKind, loadPlan, parsePlan, UserError } from "../src/show.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("detectKind", () => {
  it("detects zip (binary plan)", () => {
    assert.equal(detectKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "binary");
  });

  it("detects JSON, with leading whitespace or BOM", () => {
    assert.equal(detectKind(bytes('{"a":1}')), "json");
    assert.equal(detectKind(bytes('\n  {"a":1}')), "json");
    assert.equal(detectKind(bytes('﻿{"a":1}')), "json");
  });

  it("rejects anything else", () => {
    assert.equal(detectKind(bytes("hello")), undefined);
    assert.equal(detectKind(new Uint8Array()), undefined);
  });
});

describe("parsePlan", () => {
  it("rejects non-object JSON", () => {
    assert.throws(() => parsePlan("[]", "x"), UserError);
    assert.throws(() => parsePlan("{", "x"), UserError);
  });
});

describe("loadPlan", () => {
  it("reports a missing command with a hint", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tfview-"));
    try {
      const plan = join(dir, "tfplan");
      await writeFile(plan, new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
      await assert.rejects(loadPlan(plan, { bin: "tfview-no-such-command", cwd: dir }), (err: unknown) => {
        assert.ok(err instanceof UserError);
        assert.match(err.hint ?? "", /--bin/);
        return true;
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing file", async () => {
    await assert.rejects(loadPlan("/no/such/tfplan", { bin: "terraform", cwd: "/" }), UserError);
  });
});
