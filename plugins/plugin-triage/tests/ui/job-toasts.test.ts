import { describe, expect, it } from "vitest";
import type { Job } from "../../lib/queue";
import { jobToast } from "../../ui/job-toasts";

const install = (over: Partial<Job> = {}) =>
  ({
    id: "j1",
    kind: "install",
    key: "notes@bb-community",
    entryId: "notes",
    marketplace: "bb-community",
    confirmedSource: null,
    displayName: "Notes",
    createdAt: 0,
    runAfter: 0,
    state: "done",
    startedAt: 0,
    finishedAt: 1,
    pluginId: "notes",
    error: null,
    ...over,
  }) as Job;

describe("finished-job toasts", () => {
  it("offers to open an installed plugin's settings", () => {
    expect(jobToast(install())).toEqual({
      tone: "success",
      title: "Installed Notes",
      id: "triage-install-notes@bb-community",
      action: { label: "Open settings", to: "/settings/plugins/notes" },
    });
  });

  it("offers no settings when the install failed, or bb never named the plugin", () => {
    expect(jobToast(install({ state: "failed", error: "nope" }))).toEqual({
      tone: "error",
      title: "Couldn't install Notes",
      id: "triage-install-notes@bb-community",
      description: "nope",
    });
    expect(jobToast(install({ pluginId: null }))?.action).toBeUndefined();
  });

  it("says nothing while a job is still waiting or running", () => {
    expect(jobToast(install({ state: "pending" }))).toBeNull();
    expect(jobToast(install({ state: "running" }))).toBeNull();
  });

  it("words updates and removals", () => {
    const update = { ...install(), kind: "update", key: "update:notes", result: "current" } as Job;
    expect(jobToast(update)?.title).toBe("Notes was already up to date");
    expect(jobToast({ ...update, result: "updated" } as Job)?.title).toBe("Updated Notes");
    const remove = { ...install(), kind: "remove", key: "remove:notes", state: "failed", error: "in use" } as Job;
    expect(jobToast(remove)).toEqual({ tone: "error", title: "Couldn't remove Notes", id: "triage-remove-notes", description: "in use" });
  });
});
