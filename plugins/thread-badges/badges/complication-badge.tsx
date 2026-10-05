// A badge for any complication another plugin provides.
//
// Nothing here knows what a value means — the provider does. This reads the
// value for one thread from the window's registry and draws it as
// ./complication-view decides: a ring for a gauge, otherwise the provider's
// icon in its tone, with text beside either when that was asked for.
//
// Style inline, like every badge: rows are portaled outside this plugin's
// stylesheet scope, so a utility class would do nothing. The one stylesheet
// rule is the running animation, which app.tsx injects with the cap.
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { useComplication } from "./complication";
import { complicationView, type ComplicationView } from "./complication-view";
import type { ComplicationPrefs } from "./complication-prefs";
import { Ring } from "./ring";

/** Marks a badge that animates while its value says work is running. */
export const RUNNING_ATTRIBUTE = "data-thread-badges-running";

const GLYPH_SIZE = 14;

/** One view, drawn. Exactly one element, as the row's cap requires. */
export function ComplicationGlyph({ view }: { view: ComplicationView }) {
  return (
    <span
      aria-label={view.label}
      {...(view.running ? { [RUNNING_ATTRIBUTE]: "" } : {})}
      style={{
        alignItems: "center",
        color: "var(--muted-foreground)",
        display: "inline-flex",
        fontSize: 11,
        gap: 2,
        lineHeight: 1,
      }}
      title={view.label}
    >
      {view.kind === "ring" ? (
        <Ring color={view.color} fraction={view.fraction} />
      ) : (
        <Icon
          aria-hidden
          fallback="Circle"
          name={view.icon}
          style={{ color: view.color, flex: "none", height: GLYPH_SIZE, width: GLYPH_SIZE }}
        />
      )}
      {view.text !== null ? <span>{view.text}</span> : null}
    </span>
  );
}

export function ComplicationBadge({
  id,
  threadId,
  prefs,
}: {
  id: string;
  threadId: string;
  prefs: ComplicationPrefs;
}) {
  const { value } = useComplication(id, threadId);
  const view = complicationView(value, prefs);
  return view === null ? null : <ComplicationGlyph view={view} />;
}
