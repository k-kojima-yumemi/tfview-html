import { writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { projectId } from "./hash.ts";
import { renderHtml } from "./render.ts";
import { loadPlan } from "./show.ts";
import { buildTree, type PlanJson } from "./tree.ts";
import type { ViewData } from "./types.ts";

export interface GenerateOptions {
  planfile: string;
  out: string;
  bin: string;
  cwd: string;
  showSensitive?: boolean;
}

export interface ViewDataOptions {
  cwd: string;
  source: string;
  showSensitive?: boolean;
  now?: Date;
}

export function buildViewData(plan: PlanJson, opts: ViewDataOptions): ViewData {
  const data: ViewData = {
    version: 1,
    projectId: projectId(resolve(opts.cwd)),
    generatedAt: (opts.now ?? new Date()).toISOString(),
    source: opts.source,
    modules: buildTree(plan, { showSensitive: opts.showSensitive ?? false }),
  };
  if (plan.terraform_version) data.terraformVersion = plan.terraform_version;
  if (opts.showSensitive) data.showSensitive = true;
  return data;
}

/** Reads the plan, writes the HTML and returns its absolute path. */
export async function generate(opts: GenerateOptions): Promise<{ path: string; data: ViewData }> {
  const plan = await loadPlan(opts.planfile, { bin: opts.bin, cwd: opts.cwd });
  const data = buildViewData(plan, {
    cwd: opts.cwd,
    source: basename(opts.planfile),
    showSensitive: opts.showSensitive ?? false,
  });
  const path = resolve(opts.cwd, opts.out);
  await writeFile(path, await renderHtml(data), "utf8");
  return { path, data };
}
