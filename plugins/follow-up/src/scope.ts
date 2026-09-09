// The composer scope is a union; only some members carry a thread.
//
// This lived in pill.tsx while the pill was the always-mounted surface. It
// outlived that component, so it sits on its own rather than making every
// caller import from whichever file happens to be the entry point today.
import type { useComposerView } from "@get-bb/plugin-sdk/app";

export function threadIdFromScope(
  scope: ReturnType<typeof useComposerView>["scope"],
): string | null {
  return "threadId" in scope ? scope.threadId : null;
}
