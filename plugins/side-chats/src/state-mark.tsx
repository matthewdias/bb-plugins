// What a side chat is doing, drawn small: a spinner while it replies, a dot
// for a reply nobody has looked at, nothing otherwise.
import type { SideChatSummary } from "@/lib/contract";

type State = SideChatSummary["state"];

export const STATE_LABEL: Record<State, string | null> = {
  working: "replying…",
  unread: "new reply",
  read: null,
};

export function StateMark({ state }: { state: State }) {
  if (state === "working") {
    return (
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent"
      />
    );
  }
  if (state === "unread") {
    return <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-primary" />;
  }
  return null;
}

/** The most pressing state across several side chats: replying, then unread. */
export function overallState(states: readonly State[]): State {
  if (states.includes("working")) return "working";
  if (states.includes("unread")) return "unread";
  return "read";
}
