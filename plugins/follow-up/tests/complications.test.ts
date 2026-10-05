import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLICATIONS_IMPLEMENTATION,
  createRegistry,
  getComplications,
  MAX_VALUE_LENGTH,
  normalizeValue,
  type ComplicationProviderRegistration,
  type ComplicationSubject,
} from "../lib/complications.ts";
import {
  FOLLOW_UP_PROGRESS,
  progressRegistration,
  progressValue,
} from "../lib/progress-complication.ts";

const ID = "test/progress";
const KEY = Symbol.for("bb-community.complications.v1");
const thread = (id: string): ComplicationSubject => ({ kind: "thread", id });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const value = (label: string) => ({ icon: "Circle", label });
const provider = (
  extra: Partial<ComplicationProviderRegistration> = {},
): ComplicationProviderRegistration => ({ id: ID, name: "Test progress", ...extra });

// The window

test("every bundle in a window gets the same registry", () => {
  const window = {};
  const first = getComplications(window);
  const second = getComplications(window);
  assert.ok(first !== null);
  assert.equal(first, second);
  assert.equal((window as Record<symbol, unknown>)[KEY], first, "under the v1 symbol");
});

test("a later bundle cannot replace the registry others subscribed to", () => {
  const window = {};
  const first = getComplications(window);
  assert.throws(() => {
    (window as Record<symbol, unknown>)[KEY] = {};
  });
  assert.equal(getComplications(window), first);
});

test("something that is not a registry under the symbol yields null, not a guess", () => {
  assert.equal(getComplications({ [KEY]: { protocol: 2 } }), null);
  const withoutDiscovery = { ...createRegistry() } as Record<string, unknown>;
  delete withoutDiscovery.providers;
  assert.equal(getComplications({ [KEY]: withoutDiscovery }), null, "v1 includes discovery");
});

test("a registry reports the implementation of the copy that created it", () => {
  assert.equal(createRegistry().implementation, COMPLICATIONS_IMPLEMENTATION);
  assert.equal(getComplications({})?.implementation, COMPLICATIONS_IMPLEMENTATION);
});

test("a newer copy that finds an older one in charge says so once, and still uses it", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const older = { ...createRegistry(), implementation: COMPLICATIONS_IMPLEMENTATION - 1 };
  const window = { [KEY]: older };
  assert.equal(getComplications(window), older, "the older registry is the window's registry");
  assert.equal(getComplications(window), older);
  assert.equal(warn.mock.callCount(), 1, "once per registry, not once per call");
  const message = String(warn.mock.calls[0]?.arguments[0]);
  assert.match(message, new RegExp(`implementation ${COMPLICATIONS_IMPLEMENTATION - 1}\\b`));
  assert.match(message, new RegExp(`implementation ${COMPLICATIONS_IMPLEMENTATION}\\b`));
});

test("a registry as new as this copy, or newer, raises nothing", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  for (const implementation of [COMPLICATIONS_IMPLEMENTATION, COMPLICATIONS_IMPLEMENTATION + 1]) {
    const registry = { ...createRegistry(), implementation };
    assert.equal(getComplications({ [KEY]: registry }), registry);
  }
  assert.equal(warn.mock.callCount(), 0);
});

test("a registry that predates the stamp counts as older", (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  const unstamped = { ...createRegistry() } as Record<string, unknown>;
  delete unstamped.implementation;
  assert.equal(getComplications({ [KEY]: unstamped }), unstamped);
  assert.equal(warn.mock.callCount(), 1);
});

// Wanting and providing

test("subjects wanted before the provider loaded are handed to it once it does", async () => {
  const registry = createRegistry();
  registry.want(ID, thread("a"));
  registry.want(ID, thread("b"));
  await settle();

  const delivered: string[][] = [];
  registry.provide(provider({ onWanted: (subjects) => delivered.push(subjects.map((s) => s.id)) }));
  assert.deepEqual(delivered, [], "not before provide returns: the provider has no handle yet");
  await settle();
  assert.deepEqual(delivered, [["a", "b"]]);
});

test("subjects wanted in the same tick reach the provider as one batch", async () => {
  const registry = createRegistry();
  const delivered: string[][] = [];
  registry.provide(provider({ onWanted: (subjects) => delivered.push(subjects.map((s) => s.id)) }));
  registry.want(ID, thread("a"));
  registry.want(ID, thread("b"));
  registry.want(ID, thread("a"));
  await settle();
  assert.deepEqual(delivered, [["a", "b"]]);
});

test("a subject released before the batch flushes is never asked for", async () => {
  const registry = createRegistry();
  const delivered: string[][] = [];
  registry.provide(provider({ onWanted: (subjects) => delivered.push(subjects.map((s) => s.id)) }));
  const release = registry.want(ID, thread("gone"));
  registry.want(ID, thread("kept"));
  release();
  await settle();
  assert.deepEqual(delivered, [["kept"]]);
});

test("a subject stays wanted until its last holder releases it", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  const first = registry.want(ID, thread("a"));
  const second = registry.want(ID, thread("a"));
  first();
  first();
  assert.equal(handle.isWanted(thread("a")), true, "a double release must not free someone else's hold");
  second();
  assert.equal(handle.isWanted(thread("a")), false);
});

test("wanting a released subject again asks the provider afresh, and keeps the old value meanwhile", async () => {
  const registry = createRegistry();
  const delivered: string[][] = [];
  const handle = registry.provide(
    provider({ onWanted: (subjects) => delivered.push(subjects.map((s) => s.id)) }),
  );
  const release = registry.want(ID, thread("a"));
  await settle();
  handle.set(thread("a"), value("one"));
  release();
  assert.equal(registry.read(ID, thread("a"))?.label, "one");
  registry.want(ID, thread("a"));
  await settle();
  assert.deepEqual(delivered, [["a"], ["a"]]);
});

// Subjects

test("any subject kind is carried, and an empty id names a singleton", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  handle.set({ kind: "app", id: "" }, value("app-wide"));
  handle.set({ kind: "url", id: "https://github.com/o/r/pull/1" }, value("a link"));
  assert.equal(registry.read(ID, { kind: "app", id: "" })?.label, "app-wide");
  assert.equal(registry.read(ID, { kind: "url", id: "https://github.com/o/r/pull/1" })?.label, "a link");
  assert.equal(registry.read(ID, { kind: "thread", id: "" }), undefined, "kind is part of identity");
});

test("no kind and id can be spelled to collide with another pair", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  handle.set({ kind: "a:b", id: "c" }, value("first"));
  handle.set({ kind: "a", id: "b:c" }, value("second"));
  assert.equal(registry.read(ID, { kind: "a:b", id: "c" })?.label, "first");
  assert.equal(registry.read(ID, { kind: "a", id: "b:c" })?.label, "second");
});

test("a subject without a kind is refused everywhere", async () => {
  const registry = createRegistry();
  const delivered: unknown[] = [];
  const handle = registry.provide(provider({ onWanted: (subjects) => delivered.push(subjects) }));
  const blank = { kind: " ", id: "x" };
  registry.want(ID, blank);
  handle.set(blank, value("nope"));
  await settle();
  assert.deepEqual(delivered, []);
  assert.equal(registry.read(ID, blank), undefined);
});

// Values

test("unknown, silent and answered are three different reads", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  assert.equal(registry.read(ID, thread("a")), undefined);
  handle.set(thread("a"), null);
  assert.equal(registry.read(ID, thread("a")), null);
  handle.set(thread("a"), value("yes"));
  assert.equal(registry.read(ID, thread("a"))?.label, "yes");
});

test("an unchanged value keeps its identity and wakes nobody, however deep the change", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  let wakes = 0;
  registry.subscribe(ID, thread("a"), () => wakes++);
  const rich = (row: string) => ({
    icon: "Circle",
    label: "x",
    detail: { rows: [{ label: "Checks", value: row }] },
  });
  handle.set(thread("a"), rich("2 failing"));
  const first = registry.read(ID, thread("a"));
  handle.set(thread("a"), rich("2 failing"));
  assert.equal(registry.read(ID, thread("a")), first);
  assert.equal(wakes, 1);
  handle.set(thread("a"), rich("all green"));
  assert.equal(wakes, 2, "a change inside a detail row is a change");
  assert.notEqual(registry.read(ID, thread("a")), first);
});

test("named fields are checked: a bad required one refuses the value, a bad optional one is dropped", () => {
  assert.equal(normalizeValue({ icon: "Circle", label: " " }), undefined);
  assert.equal(normalizeValue({ label: "No icon" }), undefined);
  assert.equal(normalizeValue("text"), undefined);
  assert.equal(normalizeValue(null), null);
  assert.deepEqual(normalizeValue({ icon: "Circle", label: "x", tone: 5, text: "  ", fraction: 7 }), {
    icon: "Circle",
    label: "x",
    fraction: 1,
  });
  assert.equal(normalizeValue({ icon: "Circle", label: "x", fraction: -1 })?.fraction, 0);
  assert.equal(normalizeValue({ icon: "Circle", label: "x", fraction: Number.NaN })?.fraction, undefined);
});

test("a tone is an open string, so a tone added later still arrives", () => {
  assert.equal(normalizeValue({ icon: "Circle", label: "x", tone: "info" })?.tone, "info");
  assert.equal(normalizeValue({ icon: "Circle", label: "x", tone: "urgent" })?.tone, "urgent");
  assert.equal(normalizeValue({ icon: "Circle", label: "x", tone: "x".repeat(33) })?.tone, undefined);
});

test("fields this protocol does not name pass through as JSON", () => {
  const stored = normalizeValue({
    icon: "Circle",
    label: "x",
    urgency: 2,
    source: { host: "github", at: new Date(0) },
    callback: () => "smuggled",
  }) as unknown as Record<string, unknown> | null | undefined;
  assert.equal(stored?.urgency, 2);
  assert.deepEqual(stored?.source, { host: "github", at: "1970-01-01T00:00:00.000Z" });
  assert.equal("callback" in (stored ?? {}), false, "a function is not JSON");
});

test("an unknown field that cannot be JSON is dropped, and the value kept", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const stored = normalizeValue({ icon: "Circle", label: "x", cyclic, big: 1n }) as unknown as Record<string, unknown>;
  assert.equal(stored.label, "x");
  assert.equal("cyclic" in stored, false);
  assert.equal("big" in stored, false);
});

test("a __proto__ field stays a field and never becomes a prototype", () => {
  const stored = normalizeValue(JSON.parse('{"icon":"Circle","label":"x","__proto__":{"polluted":true}}'));
  assert.equal(Object.getPrototypeOf(stored), Object.prototype);
  assert.equal((stored as unknown as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptor(stored, "__proto__")?.value, { polluted: true });
});

test("a stored value is frozen all the way down", () => {
  const stored = normalizeValue({
    icon: "Circle",
    label: "x",
    detail: { rows: [{ label: "a", value: "b", open: { href: "/x" } }] },
    extra: { nested: [1, { deep: true }] },
  }) as Record<string, any>;
  assert.ok(Object.isFrozen(stored));
  assert.ok(Object.isFrozen(stored.detail.rows[0].open));
  assert.ok(Object.isFrozen(stored.extra.nested[1]));
});

test("a value over the size cap is refused", () => {
  const near = { icon: "Circle", label: "x", note: "" };
  const overhead = JSON.stringify(near).length;
  assert.ok(normalizeValue({ ...near, note: "y".repeat(MAX_VALUE_LENGTH - overhead) }));
  assert.equal(normalizeValue({ ...near, note: "y".repeat(MAX_VALUE_LENGTH - overhead + 1) }), undefined);
});

test("a value that is not a complication is ignored, keeping the last good one", (t) => {
  t.mock.method(console, "warn", () => undefined);
  const registry = createRegistry();
  const handle = registry.provide(provider());
  handle.set(thread("a"), value("good"));
  handle.set(thread("a"), { label: "no icon" } as never);
  assert.equal(registry.read(ID, thread("a"))?.label, "good");
});

// Reserved fields

test("detail and open pass through untouched, for the first surface that draws them to define", () => {
  const detail = {
    title: "PR #12",
    rows: [
      ...Array.from({ length: 12 }, (_, i) => ({ label: `row ${i}`, value: String(i) })),
      { label: "a row with no value" },
    ],
  };
  const open = { command: "github/rerun-checks" };
  const stored = normalizeValue({ icon: "Circle", label: "x", detail, open }) as unknown as Record<string, unknown>;
  assert.deepEqual(stored.detail, detail, "no row cap, no required value");
  assert.deepEqual(stored.open, open, "not limited to an href");
  assert.ok(Object.isFrozen((stored.detail as { rows: object[] }).rows[12]));
});

test("an href is not the registry's to vet: it arrives as sent, and a surface must check it", () => {
  const stored = normalizeValue({ icon: "Circle", label: "x", open: { href: "javascript:alert(1)" } }) as unknown as Record<string, unknown>;
  assert.deepEqual(stored.open, { href: "javascript:alert(1)" });
});

// Withdrawal and replacement

test("withdrawing clears the provider's values and tells the surfaces drawing them", () => {
  const registry = createRegistry();
  const handle = registry.provide(provider());
  handle.set(thread("a"), value("a"));
  const heard: string[] = [];
  registry.subscribe(ID, thread("a"), () => heard.push("value"));
  registry.subscribe(ID, null, () => heard.push("presence"));
  handle.dispose();
  assert.equal(registry.isProvided(ID), false);
  assert.equal(registry.read(ID, thread("a")), undefined);
  assert.deepEqual(heard, ["value", "presence"]);
  handle.set(thread("a"), value("late"));
  assert.equal(registry.read(ID, thread("a")), undefined, "a withdrawn handle publishes nothing");
});

test("a replaced provider's late cleanup cannot wipe its replacement", () => {
  // A hot reload: the new generation registers, then the old one unmounts.
  const registry = createRegistry();
  const old = registry.provide(provider());
  const replacement = registry.provide(provider());
  replacement.set(thread("a"), value("new"));
  old.set(thread("a"), value("stale"));
  old.dispose();
  assert.equal(registry.isProvided(ID), true);
  assert.equal(registry.read(ID, thread("a"))?.label, "new");
});

// Discovery

test("ids must be <pluginId>/<name> and every provider needs a name", () => {
  const registry = createRegistry();
  for (const id of ["progress", "Follow-Up/progress", "follow-up/", "/progress", "a/b/c", "a--b/c", "a/b "]) {
    assert.throws(() => registry.provide(provider({ id })), TypeError, `refused: ${id}`);
  }
  assert.throws(() => registry.provide(provider({ name: " " })), TypeError);
  assert.doesNotThrow(() => registry.provide(provider({ id: "worktree-ports/app-ports" })));
});

test("providers() lists what is live, without callbacks, and is stable until it changes", () => {
  const registry = createRegistry();
  const handle = registry.provide(
    provider({
      description: "How much is closed.",
      subjects: ["thread", " ", 3 as never],
      sample: { icon: "Circle", label: "1 of 2" },
      onWanted: () => undefined,
      families: ["gauge"],
    } as Partial<ComplicationProviderRegistration>),
  );
  const listed = registry.providers();
  assert.deepEqual(listed, [
    {
      id: ID,
      name: "Test progress",
      description: "How much is closed.",
      subjects: ["thread"],
      sample: { icon: "Circle", label: "1 of 2" },
      families: ["gauge"],
    },
  ]);
  assert.equal(registry.providers(), listed, "same array until something changes");
  assert.ok(Object.isFrozen(listed[0]));
  handle.dispose();
  assert.notEqual(registry.providers(), listed);
  assert.deepEqual(registry.providers(), []);
});

test("subscribeProviders hears a provider arrive, get replaced and leave", () => {
  const registry = createRegistry();
  let heard = 0;
  const stop = registry.subscribeProviders(() => heard++);
  const first = registry.provide(provider());
  registry.provide(provider({ name: "Renamed" }));
  assert.equal(registry.providers()[0]?.name, "Renamed");
  first.dispose();
  assert.equal(heard, 2, "the replaced generation's cleanup is not a change");
  assert.equal(registry.providers().length, 1, "the replacement is still live");
  stop();
  registry.provide(provider({ id: "test/other" }));
  assert.equal(heard, 2);
});

// Containment

test("another plugin's throwing code is contained", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const registry = createRegistry();
  const handle = registry.provide(
    provider({
      onWanted: () => {
        throw new Error("provider bug");
      },
    }),
  );
  assert.doesNotThrow(() => registry.want(ID, thread("a")));
  await settle();

  let heard = false;
  registry.subscribe(ID, thread("a"), () => {
    throw new Error("surface bug");
  });
  registry.subscribe(ID, thread("a"), () => {
    heard = true;
  });
  registry.subscribeProviders(() => {
    throw new Error("settings bug");
  });
  assert.doesNotThrow(() => handle.set(thread("a"), value("a")));
  assert.equal(heard, true, "one surface's throw must not starve the next");
  assert.doesNotThrow(() => registry.provide(provider({ id: "test/other" })));
});

// Follow Up's own complication

test("progress: a thread that never recorded a follow-up says nothing", () => {
  assert.equal(progressValue({ open: 0, done: 0 }), null);
});

test("progress: a partly closed list is a quiet gauge with the open count", () => {
  assert.deepEqual(progressValue({ open: 1, done: 27 }), {
    icon: "TextWrap",
    label: "27 of 28 follow-ups done",
    tone: "default",
    fraction: 27 / 28,
    text: "1",
  });
});

test("progress: a clear list is a full green gauge with nothing left to count", () => {
  assert.deepEqual(progressValue({ open: 0, done: 3 }), {
    icon: "TextWrap",
    label: "All 3 follow-ups done",
    tone: "success",
    fraction: 1,
  });
  assert.equal(progressValue({ open: 0, done: 1 })?.label, "All 1 follow-up done");
});

test("progress: the value survives the registry unchanged", () => {
  const registry = createRegistry();
  const handle = registry.provide({ id: FOLLOW_UP_PROGRESS, name: "Follow-up progress" });
  const published = progressValue({ open: 2, done: 2 });
  handle.set(thread("a"), published);
  assert.deepEqual(registry.read(FOLLOW_UP_PROGRESS, thread("a")), published);
});

test("progress: the registry accepts Follow Up's registration and lists it with a preview", async () => {
  const registry = createRegistry();
  const asked: string[][] = [];
  registry.provide(progressRegistration((threadIds) => asked.push(threadIds)));
  assert.deepEqual(registry.providers(), [
    {
      id: FOLLOW_UP_PROGRESS,
      name: "Follow-up progress",
      description: "How much of a thread's follow-up list is closed.",
      subjects: ["thread"],
      sample: progressValue({ open: 1, done: 3 }),
    },
  ]);
  registry.want(FOLLOW_UP_PROGRESS, thread("a"));
  registry.want(FOLLOW_UP_PROGRESS, { kind: "project", id: "p" });
  await settle();
  assert.deepEqual(asked, [["a"]], "only threads reach the counts call");
});
