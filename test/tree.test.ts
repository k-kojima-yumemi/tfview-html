// biome-ignore-all lint/style/useNamingConvention: plans in these tests use Terraform's JSON field and attribute names
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
    badgeFor,
    buildTree,
    expandLines,
    expandResource,
    formatPath,
    rootModule,
} from "../src/tree.ts";
import type { DisplayItem, ReorderView } from "../src/types.ts";
import { at, findResource, lineAtPath, loadFixture } from "./helpers.ts";

const tree = buildTree(loadFixture());
const summary = (address: string) =>
    findResource(tree, address).lines.map((l) => `${l.op} ${l.path}`);

describe("buildTree", () => {
    it("groups resources by module_address, root first", () => {
        assert.deepEqual(
            tree.map((m) => m.address),
            [rootModule, "module.app", "module.app.module.sub"],
        );
    });

    it("drops no-op resources", () => {
        const addresses = tree.flatMap((m) =>
            m.resources.map((r) => r.address),
        );
        assert.ok(!addresses.includes('terraform_data.subnet["a"]'));
        assert.ok(addresses.includes('terraform_data.subnet["b"]'));
    });

    it("drops read actions", () => {
        const modules = buildTree({
            resource_changes: [
                {
                    address: "data.x.y",
                    change: { actions: ["read"], before: null, after: {} },
                },
            ],
        });
        assert.deepEqual(modules, []);
    });

    it("assigns action badges", () => {
        assert.equal(findResource(tree, "terraform_data.ami").badge, "-/+");
        assert.equal(findResource(tree, "terraform_data.legacy[0]").badge, "-");
        assert.equal(findResource(tree, "terraform_data.new[0]").badge, "+");
        assert.equal(findResource(tree, "terraform_data.web").badge, "~");
        assert.equal(badgeFor(["create", "delete"]), "-/+");
        assert.equal(badgeFor(["forget"]), "forget");
    });
});

describe("expandLines", () => {
    it("create: every leaf of after is a + line, unknowns included", () => {
        assert.deepEqual(summary("terraform_data.new[0]"), [
            "+ id",
            "+ input.depends",
            "+ input.name",
            "+ output",
        ]);
        const id = at(findResource(tree, "terraform_data.new[0]").lines, 0);
        assert.equal(id.unknown, true);
        assert.equal(id.after, undefined);
    });

    it("delete: every leaf of before is a - line", () => {
        assert.deepEqual(summary("terraform_data.legacy[0]"), [
            "- id",
            "- input.name",
            "- input.size",
            "- output.name",
            "- output.size",
        ]);
        const size = at(
            findResource(tree, "terraform_data.legacy[0]").lines,
            2,
        );
        assert.equal(size.before, "10");
        assert.equal(size.after, undefined);
    });

    it("update: only changed leaves, as before -> after", () => {
        const lines = findResource(tree, "terraform_data.web").lines;
        assert.deepEqual(
            lines.map((l) => `${l.op} ${l.path}`),
            ["~ input.instance_type", "~ input.password", "~ output"],
        );
        assert.equal(at(lines, 0).before, '"t3.small"');
        assert.equal(at(lines, 0).after, '"t3.medium"');
    });

    it("replace: marks attributes in replace_paths", () => {
        const lines = findResource(tree, "terraform_data.ami").lines;
        const forced = lines
            .filter((l) => l.forcesReplacement)
            .map((l) => l.path);
        assert.deepEqual(forced, ["triggers_replace"]);
    });

    it("unknown after: shows (known after apply) without an after value", () => {
        const output = lineAtPath(
            findResource(tree, "module.app.module.sub.terraform_data.queue"),
            "output",
        );
        assert.equal(output.unknown, true);
        assert.equal(output.after, undefined);
        assert.equal(output.before, '{"name":"queue","visibility":30}');
    });

    it("for_each and nested modules keep the full address", () => {
        assert.ok(findResource(tree, 'terraform_data.subnet["d"]'));
        assert.ok(
            findResource(tree, "module.app.module.sub.terraform_data.queue"),
        );
    });

    it("formats nested paths with dots and indexes", () => {
        const lines = expandLines("x.y", {
            actions: ["update"],
            before: {
                ingress: [{ cidr_blocks: ["10.0.0.0/16", "10.1.0.0/16"] }],
                tags: { "kubernetes.io/role": "a" },
            },
            after: {
                ingress: [{ cidr_blocks: ["10.0.0.0/16", "10.2.0.0/16"] }],
                tags: { "kubernetes.io/role": "b" },
            },
        });
        assert.deepEqual(
            lines.map((l) => l.path),
            ["ingress[0].cidr_blocks[1]", 'tags["kubernetes.io/role"]'],
        );
        assert.equal(formatPath([]), "");
    });

    it("update: added and removed leaves become + and - lines", () => {
        const lines = expandLines("x.y", {
            actions: ["update"],
            before: { tags: { a: "1", b: "2" } },
            after: { tags: { a: "1", c: "3" } },
        });
        assert.deepEqual(
            lines.map((l) => `${l.op} ${l.path}`),
            ["- tags.b", "+ tags.c"],
        );
    });

    it("treats null and absent as the same", () => {
        const lines = expandLines("x.y", {
            actions: ["update"],
            before: { a: null, b: 1 },
            after: { b: 1 },
        });
        assert.deepEqual(lines, []);
    });

    it("shows empty containers on create", () => {
        const lines = expandLines("x.y", {
            actions: ["create"],
            before: null,
            after: { tags: {}, list: [] },
        });
        assert.deepEqual(
            lines.map((l) => `${l.path}=${l.after}`),
            ["list=[]", "tags={}"],
        );
    });

    it("treats a sensitive container as a single masked leaf", () => {
        const lines = expandLines("x.y", {
            actions: ["create"],
            before: null,
            after: { env: { A: "secret-a", B: "secret-b" } },
            after_sensitive: { env: true },
        });
        assert.equal(lines.length, 1);
        assert.equal(at(lines, 0).path, "env");
        assert.equal(at(lines, 0).sensitive, true);
        assert.equal(at(lines, 0).after, undefined);
    });
});

describe("sensitive values", () => {
    const values = tree.flatMap((m) =>
        m.resources.flatMap((r) => r.lines.flatMap((l) => [l.before, l.after])),
    );

    it("never appear in the tree", () => {
        for (const v of values)
            assert.ok(!v?.includes("hunter2"), `leaked: ${v}`);
    });

    it("are embedded, still flagged, with showSensitive", () => {
        const shown = buildTree(loadFixture(), { showSensitive: true });
        const password = lineAtPath(
            findResource(shown, "terraform_data.web"),
            "input.password",
        );
        assert.equal(password.sensitive, true);
        assert.equal(password.before, '"hunter2-OLD-secret"');
        assert.equal(password.after, '"hunter2-NEW-secret"');
    });

    it("produce the same keys with or without showSensitive", () => {
        const keys = (t: typeof tree) =>
            t.flatMap((m) =>
                m.resources.flatMap((r) => r.lines.map((l) => l.key)),
            );
        assert.deepEqual(
            keys(buildTree(loadFixture(), { showSensitive: true })),
            keys(tree),
        );
    });

    it("are masked even where Terraform dropped the sensitive mark", () => {
        // terraform_data copies `input` to `output` without carrying the mark.
        const output = lineAtPath(
            findResource(tree, "terraform_data.web"),
            "output",
        );
        assert.equal(output.sensitive, true);
        assert.equal(output.before, undefined);
    });
});

/** Terraform-plan-like text of the layout, for readable assertions. */
function layout(items: DisplayItem[], depth = 0): string[] {
    const pad = "  ".repeat(depth);
    return items.flatMap((it): string[] => {
        if (it.t === "line") return [`${pad}line ${it.label ?? "(element)"}`];
        if (it.t === "ctx") return [`${pad}ctx ${it.label}`];
        if (it.t === "reorder") {
            const view = (name: string, v: ReorderView) => [
                `${pad}${name}`,
                ...layout(v.items, depth + 1),
                ...(v.hidden
                    ? [`${pad}  hidden ${JSON.stringify(v.hidden)}`]
                    : []),
            ];
            return [
                `${pad}reorder ${it.label}`,
                ...view("by position", it.base),
                ...it.options.flatMap((o) => view(`by ${o.field}`, o.view)),
            ];
        }
        const head =
            it.style === "block"
                ? `${it.label} {`
                : `${it.label ?? ""}${it.style === "list" ? "[" : "{"}`;
        const hidden = it.hidden
            ? [`${pad}  hidden ${JSON.stringify(it.hidden)}`]
            : [];
        return [
            `${pad}${it.op} ${head}`,
            ...layout(it.items, depth + 1),
            ...hidden,
        ];
    });
}

describe("display layout", () => {
    it("nests lines under their maps, with id as context", () => {
        const web = findResource(tree, "terraform_data.web");
        assert.deepEqual(layout(web.display), [
            "ctx id",
            "~ input{",
            "  line instance_type",
            "  line password",
            '  hidden {"blocks":1,"elements":1}',
            "line output",
        ]);
    });

    it("renders a list of objects as repeated blocks and counts unchanged ones", () => {
        const { display, hidden } = expandResource("aws_security_group.x", {
            actions: ["update"],
            before: {
                id: "sg-1",
                name: "x",
                description: "d",
                ingress: [
                    { port: 80, cidr: ["a"] },
                    { port: 443, cidr: ["b"] },
                ],
            },
            after: {
                id: "sg-1",
                name: "x",
                description: "d",
                ingress: [
                    { port: 80, cidr: ["a"] },
                    { port: 8443, cidr: ["b", "c"] },
                ],
            },
        });
        assert.deepEqual(layout(display), [
            "ctx id",
            "ctx name",
            "~ ingress {",
            "  ~ cidr[",
            "    line (element)",
            '    hidden {"elements":1}',
            "  line port",
        ]);
        assert.deepEqual(hidden, { attributes: 1, blocks: 1 });
    });

    it("counts unchanged map entries as elements", () => {
        const { display } = expandResource("x.y", {
            actions: ["update"],
            before: { tags: { a: "1", b: "2" } },
            after: { tags: { a: "1", b: "2", Name: "n" } },
        });
        assert.deepEqual(layout(display), [
            "~ tags{",
            "  line Name",
            '  hidden {"elements":2}',
        ]);
    });

    it("places every line exactly once", () => {
        const indexes = (items: DisplayItem[]): number[] =>
            items.flatMap((it) =>
                it.t === "line"
                    ? [it.i]
                    : it.t === "group"
                      ? indexes(it.items)
                      : it.t === "reorder"
                        ? [it.base, ...it.options.map((o) => o.view)].flatMap(
                              (v) => indexes(v.items),
                          )
                        : [],
            );
        for (const m of tree) {
            for (const r of m.resources) {
                assert.deepEqual(
                    indexes(r.display),
                    r.lines.map((_, i) => i),
                    r.address,
                );
            }
        }
    });

    it("does not show a masked value as context", () => {
        const { display } = expandResource("x.y", {
            actions: ["update"],
            before: { id: "secret-id", v: 1 },
            after: { id: "secret-id", v: 2 },
            before_sensitive: { id: true },
            after_sensitive: { id: true },
        });
        assert.deepEqual(layout(display), ["line v"]);
    });
});

describe("reorderable lists", () => {
    const vars = (names: [string, string][]) =>
        names.map(([name, value]) => ({ name, value, type: "PLAINTEXT" }));
    const change = (
        before: [string, string][],
        after: [string, string][],
        extra: Partial<Parameters<typeof expandResource>[1]> = {},
    ) =>
        expandResource("aws_codebuild_project.p", {
            actions: ["update"],
            before: { id: "p", environment: [{ var: vars(before) }] },
            after: { id: "p", environment: [{ var: vars(after) }] },
            ...extra,
        });
    /** The `var` list's reorder item. */
    const reorder = (e: ReturnType<typeof change>) => {
        const env = e.display.find((it) => it.t === "group");
        assert.ok(env && env.t === "group");
        const item = env.items.find((it) => it.t === "reorder");
        assert.ok(item && item.t === "reorder", "no reorder item");
        return item;
    };

    it("offers matching by a field when the order differs, and shows only real changes", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
                ["C", "3"],
            ],
            [
                ["C", "3"],
                ["A", "1"],
                ["B", "9"],
            ],
        );
        const item = reorder(e);
        // `value` is unique too, so it is offered as well; `type` is the same everywhere and is not.
        assert.deepEqual(
            item.options.map((o) => o.field),
            ["name", "value"],
        );
        // By position every element differs; by name only B changed.
        assert.equal(item.base.items.length, 3);
        const byName = at(item.options, 0).view;
        assert.equal(byName.items.length, 1);
        assert.deepEqual(byName.hidden, { blocks: 2 });
        const paths = e.lines.map((l) => l.path);
        assert.ok(paths.includes('environment[0].var[name="B"].value'));
    });

    it("shows the matching field in each block, not counted as hidden", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["B", "9"],
                ["A", "1"],
            ],
        );
        const item = reorder(e);
        const byName = item.options.find((o) => o.field === "name");
        assert.ok(byName);
        assert.deepEqual(layout(byName.view.items), [
            "~ var {",
            "  ctx name",
            "  line value",
            '  hidden {"attributes":1}',
        ]);
        // By position there is nothing to orient by, so `name` is an ordinary change.
        assert.ok(
            layout(item.base.items).every((row) => !row.includes("ctx name")),
        );
    });

    it("pairs added and removed elements by field value", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["N", "n"],
                ["A", "1"],
            ],
        );
        const byName = at(reorder(e).options, 0).view;
        const ops = e.lines.filter((l) => l.path.includes("[name="));
        assert.deepEqual(
            ops.map((l) => `${l.op} ${l.path}`).sort(),
            [
                '+ environment[0].var[name="N"].name',
                '+ environment[0].var[name="N"].type',
                '+ environment[0].var[name="N"].value',
                '- environment[0].var[name="B"].name',
                '- environment[0].var[name="B"].type',
                '- environment[0].var[name="B"].value',
            ].sort(),
        );
        assert.deepEqual(byName.hidden, { blocks: 1 });
    });

    it("does not offer it for a list that only grew at the end", () => {
        const e = change(
            [["A", "1"]],
            [
                ["A", "1"],
                ["B", "2"],
            ],
        );
        const env = e.display.find((it) => it.t === "group");
        assert.ok(env && env.t === "group");
        assert.ok(!env.items.some((it) => it.t === "reorder"));
    });

    it("does not offer it for a list whose elements only changed in place", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["A", "1"],
                ["C", "2"],
            ],
        );
        const env = e.display.find((it) => it.t === "group");
        assert.ok(env && env.t === "group");
        assert.ok(!env.items.some((it) => it.t === "reorder"));
    });

    it("does not offer a field with duplicate, unknown or masked values", () => {
        const dup = change(
            [
                ["A", "1"],
                ["A", "2"],
            ],
            [
                ["A", "2"],
                ["A", "1"],
            ],
        );
        const env = dup.display.find((it) => it.t === "group");
        assert.ok(env && env.t === "group");
        // `value` is unique and differs by position, so only it is offered.
        assert.deepEqual(
            env.items.flatMap((it) =>
                it.t === "reorder" ? it.options.map((o) => o.field) : [],
            ),
            ["value"],
        );

        const masked = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["B", "2"],
                ["A", "1"],
            ],
            {
                before_sensitive: {
                    environment: [{ var: [{ name: true }, { name: true }] }],
                },
                after_sensitive: {
                    environment: [{ var: [{ name: true }, { name: true }] }],
                },
            },
        );
        assert.ok(
            !reorder(masked).options.some((o) => o.field === "name"),
            "a masked field must not be a key",
        );

        const unknown = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["B", "2"],
                ["A", "1"],
            ],
            { after_unknown: { environment: [{ var: [{ name: true }, {}] }] } },
        );
        assert.ok(!reorder(unknown).options.some((o) => o.field === "name"));
    });

    it("keeps forces replacement for elements matched by field", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["B", "3"],
                ["A", "1"],
            ],
            { replace_paths: [["environment", 0, "var", 0, "value"]] },
        );
        const line = e.lines.find((l) => l.path.endsWith('[name="B"].value'));
        assert.ok(line?.forcesReplacement);
    });

    it("gives lines of the two views different keys", () => {
        const e = change(
            [
                ["A", "1"],
                ["B", "2"],
            ],
            [
                ["B", "3"],
                ["A", "1"],
            ],
        );
        const keys = e.lines.map((l) => l.key);
        assert.equal(new Set(keys).size, keys.length);
    });
});

describe("imports", () => {
    const imported = (
        actions: string[],
        importing: { id?: string; identity?: unknown },
        after: unknown = { id: "pg-1", family: "valkey9" },
    ) =>
        buildTree({
            resource_changes: [
                {
                    address: "aws_elasticache_parameter_group.main",
                    change: {
                        actions,
                        before: { id: "pg-1", family: "valkey8" },
                        after,
                        importing,
                    },
                },
            ],
        });

    it("keeps the import source on an imported update", () => {
        const res = findResource(
            imported(["update"], { id: "custom-valkey9" }),
            "aws_elasticache_parameter_group.main",
        );
        assert.equal(res.badge, "~");
        assert.equal(res.importing, "custom-valkey9");
        assert.deepEqual(
            res.lines.map((l) => l.path),
            ["family"],
        );
    });

    it("shows an import without changes instead of dropping it as a no-op", () => {
        const res = findResource(
            imported(
                ["no-op"],
                { id: "custom-valkey9" },
                { id: "pg-1", family: "valkey8" },
            ),
            "aws_elasticache_parameter_group.main",
        );
        assert.equal(res.badge, "import");
        assert.equal(res.importing, "custom-valkey9");
        assert.deepEqual(res.lines, []);
    });

    it("uses the identity when there is no import ID", () => {
        const res = findResource(
            imported(["no-op"], { identity: { name: "pg", account_id: "1" } }),
            "aws_elasticache_parameter_group.main",
        );
        assert.equal(res.importing, '{"account_id":"1","name":"pg"}');
    });

    it("gives a different resourceKey for a different import source", () => {
        const a = findResource(
            imported(["no-op"], { id: "a" }),
            "aws_elasticache_parameter_group.main",
        );
        const b = findResource(
            imported(["no-op"], { id: "b" }),
            "aws_elasticache_parameter_group.main",
        );
        assert.notEqual(a.resourceKey, b.resourceKey);
    });
});
