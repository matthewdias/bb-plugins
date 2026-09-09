// The workflow editor, rendered on this plugin's page in Settings → Plugins.
//
// Ribbon sidebar draws the stages themselves; everything here edits the
// catalog it reads. Renaming a stage changes only its label: its id is what
// Ribbon files threads under, so ids are fixed at creation.
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { definePluginApp, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import type { Stage, WorkflowConfig } from "./stages";
import { GLYPHS, type IconDataV1 } from "./icons";
import { iconDataFromGlyph } from "./icon-data";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getIconGlyph,
  Icon,
  ICON_NAMES,
  preloadExtendedIcons,
  type IconName,
} from "@/components/ui/icon";
import {
  getExtendedIcons,
  subscribeExtendedIcons,
} from "@/components/ui/icon-registry";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function renderIcon(node: IconDataV1, key: string): ReactElement {
  return createElement(
    node.tag,
    { ...node.attrs, key },
    node.children?.map((child, index) => renderIcon(child, `${key}-${index}`)),
  );
}

function Glyph({ name }: { name: string }) {
  const icon = GLYPHS[name as keyof typeof GLYPHS] ?? GLYPHS.circle;
  return (
    <span
      aria-hidden
      className="inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4"
    >
      {renderIcon(icon, name)}
    </span>
  );
}

const ICON_NAME_SET: ReadonlySet<string> = new Set<string>(ICON_NAMES);

function StageIcon({ stage }: { stage: Stage }) {
  if (stage.icon !== null && ICON_NAME_SET.has(stage.iconName)) {
    return <Icon name={stage.iconName as IconName} className="size-4" aria-hidden />;
  }
  return <Glyph name={stage.glyph} />;
}

/** "GitPullRequest" reads as "git pull request" when you search for it. */
function iconWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase();
}

/**
 * bb's icon catalog, minus anything Ribbon would refuse to draw. Extended
 * icons load on demand, so this re-reads when they arrive.
 */
function usePickableIcons(): { name: IconName; words: string }[] {
  const extended = useSyncExternalStore(
    subscribeExtendedIcons,
    getExtendedIcons,
    getExtendedIcons,
  );
  useEffect(() => {
    void preloadExtendedIcons().catch(() => undefined);
  }, []);
  return useMemo(() => {
    void extended;
    const pickable: { name: IconName; words: string }[] = [];
    for (const name of ICON_NAMES) {
      const glyph = getIconGlyph(name);
      if (glyph === null || iconDataFromGlyph(glyph) === null) continue;
      pickable.push({ name, words: iconWords(name) });
    }
    return pickable;
  }, [extended]);
}

function IconPicker({
  stage,
  onPick,
}: {
  stage: Stage;
  onPick: (patch: Partial<Omit<Stage, "id">>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const icons = usePickableIcons();
  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/u).filter((term) => term !== "");
    if (terms.length === 0) return icons;
    return icons.filter(({ words }) => terms.every((term) => words.includes(term)));
  }, [icons, query]);

  function choose(name: IconName | null): void {
    if (name === null) {
      onPick({ iconName: "", icon: null });
      setOpen(false);
      return;
    }
    const glyph = getIconGlyph(name);
    const icon = glyph === null ? null : iconDataFromGlyph(glyph);
    // The catalog is already filtered to convertible icons; this is the
    // belt-and-braces for one that stopped being convertible mid-session.
    if (icon === null) return;
    onPick({ iconName: name, icon });
    setOpen(false);
  }

  return (
    <>
      <Button
        aria-label={`${stage.label} icon`}
        className="shrink-0"
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
        size="icon"
        variant="outline"
      >
        <StageIcon stage={stage} />
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Icon for {stage.label}</DialogTitle>
            <DialogDescription>
              bb's icon set, drawn by the sidebar beside this stage.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search icons"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search icons…"
            value={query}
          />
          <div className="grid max-h-72 grid-cols-8 gap-1 overflow-y-auto pr-1">
            <button
              className={cn(
                "flex aspect-square items-center justify-center rounded-md border border-dashed border-border hover:bg-sidebar-accent",
                stage.icon === null && "border-solid bg-state-active",
              )}
              onClick={() => choose(null)}
              title="Default icon"
              type="button"
            >
              <Glyph name={stage.glyph} />
            </button>
            {results.map(({ name }) => (
              <button
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md hover:bg-sidebar-accent",
                  stage.iconName === name && "bg-state-active",
                )}
                key={name}
                onClick={() => choose(name)}
                title={name}
                type="button"
              >
                <Icon name={name} className="size-4" aria-hidden />
              </button>
            ))}
          </div>
          <p className="text-sm text-subtle-foreground">
            {results.length === 0
              ? "No icon matches that."
              : `${results.length} icons`}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

const FIELD =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none ring-ring focus-visible:ring-2";

interface WorkflowState {
  stages: Stage[];
  config: WorkflowConfig;
  glyphs: string[];
  groupingKey: string;
  ribbonAvailable: boolean;
}

function useWorkflow() {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<WorkflowState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    rpc.call("workflow_state").then(
      (next) => {
        setState(next as WorkflowState);
        setError(null);
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [rpc]);

  useEffect(refetch, [refetch]);
  // Every write publishes, so a change from another window or the CLI lands here too.
  useRealtime("workflow-changed", refetch);

  const run = useCallback(
    (work: Promise<unknown>) => {
      work.then(
        () => setError(null),
        (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
      );
    },
    [],
  );

  return { state, error, rpc, run, refetch };
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 text-subtle-foreground">{label}</span>
      {children}
    </label>
  );
}

function StageCard({
  stage,
  index,
  count,
  state,
  onChange,
}: {
  stage: Stage;
  index: number;
  count: number;
  state: WorkflowState;
  onChange: (work: Promise<unknown>) => void;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [label, setLabel] = useState(stage.label);
  const [description, setDescription] = useState(stage.description);
  useEffect(() => setLabel(stage.label), [stage.label]);
  useEffect(() => setDescription(stage.description), [stage.description]);

  const update = (patch: Partial<Omit<Stage, "id">>) =>
    onChange(rpc.call("stage_update", { id: stage.id, ...patch }));
  const isDefault = state.config.defaultStageId === stage.id;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <IconPicker onPick={update} stage={stage} />
        <Input
          aria-label={`${stage.label} name`}
          className="h-8 flex-1"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => label.trim() !== stage.label && update({ label })}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
        />
        <code className="shrink-0 text-[11px] text-subtle-foreground" title="Ribbon files threads under this id; it never changes.">
          {stage.id}
        </code>
        <Button
          aria-label={`Move ${stage.label} up`}
          disabled={index === 0}
          onClick={() => onChange(rpc.call("stage_move", { id: stage.id, direction: "up" }))}
          size="icon"
          variant="ghost"
        >
          <Icon name="ChevronUp" className="size-4" />
        </Button>
        <Button
          aria-label={`Move ${stage.label} down`}
          disabled={index === count - 1}
          onClick={() => onChange(rpc.call("stage_move", { id: stage.id, direction: "down" }))}
          size="icon"
          variant="ghost"
        >
          <Icon name="ChevronDown" className="size-4" />
        </Button>
        <span
          title={
            isDefault
              ? "The default stage cannot be deleted. Make another stage the default first."
              : "Delete this stage; its threads move to the default stage."
          }
        >
          <Button
            aria-label={`Delete ${stage.label}`}
            disabled={isDefault || count <= 1}
            onClick={() => onChange(rpc.call("stage_remove", { id: stage.id }))}
            size="icon"
            variant="ghost"
          >
            <Icon name="Trash2" className="size-4" />
          </Button>
        </span>
      </div>

      <textarea
        aria-label={`${stage.label} rule`}
        className="mt-2 min-h-16 w-full rounded-md border border-border bg-background p-2 text-sm outline-none ring-ring focus-visible:ring-2"
        placeholder="What belongs in this stage? Agents read this to decide when to move a thread here."
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => description !== stage.description && update({ description })}
      />

      <div className="mt-2 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={stage.sticky}
            onCheckedChange={(checked) => update({ sticky: checked === true })}
          />
          <span title="Automation and agents never move a thread into or out of this stage.">
            Only the user files here
          </span>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={stage.visibleWhenEmpty}
            onCheckedChange={(checked) => update({ visibleWhenEmpty: checked === true })}
          />
          <span>Show when empty</span>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={stage.defaultCollapsed}
            onCheckedChange={(checked) => update({ defaultCollapsed: checked === true })}
          />
          <span>Collapsed by default</span>
        </label>
      </div>
    </div>
  );
}

function WorkflowSettings() {
  const { state, error, rpc, run } = useWorkflow();
  const [newLabel, setNewLabel] = useState("");

  if (state === null) {
    return <p className="text-sm text-subtle-foreground">{error ?? "Loading the workflow…"}</p>;
  }

  const options = (allowNone: boolean) => (
    <>
      {allowNone ? <option value="">Off</option> : null}
      {state.stages.map((stage) => (
        <option key={stage.id} value={stage.id}>
          {stage.label}
        </option>
      ))}
    </>
  );
  const configure = (patch: Partial<WorkflowConfig>) =>
    run(rpc.call("workflow_configure", patch));

  return (
    <div className="flex flex-col gap-4">
      {error === null ? null : (
        <p className="rounded-md border border-destructive/40 p-2 text-sm text-destructive">{error}</p>
      )}
      {state.ribbonAvailable ? (
        <p className="text-sm text-subtle-foreground">
          Pick <strong>Workflow</strong> in the sidebar's Groups menu to file threads by these
          stages.
        </p>
      ) : (
        <p className="rounded-md border border-border p-2 text-sm text-subtle-foreground">
          Ribbon sidebar is not running, so these stages have nowhere to draw. Install it with{" "}
          <code>bb plugin install ribbon-sidebar@ribbon</code>, then select it under Settings →
          Appearance → Sidebar.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {state.stages.map((stage, index) => (
          <StageCard
            key={stage.id}
            stage={stage}
            index={index}
            count={state.stages.length}
            state={state}
            onChange={run}
          />
        ))}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const label = newLabel.trim();
          if (label === "") return;
          setNewLabel("");
          run(rpc.call("stage_add", { label }));
        }}
      >
        <Input
          aria-label="New stage name"
          className="h-8 max-w-64"
          placeholder="Add a stage…"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
        />
        <Button size="sm" type="submit" variant="secondary">
          Add
        </Button>
      </form>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Automatic moves</p>
        <Row label="New threads start in">
          <select
            className={cn(FIELD, "max-w-64")}
            value={state.config.defaultStageId}
            onChange={(event) => configure({ defaultStageId: event.target.value })}
          >
            {options(false)}
          </select>
        </Row>
        <Row label="When a turn starts">
          <select
            className={cn(FIELD, "max-w-64")}
            value={state.config.activeStageId ?? ""}
            onChange={(event) => configure({ activeStageId: event.target.value || null })}
          >
            {options(true)}
          </select>
        </Row>
        <Row label="When work stops">
          <select
            className={cn(FIELD, "max-w-64")}
            value={state.config.idleStageId ?? ""}
            onChange={(event) => configure({ idleStageId: event.target.value || null })}
          >
            {options(true)}
          </select>
        </Row>
        <Row label="When it needs you">
          <select
            className={cn(FIELD, "max-w-64")}
            value={state.config.attentionStageId ?? ""}
            onChange={(event) => configure({ attentionStageId: event.target.value || null })}
          >
            {options(true)}
          </select>
        </Row>
        <p className="text-sm text-subtle-foreground">
          A question, an approval, or a failed turn counts as needing you. Automatic moves skip
          any stage marked <em>only the user files here</em>, and "when work stops" only undoes
          the move "when a turn starts" made.
        </p>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "workflow",
    title: "Workflow",
    description:
      "The stages Ribbon sidebar groups threads by, and the rules agents read to move between them.",
    component: WorkflowSettings,
  });
});
