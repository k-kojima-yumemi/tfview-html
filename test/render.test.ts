import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildViewData, generate } from "../src/generate.ts";
import { embedJson, renderHtml } from "../src/render.ts";
import { FIXTURE_PLAN, loadFixture } from "./helpers.ts";

const extractData = (html: string) => JSON.parse(/<script type="application\/json" id="tfview-data">(.*?)<\/script>/s.exec(html)![1]!);

describe("embedJson", () => {
  it("escapes < so values cannot close the script tag", () => {
    const out = embedJson({ v: "</script><!-- x" });
    assert.ok(!out.includes("<"));
    assert.deepEqual(JSON.parse(out), { v: "</script><!-- x" });
  });

  it("escapes line separators", () => {
    const out = embedJson({ v: "a\u2028b\u2029c" });
    assert.ok(!/[\u2028\u2029]/.test(out));
    assert.deepEqual(JSON.parse(out), { v: "a\u2028b\u2029c" });
  });
});

describe("renderHtml", () => {
  const data = buildViewData(loadFixture(), { cwd: "/work/infra", source: "tfplan", now: new Date(0) });

  it("embeds the data, which round-trips", async () => {
    const html = await renderHtml(data);
    assert.deepEqual(extractData(html), data);
  });

  it("does not contain sensitive values", async () => {
    const raw = await readFile(FIXTURE_PLAN, "utf8");
    assert.ok(raw.includes("hunter2"), "fixture should contain the secret in plaintext");
    const html = await renderHtml(data);
    assert.ok(!html.includes("hunter2"));
  });

  it("keeps a single script-closing tag per script", async () => {
    const html = await renderHtml(data);
    assert.equal(html.match(/<\/script>/g)!.length, 2);
  });

  it("does not depend on external resources", async () => {
    const html = await renderHtml(data);
    assert.ok(!/<(script|link)[^>]+(src|href)=/i.test(html));
  });
});

describe("generate", () => {
  it("reads a JSON plan and writes the HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tfview-"));
    try {
      const { path, data } = await generate({ planfile: fileURLToPath(FIXTURE_PLAN), out: "out.html", bin: "terraform", cwd: dir });
      assert.equal(path, join(dir, "out.html"));
      assert.deepEqual(extractData(await readFile(path, "utf8")), data);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
