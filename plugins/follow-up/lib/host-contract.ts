// The one thing this plugin asks of a host: run a command destination there.
//
// Shared by the host entry (host.ts), which runs on every enrolled host's
// daemon, and the server, which calls it on the host a thread lives on. A
// command destination runs where the thread's checkout is, so a thread on a
// remote machine files from that machine, with that machine's tools.
import { z } from "zod";
import { DESTINATION_BODY_MAX } from "./destinations.ts";

/** How much of each stream comes back. A ref is near the start; an error near the end. */
export const OUTPUT_MAX = 16_000;
/** One command, one row: long enough for a slow network, short of a hang. */
export const COMMAND_TIMEOUT_MS = 120_000;

export const hostContract = {
  run_command: {
    input: z
      .object({
        command: z.string().min(1).max(DESTINATION_BODY_MAX),
        cwd: z.string().min(1).max(4096),
        env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(20_000)),
        stdin: z.string().max(40_000),
        timeoutMs: z.number().int().min(1000).max(600_000),
      })
      .strict(),
    output: z
      .object({
        /** Null when it never ran, or was killed. */
        exitCode: z.number().int().nullable(),
        /** The first OUTPUT_MAX characters. */
        stdout: z.string(),
        /** The last OUTPUT_MAX characters. */
        stderr: z.string(),
        timedOut: z.boolean(),
      })
      .strict(),
  },
} as const;

export type RunCommandInput = z.infer<typeof hostContract.run_command.input>;
export type RunCommandOutput = z.infer<typeof hostContract.run_command.output>;
