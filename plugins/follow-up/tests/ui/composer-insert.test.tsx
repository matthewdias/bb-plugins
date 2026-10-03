import { describe, expect, it } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerMention } from "@get-bb/plugin-sdk/app";
import { ComposerInsert } from "../../src/composer-insert.tsx";
import type { FollowUp } from "../../lib/followups.ts";

const THREAD = "thr_a";
const row: FollowUp = {
  id: "abc12345",
  text: "Fix the flaky auth test",
  reason: null,
  file: null,
  detail: null,
  createdAt: "2026-10-01T00:00:00.000Z",
};

function render(text: string, mentions: ComposerMention[] = []) {
  return renderSlot({ component: ComposerInsert }, { row, threadId: THREAD }, {
    composer: { text, mentions, scope: { kind: "thread", threadId: THREAD } },
  });
}

function pill(label: string, at: number): ComposerMention {
  return {
    kind: "plugin",
    pluginId: "follow-up",
    provider: "follow-up",
    id: `${THREAD}.${row.id}`,
    label,
    from: at,
    to: at + label.length,
  };
}

// "Already in the composer" is a text match on the pill label today. These pin
// both of its known misreadings so moving to `draft.mentions` shows as a diff.
describe("ComposerInsert", () => {
  it("inserts the row's pill and focuses the composer", () => {
    const slot = render("");
    fireEvent.click(slot.getByRole("button", { name: `Put "${row.text}" in the composer` }));
    expect(slot.inspection.composer.draft.mentions).toMatchObject([
      { kind: "plugin", provider: "follow-up", id: `${THREAD}.${row.id}`, label: row.text },
    ]);
    expect(slot.inspection.composer.focusCount).toBe(1);
  });

  it("reads as inserted while the draft contains the label", () => {
    const slot = render(row.text, [pill(row.text, 0)]);
    const button = slot.getByRole("button", { name: `"${row.text}" is already in the composer` });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("counts a typed copy of the label as inserted, though no pill is there", () => {
    const slot = render(`please ${row.text}`);
    expect(slot.queryByRole("button", { name: `"${row.text}" is already in the composer` })).not.toBeNull();
  });

  it("misses a pill for this row whose label no longer matches the row's text", () => {
    const slot = render("an older wording", [pill("an older wording", 0)]);
    expect(slot.queryByRole("button", { name: `Put "${row.text}" in the composer` })).not.toBeNull();
  });
});
