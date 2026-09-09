// Which model describes a thin follow-up.
//
// This is the one setting that cannot be declarative. `bb.settings.define`
// offers `select`, whose options are fixed when the plugin loads, and `string`,
// which would mean typing a model id from memory and finding out it was wrong
// two minutes into a spawn. Neither can name a live catalog.
//
// So it renders bb's own picker — `experimental_ProviderModelPicker`, host-owned
// and resolved against the real provider list, whose value the SDK documents as
// existing to be forwarded verbatim to `threads.spawn`. Same argument that
// deleted this plugin's hand-rolled skills picker: the host's surface is better
// than the one we would write, and it stays right when bb changes.
//
// `routing` is deliberately omitted, which routes discovery through bb's
// primary machine. Settings are per-install and global — there is no thread and
// no environment here to route through.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  experimental_useProviders as useProviders,
  useRpc,
  useSettings,
  type ExperimentalProviderModelPickerValue as PickerValue,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/** Preferred seed for a provider that has never been chosen before. */
const SEED_REASONING = "medium";

/**
 * A starting selection, so the picker has something to render.
 *
 * `model` is empty on purpose and is never saved that way: the server refuses a
 * blank model, and the save below waits for one. The seed exists only so the
 * picker can mount and resolve its own catalog — the moment it does, `onChange`
 * replaces every field of this with a coherent selection.
 */
function seedFrom(
  providerId: string,
  reasoningLevels: readonly { id: string }[] | undefined,
): PickerValue {
  const levels = reasoningLevels ?? [];
  const preferred =
    levels.find((level) => level.id === SEED_REASONING)?.id ??
    levels[0]?.id ??
    SEED_REASONING;
  return {
    providerId,
    model: "",
    reasoningLevel: preferred as PickerValue["reasoningLevel"],
  };
}

export function ExpansionModelSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const providers = useProviders();
  const settings = useSettings();
  const [draft, setDraft] = useState<PickerValue | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const result = await rpcRef.current.call("followups_expansion_execution", {});
        if (!live) return;
        setDraft(result.execution);
      } catch {
        if (live) setProblem("Could not read this setting.");
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async (next: PickerValue | null) => {
    setProblem(null);
    try {
      await rpcRef.current.call("followups_set_expansion_execution", {
        execution: next,
      });
    } catch {
      setProblem("That could not be saved.");
    }
  }, []);

  const onChange = useCallback(
    (value: PickerValue) => {
      // Shown immediately, saved only when it is whole. A provider switch
      // resolves its catalog asynchronously, and the half-second where the
      // model is still blank must not be written down — the server would refuse
      // it, and a refusal here reads as the picker not working.
      setDraft(value);
      if (value.model !== "") void save(value);
    },
    [save],
  );

  // Said, not hidden — the opposite of what the row's button does when the same
  // switch is off, and for a reason the two surfaces do not share. A hidden
  // button leaves the row it belonged to still on screen, so the absence reads
  // as "not offered here". A settings page is where you go to *find* a control,
  // and the host renders this section's heading and subheading around whatever
  // this component returns — so returning null would leave a title standing
  // over nothing, which is worse than either choice the follow-up weighed.
  if (settings.values?.offerDescribe === false) {
    return (
      <p className="text-xs text-muted-foreground">
        Switched off — see &ldquo;Offer &lsquo;Describe this in more
        detail&rsquo;&rdquo; above. The model you pick here is remembered either
        way.
      </p>
    );
  }

  if (!loaded) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-xs text-muted-foreground">
        Describing a thin follow-up runs a short-lived hidden helper. It reads a
        bounded slice of the thread and writes one paragraph, so it rarely needs
        the model you are working in.
      </p>
      {draft === null ? (
        <div className="flex flex-col items-start gap-1.5">
          <p className="text-xs">
            Currently running on the project's own defaults.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="h-auto px-2 py-1 text-xs"
            // Disabled rather than hidden while the directory loads: the button
            // is the only way into this setting, and hiding it would read as
            // the setting not existing.
            disabled={providers.status !== "ready" || providers.providers.length === 0}
            onClick={() => {
              const first = providers.providers[0];
              if (first === undefined) return;
              setDraft(seedFrom(first.id, first.reasoningLevels));
            }}
          >
            Choose a model instead
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ProviderModelPicker value={draft} onChange={onChange} />
          <Button
            variant="ghost"
            size="sm"
            className="h-auto gap-1.5 px-2 py-1 text-xs text-muted-foreground"
            onClick={() => {
              setDraft(null);
              void save(null);
            }}
          >
            <Icon name="ArrowTurnBackward" className="size-3" aria-hidden />
            Use project defaults
          </Button>
        </div>
      )}
      {/* A selection that never resolved a model. Said out loud, because the
          picker looks configured and the spawn would quietly use the defaults
          anyway — a mismatch the user has no other way to notice. */}
      {draft !== null && draft.model === "" && (
        <p className="text-[11px] text-muted-foreground">
          Pick a model to finish — until then the helper uses the project
          defaults.
        </p>
      )}
      {problem !== null && (
        <p className="text-[11px] text-destructive">{problem}</p>
      )}
    </div>
  );
}
