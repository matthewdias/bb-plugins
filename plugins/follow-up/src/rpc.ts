// A place for callbacks to find an RPC client.
//
// `useRpc` is a hook, so registration callbacks — a messageAction's `run` —
// cannot obtain a client themselves, and the SDK exposes no non-hook one. The
// components that do have a client stash it here as they mount, which works
// because everything in this bundle shares module scope, the same reason the
// composer pill and banner share a store without touching the server.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

export type FollowUpRpc = PluginRpcClient<typeof rpcContract>;

let client: FollowUpRpc | null = null;

export function rememberRpc(next: FollowUpRpc): void {
  client = next;
}

/**
 * Null when no surface of this plugin has mounted yet. Callers must handle it
 * rather than assume: the composer pill mounts on every thread view, but a
 * caller has no way to prove one is present.
 */
export function getRpc(): FollowUpRpc | null {
  return client;
}
