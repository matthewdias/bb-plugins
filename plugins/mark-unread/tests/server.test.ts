// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { POINT_CHANGED, type ReadPoint } from "../lib/read-point";

const T = "thr_a";
const MESSAGE = `${T}:user-seed:12`;

async function host(options: { markUnread?: () => unknown } = {}) {
  const fake = createFakePluginHost({
    sdk: {
      threads: {
        markUnread: options.markUnread ?? (async () => makeThreadResponse({ id: T })),
        markRead: async () => makeThreadResponse({ id: T }),
      },
    },
  });
  await plugin(fake.bb);
  return fake.harness;
}

type Harness = Awaited<ReturnType<typeof host>>;

const get = async (harness: Harness, threadId = T) =>
  ((await harness.callRpc("points_get", { threadId })) as { point: ReadPoint | null }).point;

const set = async (harness: Harness, overrides: Record<string, unknown> = {}) =>
  ((await harness.callRpc("points_set", {
    threadId: T,
    messageId: MESSAGE,
    role: "user",
    sourceSeqEnd: 12,
    ...overrides,
  })) as { point: ReadPoint }).point;

describe("setting a point", () => {
  it("stores it, marks the thread unread, and tells every window", async () => {
    const harness = await host();
    const point = await set(harness);
    expect(point).toMatchObject({ threadId: T, messageId: MESSAGE, role: "user", sourceSeqEnd: 12 });
    expect(await get(harness)).toEqual(point);
    expect(harness.sdk.callsTo("threads.markUnread")).toEqual([[{ threadId: T }]]);
    expect(harness.realtimeSignals).toEqual([{ channel: POINT_CHANGED, payload: { threadId: T } }]);
  });

  it("replaces an earlier point", async () => {
    const harness = await host();
    await set(harness);
    const later = `${T}:assistant:kind:assistant|turn:t1|parent:root|item:i2`;
    await set(harness, { messageId: later, role: "assistant", sourceSeqEnd: null });
    expect(await get(harness)).toMatchObject({ messageId: later, sourceSeqEnd: null });
  });

  it("refuses a message from another thread", async () => {
    const harness = await host();
    await expect(set(harness, { messageId: "thr_b:user-seed:12" })).rejects.toThrow(/not in thread/);
    expect(harness.sdk.callsTo("threads.markUnread")).toEqual([]);
    expect(await get(harness)).toBeNull();
  });

  it("refuses a thread id that is only a prefix of the message's", async () => {
    const harness = await host();
    await expect(set(harness, { threadId: "thr", messageId: "thr_a:user-seed:1" })).rejects.toThrow(/not in thread/);
  });

  it("stores nothing when bb cannot mark the thread unread", async () => {
    const harness = await host({
      markUnread: async () => {
        throw new Error("Thread not found");
      },
    });
    await expect(set(harness)).rejects.toThrow(/Thread not found/);
    expect(await get(harness)).toBeNull();
    expect(harness.realtimeSignals).toEqual([]);
  });

  it("keeps points across a reload", async () => {
    const harness = await host();
    const point = await set(harness);
    const reloaded = await harness.reload(plugin);
    expect(await get(reloaded.harness)).toEqual(point);
  });
});

describe("clearing a point", () => {
  it("forgets it and tells every window, leaving read state alone", async () => {
    const harness = await host();
    await set(harness);
    expect(await harness.callRpc("points_clear", { threadId: T })).toEqual({ cleared: true });
    expect(await get(harness)).toBeNull();
    expect(harness.realtimeSignals.at(-1)).toEqual({ channel: POINT_CHANGED, payload: { threadId: T } });
    expect(harness.sdk.callsTo("threads.markRead")).toEqual([]);
  });

  it("marks the thread read when asked, for Undo", async () => {
    const harness = await host();
    const point = await set(harness);
    await harness.callRpc("points_clear", { threadId: T, markRead: true });
    expect(harness.sdk.callsTo("threads.markRead")).toEqual([[{ threadId: T }]]);
    expect(await get(harness)).toBeNull();
  });

  it("clears a point set before the caller's visit began", async () => {
    const harness = await host();
    const point = await set(harness);
    expect(await harness.callRpc("points_clear", { threadId: T, setBefore: point.setAt + 1 })).toEqual({ cleared: true });
    expect(await get(harness)).toBeNull();
  });

  it("keeps a point set since the caller's visit began", async () => {
    const harness = await host();
    const point = await set(harness);
    expect(await harness.callRpc("points_clear", { threadId: T, setBefore: point.setAt })).toEqual({ cleared: false });
    expect(await get(harness)).toEqual(point);
  });

  it("reports nothing to clear, without signalling", async () => {
    const harness = await host();
    expect(await harness.callRpc("points_clear", { threadId: T })).toEqual({ cleared: false });
    expect(harness.realtimeSignals).toEqual([]);
  });
});

describe("thread deletion", () => {
  it("drops the deleted thread's point and no other", async () => {
    const harness = await host();
    await set(harness);
    await set(harness, { threadId: "thr_b", messageId: "thr_b:user-seed:3" });
    await harness.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: T }) });
    expect(await get(harness)).toBeNull();
    expect(await get(harness, "thr_b")).not.toBeNull();
  });
});

describe("settings", () => {
  it("offers Option, Command and Shift, defaulting to Option", async () => {
    const harness = await host();
    expect(harness.registrations.settingsDescriptors.modifier).toMatchObject({
      type: "select",
      options: ["Option", "Command", "Shift", "Off"],
      default: "Option",
    });
  });
});
