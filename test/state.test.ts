import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
    buildModel,
    importSaved,
    isDone,
    lineNodeId,
    nodeOf,
    parseSaved,
    progress,
    type ReviewState,
    restore,
    toggleCollapsed,
    toggleNode,
    toSaved,
} from "../src/client/state.ts";
import { buildViewData } from "../src/generate.ts";
import type { PlanJson } from "../src/tree.ts";
import type { SavedState } from "../src/types.ts";
import { at, loadFixture, setAfter } from "./helpers.ts";

const emptySaved: SavedState = { version: 1, confirmed: [], slots: [] };

function setup(plan: PlanJson = loadFixture(), saved: SavedState = emptySaved) {
    const model = buildModel(
        buildViewData(plan, { cwd: "/work", source: "tfplan" }),
    );
    return { model, ...restore(model, saved) };
}

const node = nodeOf;
const webId = "r:terraform_data.web";
const appId = "m:module.app";

describe("toggleNode", () => {
    it("checking a resource confirms all its lines and folds it", () => {
        const { model, state } = setup();
        const next = toggleNode(model, state, node(model, webId));
        assert.ok(isDone(next, node(model, webId)));
        assert.ok(next.collapsed.has(webId));
    });

    it("checking a module folds the module and its resources", () => {
        const { model, state } = setup();
        const next = toggleNode(model, state, node(model, appId));
        assert.ok(next.collapsed.has(appId));
        for (const r of node(model, appId).children)
            assert.ok(next.collapsed.has(r.id));
    });

    it("unchecking unconfirms every line below and unfolds", () => {
        const { model, state } = setup();
        const checked = toggleNode(model, state, node(model, appId));
        const next = toggleNode(model, checked, node(model, appId));
        assert.equal(next.confirmed.size, 0);
        assert.equal(next.collapsed.size, 0);
    });

    it("checking every line folds the resource, and the module once it is complete", () => {
        const { model, state } = setup();
        const config = node(model, "r:module.app.terraform_data.config");
        let s: ReviewState = state;
        for (const line of config.children) s = toggleNode(model, s, line);
        assert.ok(s.collapsed.has(config.id));
        // module.app has only this resource, so it is complete too.
        assert.ok(s.collapsed.has(appId));
    });

    it("a partially checked resource stays open", () => {
        const { model, state } = setup();
        const web = node(model, webId);
        const next = toggleNode(model, state, at(web.children, 0));
        assert.ok(!isDone(next, web));
        assert.ok(!next.collapsed.has(webId));
    });

    it("unchecking a line reopens its folded ancestors", () => {
        const { model, state } = setup();
        const checked = toggleNode(model, state, node(model, appId));
        const config = node(model, "r:module.app.terraform_data.config");
        const next = toggleNode(model, checked, at(config.children, 0));
        assert.ok(!next.collapsed.has(config.id));
        assert.ok(!next.collapsed.has(appId));
    });
});

describe("folding and progress", () => {
    it("a confirmed node can be opened and stays confirmed", () => {
        const { model, state } = setup();
        const checked = toggleNode(model, state, node(model, webId));
        const opened = toggleCollapsed(checked, webId);
        assert.ok(!opened.collapsed.has(webId));
        assert.ok(isDone(opened, node(model, webId)));
    });

    it("progress counts lines, resources and modules", () => {
        const { model, state } = setup();
        const checked = toggleNode(model, state, node(model, webId));
        assert.deepEqual(progress(model, checked), {
            lines: { done: 3, total: 31 },
            resources: { done: 1, total: 9 },
            modules: { done: 0, total: 3 },
        });
    });
});

describe("restore (carry-over between plans)", () => {
    it("keeps unchanged lines confirmed and folded, and reports changed ones", () => {
        const first = setup();
        const saved = toSaved(
            toggleNode(first.model, first.state, node(first.model, webId)),
        );

        const plan = loadFixture();
        setAfter(
            plan,
            "terraform_data.web",
            ["input", "instance_type"],
            "t3.large",
        );
        const second = setup(plan, saved);

        const lines = node(second.model, webId).children;
        const confirmed = lines.filter((l) =>
            second.state.confirmed.has(at(l.units, 0)),
        ).length;
        assert.equal(confirmed, lines.length - 1);
        assert.equal(second.carried.size, lines.length - 1);
        assert.equal(second.updated.size, 1);
        // One line is open again, so the resource is not folded.
        assert.ok(!second.state.collapsed.has(webId));
    });

    it("folds everything that is fully confirmed", () => {
        const first = setup();
        const saved = toSaved(
            toggleNode(first.model, first.state, node(first.model, appId)),
        );
        const second = setup(loadFixture(), saved);
        assert.ok(second.state.collapsed.has(appId));
    });

    it("drops keys that are not in this plan", () => {
        const { state } = setup(loadFixture(), {
            version: 1,
            confirmed: ["gone"],
            slots: ["gone-slot"],
        });
        assert.equal(state.confirmed.size, 0);
        assert.equal(state.slots.size, 0);
    });
});

describe("import and parse", () => {
    it("merges imported keys and ignores unknown ones", () => {
        const { model, state } = setup();
        const keys = node(model, webId).units;
        const { state: next, added } = importSaved(model, state, {
            version: 1,
            confirmed: [...keys, "unknown"],
            slots: [],
        });
        assert.equal(added, keys.length);
        assert.ok(isDone(next, node(model, webId)));
        assert.ok(next.collapsed.has(webId));
    });

    it("accepts the saved format and a bare array of keys", () => {
        assert.deepEqual(parseSaved(["a"]), {
            version: 1,
            confirmed: ["a"],
            slots: [],
        });
        assert.deepEqual(parseSaved({ confirmed: ["a"], slots: ["s"] }), {
            version: 1,
            confirmed: ["a"],
            slots: ["s"],
        });
        assert.equal(parseSaved({ nope: 1 }), null);
        assert.equal(parseSaved("x"), null);
    });

    it("line nodes are addressable by key", () => {
        const { model } = setup();
        const key = at(node(model, webId).units, 0);
        assert.equal(node(model, lineNodeId(key)).level, 2);
    });
});
