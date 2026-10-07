// bb-plugin-follow-up — host entry.
//
// Runs on each enrolled host's daemon. Its one job is a command destination:
// run the user's command in a thread's checkout, on the machine that checkout
// is on, and hand back what it printed. See lib/host-contract.ts.
import { spawn } from "node:child_process";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  hostContract,
  OUTPUT_MAX,
  type RunCommandInput,
  type RunCommandOutput,
} from "./lib/host-contract.ts";

/** How long a command asked to stop has before it is made to. */
const KILL_GRACE_MS = 2000;

/**
 * Run one command.
 *
 * In the user's login shell, so the tools a person runs in a terminal — `gh`,
 * `jira`, whatever their PATH holds — are there. The row arrives in `env` and
 * on stdin; the command text is the user's own, from their settings, and is
 * the only thing the shell parses.
 */
export function runCommand(input: RunCommandInput, signal: AbortSignal): Promise<RunCommandOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      resolve({ exitCode, stdout: stdout.slice(0, OUTPUT_MAX), stderr: stderr.slice(-OUTPUT_MAX), timedOut });
    };

    const shell = process.env.SHELL && process.env.SHELL !== "" ? process.env.SHELL : "/bin/sh";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ["-lc", input.command], {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      stderr = String(error);
      finish(null);
      return;
    }

    const stop = () => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
    signal.addEventListener("abort", stop, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    // Bounded as it arrives: a command that prints forever must not hold the
    // whole of it in memory to be cut afterwards.
    child.stdout?.on("data", (chunk: string) => {
      if (stdout.length < OUTPUT_MAX) stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-OUTPUT_MAX);
    });
    child.on("error", (error) => {
      stderr = `${stderr}${String(error)}`.slice(-OUTPUT_MAX);
      finish(null);
    });
    child.on("close", (code) => finish(timedOut ? null : code));
    // A command that never reads stdin closes it early; that is not an error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input.stdin);
  });
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    run_command: (input, context) => runCommand(input, context.signal),
  },
});
