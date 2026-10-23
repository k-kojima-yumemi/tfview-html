#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { generate } from "../src/generate.ts";
import { UserError } from "../src/show.ts";

const usage = `Usage: tfview <planfile> [options]

  <planfile>        バイナリ plan (terraform plan -out=tfplan) または terraform show -json の出力

Options:
  -o, --out <path>  出力先 (既定: ./tfview.html)
      --bin <name>  Terraform のコマンド (既定: terraform。例: tofu)
      --no-open     生成のみで、ブラウザを開かない
      --show-sensitive
                    sensitive な値も HTML に埋め込んで表示する (既定: OFF。HTML の扱いに注意)
  -h, --help        このヘルプを表示
  -v, --version     バージョンを表示`;

function openInBrowser(path: string): void {
    const [cmd, args] =
        process.platform === "darwin"
            ? ["open", [path]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", '""', `"${path}"`]]
              : ["xdg-open", [path]];
    try {
        const child = spawn(cmd, args, {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            windowsVerbatimArguments: process.platform === "win32",
        });
        child.on("error", () =>
            console.error(
                "ブラウザを開けませんでした。上のファイルを直接開いてください。",
            ),
        );
        child.unref();
    } catch {
        console.error(
            "ブラウザを開けませんでした。上のファイルを直接開いてください。",
        );
    }
}

function parseCli(argv: string[]) {
    return parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            out: { type: "string", short: "o", default: "tfview.html" },
            bin: { type: "string", default: "terraform" },
            "no-open": { type: "boolean", default: false },
            "show-sensitive": { type: "boolean", default: false },
            help: { type: "boolean", short: "h", default: false },
            version: { type: "boolean", short: "v", default: false },
        },
    });
}

async function main(argv: string[]): Promise<number> {
    let parsed: ReturnType<typeof parseCli>;
    try {
        parsed = parseCli(argv);
    } catch (err) {
        console.error(`tfview: ${(err as Error).message}\n\n${usage}`);
        return 2;
    }
    const { values, positionals } = parsed;

    if (values.help) {
        console.log(usage);
        return 0;
    }
    if (values.version) {
        console.log(pkg.version);
        return 0;
    }
    const [planfile] = positionals;
    if (planfile === undefined || positionals.length !== 1) {
        console.error(
            `${positionals.length === 0 ? "tfview: <planfile> を指定してください" : "tfview: <planfile> は1つだけ指定してください"}\n\n${usage}`,
        );
        return 2;
    }

    try {
        const { path } = await generate({
            planfile,
            out: values.out,
            bin: values.bin,
            cwd: process.cwd(),
            showSensitive: values["show-sensitive"],
        });
        console.log(path);
        if (values["show-sensitive"]) {
            console.error(
                "warning: --show-sensitive: この HTML には sensitive な値が平文で含まれます。共有やコミットに注意してください",
            );
        }
        if (!values["no-open"]) openInBrowser(path);
        return 0;
    } catch (err) {
        if (err instanceof UserError) {
            console.error(`tfview: ${err.message}`);
            if (err.hint) console.error(`hint: ${err.hint}`);
            return 1;
        }
        throw err;
    }
}

process.exitCode = await main(process.argv.slice(2));
