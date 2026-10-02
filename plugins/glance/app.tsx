// bb-plugin-glance — frontend entry.
//
// One surface: a "Pair Glance" button on the plugin's settings page, so
// pairing needs neither a terminal nor the token. The server mints a one-time
// link and opens it on the Mac bb runs on; the link is also shown, for a bb UI
// opened somewhere Glance isn't.
import { useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

type Pairing = { link: string; server: string; expiresAt: number; opened: boolean };

function PairGlance() {
  const rpc = useRpc<typeof rpcContract>();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pair() {
    setBusy(true);
    setProblem(null);
    try {
      setPairing(await rpc.call("glance_pair", {}));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not make a pairing link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">
        Connects the Glance Mac app to this bb. The link works once, for two minutes, and never
        contains the token itself.
      </p>
      <button
        type="button"
        onClick={pair}
        disabled={busy}
        className="rounded-md border border-input px-2 py-1 text-xs hover:bg-state-hover disabled:opacity-50"
      >
        {busy ? "Making a link…" : "Pair Glance"}
      </button>
      {pairing && (
        <div className="flex flex-col gap-1 text-xs">
          <p>
            {pairing.opened
              ? "Opened Glance on this Mac. If nothing happened, open Glance first, or use the link:"
              : "Open this link on the Mac running Glance:"}
          </p>
          <a href={pairing.link} className="break-all font-mono text-[11px] underline">
            {pairing.link}
          </a>
          <p className="text-[11px] text-muted-foreground">
            Points at {pairing.server}. Expires at {new Date(pairing.expiresAt).toLocaleTimeString()}.
          </p>
        </div>
      )}
      {problem && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "pair-glance",
    title: "Pair a Mac",
    description: "Show what needs you in the Glance widget, menu bar and Shortcuts.",
    component: PairGlance,
  });
});
