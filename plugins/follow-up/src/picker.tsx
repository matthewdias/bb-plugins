// The + menu's follow-up picker: a host-placed popup over the composer.
//
// bb owns where it sits (the @ menu's place, or a drawer on a phone), closing
// it on Escape or a click outside, and handing focus back to the editor. This
// owns its contents: a search box, the thread's open rows, and arrow-key and
// Enter selection. Picking a row inserts it exactly as the banner does — the
// pill at the cursor, the row moved to the top — then closes the popup.
//
// Rows whose pill is already in the draft are left out: there is nothing to
// pick them for.
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import {
  useComposer,
  useRpc,
  type ExperimentalComposerCommandRegistration,
  type PluginAppComposer,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { isFollowUpInDraft, type FollowUp } from "../lib/followups.ts";
import { insertRow } from "./reorder.ts";
import { threadIdFromScope } from "./scope.ts";
import { useFollowUpState } from "./store.ts";
import { cn } from "@/lib/utils";

/** The popup's id, unique across this plugin's composer customizations. */
export const PICKER_POPUP_ID = "followups-picker";

/** Rows whose text or detail contains every word of the query, any case. */
export function matchingRows(rows: readonly FollowUp[], query: string): FollowUp[] {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word !== "");
  if (words.length === 0) return [...rows];
  return rows.filter((row) => {
    const haystack = `${row.text}\n${row.detail ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

export function FollowUpPicker() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const threadId = threadIdFromScope(composer.scope);
  // The banner's store: the banner is mounted under every thread composer
  // and keeps it current, so the picker needs no fetch of its own.
  const { rows } = useFollowUpState(threadId);
  const mentions = composer.draft.mentions;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const available = useMemo(
    () =>
      threadId === null
        ? []
        : rows.filter((row) => !isFollowUpInDraft(mentions, threadId, row.id)),
    [rows, mentions, threadId],
  );
  const choices = useMemo(() => matchingRows(available, query), [available, query]);
  const current = Math.min(active, Math.max(choices.length - 1, 0));

  const pick = (row: FollowUp) => {
    if (threadId === null) return;
    insertRow(composer, rpc, threadId, row);
    composer.experimental_closePopup();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (choices.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + choices.length) % choices.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = choices[current];
      if (row !== undefined) pick(row);
    }
  };

  const optionId = (row: FollowUp) => `follow-up-picker-${row.id}`;

  return (
    <div className="flex max-h-80 w-full min-w-72 flex-col gap-1 p-1">
      <input
        autoFocus
        type="text"
        role="combobox"
        aria-expanded
        aria-controls="follow-up-picker-list"
        aria-activedescendant={choices[current] === undefined ? undefined : optionId(choices[current])}
        aria-label="Search this thread's follow-ups"
        placeholder="Search follow-ups"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      {choices.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          {rows.length === 0
            ? "No open follow-ups on this thread."
            : available.length === 0
              ? "Every open follow-up is already in the composer."
              : "No follow-up matches."}
        </p>
      ) : (
        <ul
          id="follow-up-picker-list"
          role="listbox"
          aria-label="Follow-ups"
          className="flex min-h-0 flex-col overflow-y-auto"
        >
          {choices.map((row, index) => (
            <li
              key={row.id}
              id={optionId(row)}
              role="option"
              aria-selected={index === current}
              // Keep focus in the search box, so typing and arrows keep working.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(row)}
              className={cn(
                "cursor-pointer truncate rounded-md px-2 py-1.5 text-sm",
                index === current && "bg-state-active text-foreground",
              )}
              title={row.detail ?? row.text}
            >
              {row.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Follow-ups: insert one…": the same picker, from the keyboard. */
export const insertCommand: ExperimentalComposerCommandRegistration = {
  id: "insert-followup",
  title: "Follow-ups: insert one…",
  run: ({ composer }) => {
    // Out of scope — a new-thread or queued-message composer — opens nothing.
    if (!composer.experimental_openPopup(PICKER_POPUP_ID)) {
      toast.error("The follow-up picker opens in a thread's composer.");
    }
  },
};

/**
 * Register the command if this bb has composer commands, for the same reason
 * `registerRecordCommand` checks: a missing experimental method must cost only
 * the command, not the app's setup.
 */
export function registerInsertCommand(
  composer: Partial<Pick<PluginAppComposer, "experimental_registerCommand">>,
): boolean {
  if (typeof composer.experimental_registerCommand !== "function") return false;
  composer.experimental_registerCommand(insertCommand);
  return true;
}
