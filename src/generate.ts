import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { namedProjectId, projectId } from "./hash.ts";
import { renderHtml } from "./render.ts";
import { loadPlan, STDIN, UserError } from "./show.ts";
import { buildTree, type PlanJson } from "./tree.ts";
import type { ViewData } from "./types.ts";

/** The `--out` value that means "write the HTML to stdout". */
export const STDOUT = "-";

export interface GenerateOptions {
    planfile: string;
    /** Output path, or `-` for stdout. */
    out: string;
    bin: string;
    cwd: string;
    showSensitive?: boolean;
    /** `--project-id`: names the saved state instead of the current directory. */
    projectName?: string | undefined;
    /** Written to when `out` is `-`. Default: `process.stdout`. */
    stdout?: NodeJS.WritableStream;
}

export interface ViewDataOptions {
    cwd: string;
    source: string;
    showSensitive?: boolean;
    projectName?: string | undefined;
    now?: Date;
}

export function buildViewData(plan: PlanJson, opts: ViewDataOptions): ViewData {
    const data: ViewData = {
        version: 1,
        projectId:
            opts.projectName === undefined
                ? projectId(resolve(opts.cwd))
                : namedProjectId(opts.projectName),
        generatedAt: (opts.now ?? new Date()).toISOString(),
        source: opts.source,
        modules: buildTree(plan, {
            showSensitive: opts.showSensitive ?? false,
        }),
    };
    if (plan.terraform_version) data.terraformVersion = plan.terraform_version;
    if (opts.showSensitive) data.showSensitive = true;
    return data;
}

function writeAll(stream: NodeJS.WritableStream, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // Listening for "error" keeps a closed pipe (EPIPE) from crashing the process.
        const onError = (err: NodeJS.ErrnoException) =>
            reject(
                new UserError(
                    `stdout: cannot write the HTML (${err.code ?? err.message})`,
                ),
            );
        stream.once("error", onError);
        stream.write(text, (err) => {
            stream.off("error", onError);
            if (err) onError(err);
            else resolve();
        });
    });
}

/** Reads the plan and writes the HTML. `path` is its absolute path, or undefined when written to stdout. */
export async function generate(
    opts: GenerateOptions,
): Promise<{ path: string | undefined; data: ViewData }> {
    const plan = await loadPlan(opts.planfile, {
        bin: opts.bin,
        cwd: opts.cwd,
    });
    const data = buildViewData(plan, {
        cwd: opts.cwd,
        source: opts.planfile === STDIN ? "stdin" : basename(opts.planfile),
        showSensitive: opts.showSensitive ?? false,
        projectName: opts.projectName,
    });
    const html = await renderHtml(data);
    if (opts.out === STDOUT) {
        await writeAll(opts.stdout ?? process.stdout, html);
        return { path: undefined, data };
    }
    const path = resolve(opts.cwd, opts.out);
    await writeFile(path, html, "utf8");
    return { path, data };
}
