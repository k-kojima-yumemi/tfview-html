#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { generate } from "../src/generate.ts";
import { UserError } from "../src/show.ts";

const usage = `Usage: tfview <planfile> [options]

  <planfile>        binary plan (terraform plan -out=tfplan) or the output of terraform show -json;
                    - reads the JSON from stdin (terraform show -json tfplan | tfview -)

Options:
  -o, --out <path>  output path (default: ./tfview.html)
      --bin <name>  Terraform command to run (default: terraform, e.g. tofu)
      --no-open     generate only; do not open the browser
      --show-sensitive
                    embed and show sensitive values in the HTML (default: off; handle the HTML with care)
  -h, --help        show this help
  -v, --version     show the version`;

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
                "Could not open the browser. Open the file above directly.",
            ),
        );
        child.unref();
    } catch {
        console.error(
            "Could not open the browser. Open the file above directly.",
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
            `${positionals.length === 0 ? "tfview: <planfile> is required" : "tfview: exactly one <planfile> is allowed"}\n\n${usage}`,
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
                "warning: --show-sensitive: this HTML contains sensitive values in plain text; be careful when sharing or committing it",
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
