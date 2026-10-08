// Settings: where follow-ups can be filed.
//
// A list the user builds, not a fixed set of integrations: each destination is
// either a command run in the thread's checkout or a recipe a hidden helper
// carries out. Defined once here for every project; which one a project files
// to by default is chosen where filing happens, and remembered per project.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  useRpc,
  type ExperimentalProviderModelPickerValue as PickerValue,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import {
  DESTINATION_BODY_MAX,
  DESTINATION_EXAMPLES,
  DESTINATION_NAME_MAX,
  DESTINATIONS_MAX,
  slugFor,
  type Destination,
  type DestinationKind,
} from "../lib/destinations.ts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** A destination being edited: `id` is empty until it is first saved. */
type Draft = Destination & { key: string };

let nextKey = 0;
const keyed = (destination: Destination): Draft => ({ ...destination, key: `d${nextKey++}` });

const FIELD =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function KindToggle({
  kind,
  onChange,
}: {
  kind: DestinationKind;
  onChange: (kind: DestinationKind) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Kind" className="inline-flex rounded-md bg-secondary p-0.5">
      {(
        [
          ["command", "Run a command"],
          ["agent", "Ask an agent"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={kind === value}
          onClick={() => onChange(value)}
          className={cn(
            "rounded px-2 py-0.5 text-xs",
            kind === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ModelChoice({
  value,
  onChange,
}: {
  value: PickerValue | null;
  onChange: (value: PickerValue | null) => void;
}) {
  const providers = useProviders();
  if (value === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Runs on the model you chose for describing follow-ups.
        <Button
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-0.5 text-xs"
          disabled={providers.status !== "ready" || providers.providers.length === 0}
          onClick={() => {
            const first = providers.providers[0];
            if (first === undefined) return;
            onChange({ providerId: first.id, model: "", reasoningLevel: "medium" });
          }}
        >
          Choose another
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProviderModelPicker value={value} onChange={onChange} />
      <Button
        variant="ghost"
        size="sm"
        className="h-auto px-2 py-0.5 text-xs text-muted-foreground"
        onClick={() => onChange(null)}
      >
        Use the describing model
      </Button>
    </div>
  );
}

function DestinationEditor({
  draft,
  onChange,
  onRemove,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={cn(FIELD, "max-w-56")}
          value={draft.name}
          maxLength={DESTINATION_NAME_MAX}
          placeholder="Name, e.g. Jira ENG"
          aria-label="Destination name"
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
        <KindToggle kind={draft.kind} onChange={(kind) => onChange({ ...draft, kind })} />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-auto gap-1 px-2 py-0.5 text-xs text-muted-foreground"
          onClick={onRemove}
          aria-label={`Remove ${draft.name || "this destination"}`}
        >
          <Icon name="X" className="size-3" aria-hidden />
          Remove
        </Button>
      </div>
      {draft.kind === "command" ? (
        <>
          <textarea
            className={cn(FIELD, "min-h-14 font-mono text-xs")}
            value={draft.command ?? ""}
            maxLength={DESTINATION_BODY_MAX}
            placeholder={'gh issue create --title "$FOLLOWUP_TITLE" --body "$FOLLOWUP_DETAIL"'}
            aria-label="Command"
            onChange={(event) => onChange({ ...draft, command: event.target.value })}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            Runs with <code>sh</code> in the thread&rsquo;s checkout, on the thread&rsquo;s own
            host. The row arrives as <code>$FOLLOWUP_TITLE</code>, <code>$FOLLOWUP_DETAIL</code>,{" "}
            <code>$FOLLOWUP_FILE</code>, <code>$FOLLOWUP_REASON</code>, <code>$FOLLOWUP_ID</code>{" "}
            and <code>$FOLLOWUP_THREAD</code> — quote them — and as JSON on stdin. The first URL
            it prints, or else its last line, becomes the link. Exiting non-zero leaves the row
            open with the error.
          </p>
        </>
      ) : (
        <>
          <textarea
            className={cn(FIELD, "min-h-14 text-xs")}
            value={draft.recipe ?? ""}
            maxLength={DESTINATION_BODY_MAX}
            placeholder="Create an issue in ENG with the Atlassian MCP, labelled agent-noticed."
            aria-label="Recipe"
            onChange={(event) => onChange({ ...draft, recipe: event.target.value })}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            A hidden helper carries this out in the thread&rsquo;s checkout, for every row
            filed at once, and reports each one back with its link. Anything it does not
            report stays open.
          </p>
          <ModelChoice
            value={draft.execution ?? null}
            onChange={(execution) => onChange({ ...draft, execution })}
          />
        </>
      )}
    </li>
  );
}

/** What gets sent: trimmed, an id for the new ones, and only the kind's own field. */
function forSaving(draft: Draft): Destination {
  const base = {
    id: draft.id === "" ? slugFor(draft.name) : draft.id,
    name: draft.name.trim(),
  };
  return draft.kind === "command"
    ? { ...base, kind: "command", command: (draft.command ?? "").trim() }
    : {
        ...base,
        kind: "agent",
        recipe: (draft.recipe ?? "").trim(),
        // A half-made model choice is no choice: the describing model it is.
        execution:
          draft.execution === null || draft.execution === undefined || draft.execution.model === ""
            ? null
            : draft.execution,
      };
}

/** Why a draft cannot be saved yet, or null. */
function incomplete(draft: Draft): string | null {
  if (draft.name.trim() === "") return "Every destination needs a name.";
  if (draft.kind === "command" && (draft.command ?? "").trim() === "") {
    return `${draft.name.trim()} needs a command.`;
  }
  if (draft.kind === "agent" && (draft.recipe ?? "").trim() === "") {
    return `${draft.name.trim()} needs a recipe.`;
  }
  return null;
}

export function DestinationsSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await rpcRef.current.call("followups_destinations", { projectId: null });
        if (live) setDrafts(result.destinations.map(keyed));
      } catch {
        if (live) setStatus({ tone: "error", text: "Could not read the destinations." });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const change = useCallback((next: Draft[]) => {
    setDrafts(next);
    setDirty(true);
    setStatus(null);
  }, []);

  const save = useCallback(async () => {
    if (drafts === null) return;
    const problem = drafts.map(incomplete).find((text) => text !== null);
    if (problem !== undefined && problem !== null) {
      setStatus({ tone: "error", text: problem });
      return;
    }
    try {
      const result = await rpcRef.current.call("followups_set_destinations", {
        destinations: drafts.map(forSaving),
      });
      if (result.outcome === "duplicate-name") {
        setStatus({ tone: "error", text: "Two destinations share a name. Names have to differ." });
        return;
      }
      setDrafts(result.destinations.map(keyed));
      setDirty(false);
      setStatus({ tone: "ok", text: "Saved." });
    } catch {
      setStatus({ tone: "error", text: "That could not be saved." });
    }
  }, [drafts]);

  if (drafts === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {status?.text ?? "Loading…"}
      </p>
    );
  }

  const full = drafts.length >= DESTINATIONS_MAX;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Where a follow-up goes when it should be tracked somewhere other than this thread —
        your tracker, a backlog, anywhere a command or an agent can reach. Filed rows move to
        Done with a link back, and are not recorded on that thread again. Each project
        remembers which destination it files to by default.
      </p>
      {drafts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft, index) => (
            <DestinationEditor
              key={draft.key}
              draft={draft}
              onChange={(next) => change(drafts.map((entry, at) => (at === index ? next : entry)))}
              onRemove={() => change(drafts.filter((_, at) => at !== index))}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={full}
          onClick={() =>
            change([...drafts, keyed({ id: "", name: "", kind: "command", command: "" })])
          }
        >
          <Icon name="Plus" className="size-3.5" aria-hidden />
          Add a destination
        </Button>
        {DESTINATION_EXAMPLES.map((example) => (
          <Button
            key={example.name}
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={full}
            onClick={() => change([...drafts, keyed({ ...example, id: "" })])}
          >
            Start from &ldquo;{example.name}&rdquo;
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-3 text-xs"
          disabled={!dirty}
          onClick={() => void save()}
        >
          Save destinations
        </Button>
        {status !== null && (
          <span
            role="status"
            className={cn(
              "text-xs",
              status.tone === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
