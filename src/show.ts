import { spawn } from "node:child_process";
import { open, readFile } from "node:fs/promises";
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
  while (i < head.length && [0x20, 0x09, 0x0a, 0x0d].includes(head[i]!)) i++;
  if (head[i] === 0x7b) return "json";
  return undefined;
}

async function readHead(path: string, bytes = 64): Promise<Uint8Array> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new UserError(
      code === "ENOENT" ? `${path}: ファイルが見つかりません` : `${path}: 読み込めません (${code})`,
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

export interface LoadOptions {
  /** Terraform-compatible command, e.g. `terraform` or `tofu`. */
  bin: string;
  /** Directory to run `show` in. It must be initialized (`.terraform` present). */
  cwd: string;
}

export async function loadPlan(planfile: string, opts: LoadOptions): Promise<PlanJson> {
  const kind = detectKind(await readHead(planfile));
  if (kind === undefined) {
    throw new UserError(
      `${planfile}: plan ファイルとして認識できません`,
      "`terraform plan -out=tfplan` のバイナリ plan か、`terraform show -json` の出力を渡してください",
    );
  }
  const text = kind === "json" ? await readFile(planfile, "utf8") : await terraformShow(planfile, opts);
  return parsePlan(text, planfile);
}

export function parsePlan(text: string, source: string): PlanJson {
  let plan: unknown;
  try {
    plan = JSON.parse(text.replace(/^﻿/, ""));
  } catch (err) {
    throw new UserError(`${source}: JSON として読めません (${(err as Error).message})`);
  }
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    throw new UserError(`${source}: plan JSON の形式ではありません`);
  }
  if ("resource_changes" in plan && !Array.isArray((plan as PlanJson).resource_changes)) {
    throw new UserError(`${source}: resource_changes が配列ではありません`);
  }
  return plan as PlanJson;
}

function terraformShow(planfile: string, { bin, cwd }: LoadOptions): Promise<string> {
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
          ? new UserError(`\`${bin}\` が見つかりません`, "Terraform をインストールするか、`--bin` でコマンドを指定してください (例: --bin tofu)")
          : new UserError(`\`${bin} show -json\` を実行できません: ${err.message}`),
      );
    });
    child.on("close", (code, signal) => {
      if (code === 0) return resolve(Buffer.concat(chunks).toString("utf8"));
      reject(
        new UserError(
          `\`${bin} show -json ${planfile}\` が失敗しました (${signal ?? `exit ${code}`})`,
          "plan を作成したのと同じ、`terraform init` 済みのディレクトリで実行してください",
        ),
      );
    });
  });
}
