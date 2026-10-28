import { spawn } from "node:child_process";
import { type FileHandle, open, readFile } from "node:fs/promises";
import type { PlanJson } from "./tree.ts";

export type InputKind = "binary" | "json";

/** Thrown for problems the user can fix; the CLI prints the message (and hint) without a stack trace. */
export class UserError extends Error {
    readonly hint: string | undefined;
    constructor(message: string, hint?: string) {
        super(message);
        this.name = "UserError";
        this.hint = hint;
    }
}

/** Binary plans are zip files (`PK`); JSON plans start with `{` (after optional BOM / whitespace). */
export function detectKind(head: Uint8Array): InputKind | undefined {
    if (head[0] === 0x50 && head[1] === 0x4b) return "binary";
    let i = 0;
    if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) i = 3;
    while (isWhitespace(head[i])) i++;
    if (head[i] === 0x7b) return "json";
    return undefined;
}

function isWhitespace(byte: number | undefined): boolean {
    return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

async function readHead(path: string, bytes = 64): Promise<Uint8Array> {
    let fh: FileHandle;
    try {
        fh = await open(path, "r");
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        throw new UserError(
            code === "ENOENT"
                ? `${path}: file not found`
                : `${path}: cannot read file (${code})`,
        );
    }
    try {
        const buf = Buffer.alloc(bytes);
        const { bytesRead } = await fh.read(buf, 0, bytes, 0);
        return buf.subarray(0, bytesRead);
    } finally {
        await fh.close();
    }
}

/** The `<planfile>` value that means "read the plan JSON from stdin". */
export const STDIN = "-";

async function readStdin(stdin: NodeJS.ReadableStream): Promise<string> {
    if ((stdin as NodeJS.ReadStream).isTTY) {
        throw new UserError(
            "stdin: no input is piped in",
            "Pipe the plan JSON in, e.g. `terraform show -json tfplan | tfview -`",
        );
    }
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const buf = Buffer.concat(chunks);
    const kind = detectKind(buf.subarray(0, 64));
    if (kind === "binary") {
        throw new UserError(
            "stdin: a binary plan cannot be read from stdin",
            "Pipe the output of `terraform show -json tfplan`, or pass the plan file path instead of `-`",
        );
    }
    if (kind === undefined) {
        throw new UserError(
            "stdin: not recognized as plan JSON",
            "Pipe the output of `terraform show -json tfplan`",
        );
    }
    return buf.toString("utf8");
}

export interface LoadOptions {
    /** Terraform-compatible command, e.g. `terraform` or `tofu`. */
    bin: string;
    /** Directory to run `show` in. It must be initialized (`.terraform` present). */
    cwd: string;
    /** Read when `planfile` is `-`. Default: `process.stdin`. */
    stdin?: NodeJS.ReadableStream;
}

export async function loadPlan(
    planfile: string,
    opts: LoadOptions,
): Promise<PlanJson> {
    if (planfile === STDIN) {
        return parsePlan(await readStdin(opts.stdin ?? process.stdin), "stdin");
    }
    const kind = detectKind(await readHead(planfile));
    if (kind === undefined) {
        throw new UserError(
            `${planfile}: not recognized as a plan file`,
            "Pass a binary plan from `terraform plan -out=tfplan`, or the output of `terraform show -json`",
        );
    }
    const text =
        kind === "json"
            ? await readFile(planfile, "utf8")
            : await terraformShow(planfile, opts);
    return parsePlan(text, planfile);
}

export function parsePlan(text: string, source: string): PlanJson {
    let plan: unknown;
    try {
        plan = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (err) {
        throw new UserError(
            `${source}: not valid JSON (${(err as Error).message})`,
        );
    }
    if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
        throw new UserError(`${source}: not in plan JSON format`);
    }
    if (
        "resource_changes" in plan &&
        !Array.isArray((plan as PlanJson).resource_changes)
    ) {
        throw new UserError(`${source}: resource_changes is not an array`);
    }
    return plan as PlanJson;
}

function terraformShow(
    planfile: string,
    { bin, cwd }: LoadOptions,
): Promise<string> {
    return new Promise((resolve, reject) => {
        // stderr is passed through untouched so the user sees Terraform's own message.
        const child = spawn(bin, ["show", "-json", planfile], {
            cwd,
            stdio: ["ignore", "pipe", "inherit"],
            windowsHide: true,
        });
        const chunks: Buffer[] = [];
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.on("error", (err: NodeJS.ErrnoException) => {
            reject(
                err.code === "ENOENT"
                    ? new UserError(
                          `\`${bin}\` not found`,
                          "Install Terraform, or name the command with `--bin` (e.g. --bin tofu)",
                      )
                    : new UserError(
                          `cannot run \`${bin} show -json\`: ${err.message}`,
                      ),
            );
        });
        child.on("close", (code, signal) => {
            if (code === 0)
                return resolve(Buffer.concat(chunks).toString("utf8"));
            reject(
                new UserError(
                    `\`${bin} show -json ${planfile}\` failed (${signal ?? `exit ${code}`})`,
                    "Run it in the same directory where the plan was created, after `terraform init`",
                ),
            );
        });
    });
}
