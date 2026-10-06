// Settings for complications other plugins provide: one row per provider that
// is running now, each off until you turn it on.
//
// A section rather than bb settings because providers are discovered here, in
// the app, after the backend has declared its settings. What this writes goes
// to the backend's storage, which tells every window, so a row elsewhere picks
// up the change without a reload.
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ComplicationProviderInfo } from "../lib/complications";
import { ComplicationGlyph } from "./complication-badge";
import { prefsFor, type ComplicationPrefs } from "./complication-prefs";
import { complicationView } from "./complication-view";
import { useComplicationPrefs } from "./use-complication-prefs";
import { useThreadProviders } from "./use-complication-providers";

export function ComplicationSettings() {
  const providers = useThreadProviders();
  const { prefs, loaded, update } = useComplicationPrefs();
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No plugin is publishing thread complications right now. Follow Up 0.7 or later
        publishes its progress here.
      </p>
    );
  }

  const change = (id: string, patch: Partial<ComplicationPrefs>): void => {
    setError(null);
    update(id, patch).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <ProviderRow
          // Until the stored settings arrive, a switch would show a default
          // that may not be yours, and flipping it would overwrite yours.
          disabled={!loaded}
          key={provider.id}
          onChange={(patch) => change(provider.id, patch)}
          prefs={prefsFor(prefs, provider.id)}
          provider={provider}
        />
      ))}
      {error !== null ? (
        <p className="text-sm text-destructive" role="alert">
          Could not save: {error}
        </p>
      ) : null}
    </div>
  );
}

function ProviderRow({
  provider,
  prefs,
  disabled,
  onChange,
}: {
  provider: ComplicationProviderInfo;
  prefs: ComplicationPrefs;
  disabled: boolean;
  onChange: (patch: Partial<ComplicationPrefs>) => void;
}) {
  const id = useId();
  // The preview ignores "hide once complete": a sample that is complete would
  // otherwise preview as nothing at all.
  const preview =
    provider.sample === undefined
      ? null
      : complicationView(provider.sample, { showText: prefs.showText, hideWhenComplete: false });

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={prefs.enabled}
          disabled={disabled}
          id={`${id}-enabled`}
          onCheckedChange={(checked) => onChange({ enabled: checked === true })}
        />
        <div className="min-w-0 flex-1">
          <label className="text-sm font-medium" htmlFor={`${id}-enabled`}>
            {provider.name}
          </label>
          {provider.description !== undefined ? (
            <p className="text-xs text-muted-foreground">{provider.description}</p>
          ) : null}
        </div>
        {preview !== null ? (
          <span className="flex-none" title="Preview">
            <ComplicationGlyph view={preview} />
          </span>
        ) : null}
      </div>
      {prefs.enabled ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 pl-7 text-sm">
          <PriorityInput
            disabled={disabled}
            id={`${id}-priority`}
            onCommit={(priority) => onChange({ priority })}
            value={prefs.priority}
          />
          <Option
            checked={prefs.showText}
            disabled={disabled}
            id={`${id}-text`}
            label="Show its text beside it"
            onChange={(showText) => onChange({ showText })}
          />
          <Option
            checked={prefs.hideWhenComplete}
            disabled={disabled}
            id={`${id}-complete`}
            label="Hide once complete"
            onChange={(hideWhenComplete) => onChange({ hideWhenComplete })}
          />
        </div>
      ) : null}
    </div>
  );
}

function Option({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <Checkbox
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

/**
 * Committed on blur or Enter, not per keystroke: typing "12" would otherwise
 * save 1 and then 12, and reorder every row in between. Anything that is not a
 * number puts the stored value back.
 */
function PriorityInput({
  id,
  value,
  disabled,
  onCommit,
}: {
  id: string;
  value: number;
  disabled: boolean;
  onCommit: (priority: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = (): void => {
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };

  return (
    <span className="flex items-center gap-2">
      <label htmlFor={id}>Priority</label>
      <Input
        className="h-7 w-16"
        disabled={disabled}
        id={id}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") commit();
        }}
        type="number"
        value={draft}
      />
    </span>
  );
}
