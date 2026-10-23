import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { describe, it } from "vitest";
import { Document, jsonForScript } from "../src/document.tsx";
import { buildViewData, generate } from "../src/generate.ts";
import { renderHtml } from "../src/render.ts";
import type { PlanJson } from "../src/tree.ts";
import { at, fixturePlan, loadFixture } from "./helpers.ts";

/** Parses without running scripts, the way a browser builds the DOM. */
function parse(html: string): Document {
    const window = new Window();
    return new window.DOMParser().parseFromString(
        html,
        "text/html",
    ) as unknown as Document;
}

const dataOf = (doc: Document) =>
    JSON.parse(doc.getElementById("tfview-data")?.textContent ?? "null");

// Tries to close the element, open a new script, inject a handler, and open a comment.
const hostilePayload = `</script><script>window.__xss=1</script><img src=x onerror="window.__xss=1"><!--`;

// biome-ignore-start lint/style/useNamingConvention: field names of Terraform's JSON plan format
const hostilePlan: PlanJson = {
    terraform_version: hostilePayload,
    resource_changes: [
        {
            address: `module.m["${hostilePayload}"].aws_x.y["${hostilePayload}"]`,
            module_address: `module.m["${hostilePayload}"]`,
            change: {
                actions: ["update"],
                before: {
                    id: hostilePayload,
                    name: "a",
                    tags: { [hostilePayload]: hostilePayload },
                },
                after: {
                    id: hostilePayload,
                    name: hostilePayload,
                    tags: { [hostilePayload]: `${hostilePayload}2` },
                },
                importing: { id: hostilePayload },
            },
        },
    ],
};
// biome-ignore-end lint/style/useNamingConvention: field names of Terraform's JSON plan format

describe("jsonForScript", () => {
    it("leaves no character that could end the element or open a comment", () => {
        const out = jsonForScript({ v: hostilePayload, w: "a&b>c" });
        assert.ok(!/[<>&]/.test(out));
        assert.deepEqual(JSON.parse(out), { v: hostilePayload, w: "a&b>c" });
    });

    it("escapes line separators", () => {
        const out = jsonForScript({ v: "a\u2028b\u2029c" });
        assert.ok(!/[\u2028\u2029]/.test(out));
        assert.deepEqual(JSON.parse(out), { v: "a\u2028b\u2029c" });
    });
});

describe("renderHtml", () => {
    it("embeds the data, which round-trips", async () => {
        const data = buildViewData(loadFixture(), {
            cwd: "/work/infra",
            source: "tfplan",
            now: new Date(0),
        });
        assert.deepEqual(dataOf(parse(await renderHtml(data))), data);
    });

    it("does not contain sensitive values", async () => {
        const raw = await readFile(fixturePlan, "utf8");
        assert.ok(
            raw.includes("hunter2"),
            "fixture should contain the secret in plaintext",
        );
        const data = buildViewData(loadFixture(), {
            cwd: "/work/infra",
            source: "tfplan",
        });
        assert.ok(!(await renderHtml(data)).includes("hunter2"));
    });

    it("does not depend on external resources", async () => {
        const data = buildViewData(loadFixture(), {
            cwd: "/work/infra",
            source: "tfplan",
        });
        const doc = parse(await renderHtml(data));
        assert.equal(
            doc.querySelectorAll("script[src], link[href], img, iframe").length,
            0,
        );
    });
});

describe("renderHtml with hostile input", () => {
    const data = buildViewData(hostilePlan, {
        cwd: "/work",
        source: `plan${hostilePayload}.json`,
    });

    it("keeps the document structure: exactly our two scripts, nothing injected", async () => {
        const doc = parse(await renderHtml(data));
        const scripts = [...doc.querySelectorAll("script")];
        assert.equal(scripts.length, 2);
        assert.equal(at(scripts, 0).getAttribute("type"), "application/json");
        assert.equal(
            doc.querySelectorAll("img, iframe, object, embed").length,
            0,
        );
        assert.equal(doc.body.children.length, 3);
    });

    it("round-trips the hostile values exactly", async () => {
        assert.deepEqual(dataOf(parse(await renderHtml(data))), data);
    });

    it("escapes the title", async () => {
        const doc = parse(await renderHtml(data));
        assert.equal(doc.title, `tfview · plan${hostilePayload}.json`);
        assert.equal(doc.head.querySelectorAll("script").length, 0);
    });

    it("never writes the payload's markup literally", async () => {
        const html = await renderHtml(data);
        assert.ok(!html.includes("<script>window.__xss"));
        assert.ok(!html.includes("<img"));
    });

    it("refuses inline code that could close its element", () => {
        assert.throws(
            () =>
                Document({ data, css: "", client: 'console.log("</script>")' }),
            /break out/,
        );
        assert.throws(
            () => Document({ data, css: "a{}</style>", client: "" }),
            /break out/,
        );
    });
});

describe("generate", () => {
    it("reads a JSON plan and writes the HTML", async () => {
        const dir = await mkdtemp(join(tmpdir(), "tfview-"));
        try {
            const { path, data } = await generate({
                planfile: fileURLToPath(fixturePlan),
                out: "out.html",
                bin: "terraform",
                cwd: dir,
            });
            assert.equal(path, join(dir, "out.html"));
            assert.deepEqual(dataOf(parse(await readFile(path, "utf8"))), data);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
