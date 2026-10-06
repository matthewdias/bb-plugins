// What the message action, the modifier-click and the palette command do.
//
// `useRpc` is a hook, so the registration callbacks — a messageAction's
// `run`, a command's `run` and `isAvailable` — cannot get a client or ask the
// server anything themselves. The overlay mounts once per window, stashes its
// client here, and keeps the points it has loaded here too, which works
// because everything in this bundle shares module scope.
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { MessageRole, ReadPoint } from "../lib/read-point";
import type { rpcContract } from "../server";

export type MarkUnreadRpc = PluginRpcClient<typeof rpcContract>;

let client: MarkUnreadRpc | null = null;
const points = new Map<string, ReadPoint | null>();

export function rememberRpc(next: MarkUnreadRpc): void {
  client = next;
}

/** Null until the overlay has mounted in this window. */
export function getRpc(): MarkUnreadRpc | null {
  return client;
}

export function rememberPoint(threadId: string, point: ReadPoint | null): void {
  points.set(threadId, point);
}

/** The point last loaded for a thread; null when there is none or it is not loaded. */
export function knownPoint(threadId: string): ReadPoint | null {
  return points.get(threadId) ?? null;
}

/** True only when the thread's point was loaded and there was none. */
export function knownAbsent(threadId: string): boolean {
  return points.has(threadId) && points.get(threadId) === null;
}

export interface MarkTarget {
  threadId: string;
  messageId: string;
  role: MessageRole;
  sourceSeqEnd: number | null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export async function markFromHere(rpc: MarkUnreadRpc | null, target: MarkTarget): Promise<void> {
  if (!rpc) {
    toast.error("Mark Unread is still loading. Try again in a moment.");
    return;
  }
  try {
    const { point } = await rpc.call("points_set", target);
    rememberPoint(point.threadId, point);
  } catch (cause) {
    toast.error("Couldn't mark this thread unread", { description: describe(cause) });
  }
}

/** Forget the point and mark the thread read, which is how it stood before. */
export async function clearPoint(rpc: MarkUnreadRpc, threadId: string): Promise<void> {
  try {
    await rpc.call("points_clear", { threadId, markRead: true });
  } catch (cause) {
    toast.error("Couldn't clear the read point", { description: describe(cause) });
  }
}
