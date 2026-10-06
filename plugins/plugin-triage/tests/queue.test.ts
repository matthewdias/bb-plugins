import { describe, expect, it } from "vitest";
import {
  GRACE_MS,
  cancelPending,
  enqueue,
  failuresByKey,
  liveJob,
  markFinished,
  markRunning,
  nextRunnable,
  nextWakeAt,
  prune,
  recover,
  releaseHeld,
  type InstallJob,
  type Job,
  type UpdateJob,
} from "../lib/queue";

const T = 1_000_000;

function job(id: string, overrides: Partial<InstallJob> = {}): InstallJob {
  return {
    id,
    kind: "install",
    key: `${id}@bb-community`,
    entryId: id,
    marketplace: "bb-community",
    displayName: id,
    confirmedSource: null,
    createdAt: T,
    runAfter: T + GRACE_MS,
    state: "pending",
    startedAt: null,
    finishedAt: null,
    pluginId: id,
    error: null,
    ...overrides,
  };
}

function update(pluginId: string, overrides: Partial<UpdateJob> = {}): UpdateJob {
  return {
    id: `u-${pluginId}`,
    kind: "update",
    key: `update:${pluginId}`,
    pluginId,
    displayName: pluginId,
    from: { version: "1.0.0", display: "1.0.0" },
    to: { version: "1.1.0", display: "1.1.0" },
    held: true,
    result: null,
    createdAt: T,
    runAfter: T,
    state: "pending",
    startedAt: null,
    finishedAt: null,
    error: null,
    ...overrides,
  };
}

describe("held updates", () => {
  it("wait for the batch to start, and do not wake the runner", () => {
    const jobs: Job[] = [update("a"), update("b")];
    expect(nextRunnable(jobs, T + 10_000)).toBeNull();
    expect(nextWakeAt(jobs)).toBeNull();
  });

  it("all become ready when the batch starts, in the order queued", () => {
    const { jobs, released } = releaseHeld([update("a", { createdAt: T }), job("x"), update("b", { createdAt: T + 1 })], T + 100);
    expect(released).toBe(2);
    expect(nextRunnable(jobs, T + 200)?.id).toBe("u-a");
    const second = markFinished(markRunning(jobs, "u-a", T + 200), "u-a", T + 300, { ok: true, pluginId: "a" });
    expect(nextRunnable(second, T + 300)?.id).toBe("u-b");
  });

  it("can be cancelled until they start", () => {
    const { jobs } = releaseHeld([update("a")], T);
    expect(cancelPending(jobs, "update:a", T).cancelled).toBe(true);
    expect(cancelPending([update("b")], "update:b", T).cancelled).toBe(true);
  });

  it("run this plugin's own update last, whatever order they were queued in", () => {
    const { jobs } = releaseHeld([update("plugin-triage"), update("a"), update("b")], T);
    expect(nextRunnable(jobs, T + 10, "plugin-triage")?.pluginId).toBe("a");
    const rest = jobs.filter((j) => j.pluginId !== "a");
    expect(nextRunnable(rest, T + 10, "plugin-triage")?.pluginId).toBe("b");
    expect(nextRunnable([jobs[0]!], T + 10, "plugin-triage")?.pluginId).toBe("plugin-triage");
  });

  it("record what bb did and the version it landed on", () => {
    const { jobs } = releaseHeld([update("a")], T);
    const done = markFinished(markRunning(jobs, "u-a", T), "u-a", T + 5, {
      ok: true,
      pluginId: "a",
      result: "updated",
      to: { version: "1.2.0", display: "1.2.0" },
    });
    expect(done[0]).toMatchObject({ state: "done", result: "updated", to: { version: "1.2.0" } });
  });
});

describe("the install queue", () => {
  it("waits out the grace period before a job is runnable", () => {
    const jobs = enqueue([], job("a"));
    expect(nextRunnable(jobs, T)).toBeNull();
    expect(nextWakeAt(jobs)).toBe(T + GRACE_MS);
    expect(nextRunnable(jobs, T + GRACE_MS)?.id).toBe("a");
  });

  it("runs one job at a time, oldest first", () => {
    let jobs = enqueue(enqueue([], job("late", { runAfter: T + 2 })), job("early", { runAfter: T + 1 }));
    expect(nextRunnable(jobs, T + 10)?.id).toBe("early");
    jobs = markRunning(jobs, "early", T + 10);
    expect(nextRunnable(jobs, T + 10)).toBeNull();
    jobs = markFinished(jobs, "early", T + 20, { ok: true, pluginId: "early" });
    expect(nextRunnable(jobs, T + 20)?.id).toBe("late");
  });

  it("keeps one live job per card", () => {
    const jobs = enqueue(enqueue([], job("a")), job("a2", { key: "a@bb-community" }));
    expect(jobs.map((j) => j.id)).toEqual(["a"]);
    const after = enqueue(markFinished(markRunning(jobs, "a", T), "a", T, { ok: false, error: "x" }), job("a2", { key: "a@bb-community" }));
    expect(after.map((j) => j.id)).toEqual(["a", "a2"]);
  });

  it("cancels only a job that has not started", () => {
    const pending = cancelPending(enqueue([], job("a")), "a@bb-community", T);
    expect(pending.cancelled).toBe(true);
    expect(pending.jobs[0]!.state).toBe("cancelled");
    expect(liveJob(pending.jobs, "a@bb-community")).toBeNull();

    const running = cancelPending(markRunning(enqueue([], job("b")), "b", T), "b@bb-community", T);
    expect(running.cancelled).toBe(false);
    expect(running.jobs[0]!.state).toBe("running");
  });

  it("records outcomes", () => {
    let jobs = markRunning(enqueue([], job("a")), "a", T);
    jobs = markFinished(jobs, "a", T + 1, { ok: false, error: "build failed" });
    expect(jobs[0]).toMatchObject({ state: "failed", error: "build failed", finishedAt: T + 1 });
    expect(failuresByKey(jobs)).toEqual({ "a@bb-community": "build failed" });
  });

  it("forgets a failure once a later attempt succeeds", () => {
    const jobs = [
      job("a", { state: "failed", error: "boom", finishedAt: T }),
      job("a2", { key: "a@bb-community", state: "done", finishedAt: T + 1 }),
    ];
    expect(failuresByKey(jobs)).toEqual({});
  });

  it("puts a job a reload interrupted back in line", () => {
    const jobs = recover(markRunning(enqueue([], job("a")), "a", T));
    expect(jobs[0]).toMatchObject({ state: "pending", startedAt: null });
    expect(nextRunnable(jobs, T + GRACE_MS)?.id).toBe("a");
  });

  it("keeps only the newest finished jobs, and every live one", () => {
    const finished = Array.from({ length: 5 }, (_, i) => job(`f${i}`, { state: "done", finishedAt: T + i }));
    const jobs = prune([...finished, job("live")], 2);
    expect(jobs.map((j) => j.id)).toEqual(["f3", "f4", "live"]);
  });
});
