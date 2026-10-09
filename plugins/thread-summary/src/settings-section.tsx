// Settings: which providers the card leaves out.
//
// One row per provider running now, each shown until you hide it. A section
// rather than bb settings because providers are discovered here, in the app,
// after the backend has declared its settings. A write goes to the backend's
// storage, which tells every window, so every open card follows it.
import { useId, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { ComplicationProviderInfo } from "../lib/complications";
import { orderedIds } from "../lib/order";
import { useThreadProviders } from "./complications";
import { Glyph } from "./glyph";
import { useHiddenProviders } from "./use-hidden-providers";

export function HiddenProvidersSettings() {
  const providers = useThreadProviders();
  const { hidden, loaded, setHidden } = useHiddenProviders();
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) {
    return <p className="text-sm text-muted-foreground">No plugin is publishing thread complications right now.</p>;
  }

  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered = orderedIds(
    providers.map((provider) => provider.id),
    new Set(),
  ).map((id) => byId.get(id) as ComplicationProviderInfo);

  const change = (id: string, hide: boolean): void => {
    setError(null);
    setHidden(id, hide).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {ordered.map((provider) => (
        <ProviderRow
          // Until the stored list arrives, a box would show a default that may
          // not be yours, and ticking it would overwrite yours.
          disabled={!loaded}
          hidden={hidden.has(provider.id)}
          key={provider.id}
          onChange={(hide) => change(provider.id, hide)}
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
  hidden,
  disabled,
  onChange,
}: {
  provider: ComplicationProviderInfo;
  hidden: boolean;
  disabled: boolean;
  onChange: (hide: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 rounded-md border border-border p-3">
      <Checkbox
        aria-label={`Hide ${provider.name}`}
        checked={hidden}
        disabled={disabled}
        id={id}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      <div className="min-w-0 flex-1">
        <label className="text-sm font-medium" htmlFor={id}>
          Hide {provider.name}
        </label>
        {provider.description !== undefined ? (
          <p className="text-xs text-muted-foreground">{provider.description}</p>
        ) : null}
      </div>
      {provider.sample !== undefined ? (
        <span className="flex-none" title="Preview">
          <Glyph value={provider.sample} />
        </span>
      ) : null}
    </div>
  );
}
