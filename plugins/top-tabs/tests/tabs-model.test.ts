import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSED_LIMIT,
  EMPTY_STATE,
  SETTINGS,
  THREADS,
  activeTabFor,
  ago,
  adopt,
  close,
  closeOthers,
  closeToRight,
  cycle,
  groupThreads,
  defaultPathFor,
  isAppPath,
  isDestinationAction,
  isPinned,
  leavesSettings,
  move,
  moveBefore,
  panesOf,
  panesOnScreen,
  pathFits,
  pin,
  parseState,
  recordPath,
  recordRecent,
  recordRecentThread,
  reopen,
  seed,
  sidebarStep,
  splitPartner,
  successorAfterClose,
  threadGroup,
  threadIdFromPath,
  threadPaneFor,
  unpin,
  type RouteTarget,
  type SplitPane,
  type ThreadFacts,
  type TabsState,
} from "../lib/tabs-model.ts";

const state = (patch: Partial<TabsState>): TabsState => ({ ...EMPTY_STATE, ...patch });
const targets: RouteTarget[] = [
  { id: "gh/gh", kind: "open-plugin-panel", pluginId: "gh", panelId: "gh" },
  { id: "usage/usage", kind: "open-plugin-panel", pluginId: "usage", panelId: "usage" },
  { id: "usage/activity", kind: "open-plugin-panel", pluginId: "usage", panelId: "activity" },
  { id: "__bb__/extensions", kind: "open-extensions", pluginId: null, panelId: null },
  { id: "__bb__/skills", kind: "open-skills", pluginId: null, panelId: null },
];
const target = (id: string) => targets.find((t) => t.id === id)!;
const settingsTarget: RouteTarget = { id: SETTINGS, kind: "open-settings", pluginId: null, panelId: null };

test("bb's reported active item wins", () => {
  assert.equal(
    activeTabFor({ activeItemId: "gh/gh", pathname: "/plugins/gh/gh/pulls/4" }, targets),
    "gh/gh",
  );
});

test("a reported active item that the route does not fit is ignored", () => {
  // bb still reports the panel the user just left, one render behind the URL.
  assert.equal(
    activeTabFor({ activeItemId: "gh/gh", pathname: "/plugins" }, targets),
    "__bb__/extensions",
  );
  assert.equal(activeTabFor({ activeItemId: "gh/gh", pathname: "/projects/p" }, targets), THREADS);
});

test("an item kind this plugin does not know is trusted as reported", () => {
  const extra: RouteTarget = { id: "__bb__/new", kind: "open-new-thing", pluginId: null, panelId: null };
  assert.equal(
    activeTabFor({ activeItemId: "__bb__/new", pathname: "/new-thing" }, [...targets, extra]),
    "__bb__/new",
  );
});

test("threads, compose and project routes belong to Threads", () => {
  for (const pathname of ["/", "/projects/p/threads/t", "/projects/p"]) {
    assert.equal(activeTabFor({ activeItemId: null, pathname }, targets), THREADS);
  }
  // bb marks the compose screen with its New thread item, which is an action.
  assert.equal(activeTabFor({ activeItemId: "__bb__/new-thread", pathname: "/" }, targets), THREADS);
});

test("bb's own pages are recognised by route", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins" }, targets), "__bb__/extensions");
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/skills" }, targets), "__bb__/skills");
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/skills/x" }, targets), "__bb__/skills");
});

test("a panel route without an active item finds its panel", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh/gh/pulls/4" }, targets), "gh/gh");
  assert.equal(
    activeTabFor({ activeItemId: null, pathname: "/plugins/usage/activity" }, targets),
    "usage/activity",
  );
  // A one-panel plugin owns its routes whatever the segment says.
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/gh/board" }, targets), "gh/gh");
  // Two panels and no match: no guess.
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/usage/other" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/plugins/unknown/x" }, targets), null);
});

test("settings belongs to no tab unless the strip offers one", () => {
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings/appearance" }, targets), null);
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settingsish" }, targets), THREADS);
  const withSettings = [...targets, settingsTarget];
  assert.equal(activeTabFor({ activeItemId: null, pathname: "/settings" }, withSettings), SETTINGS);
  assert.equal(
    activeTabFor({ activeItemId: null, pathname: "/settings/plugins/x" }, withSettings),
    SETTINGS,
  );
});

test("the Settings tab remembers which settings page it was on", () => {
  assert.equal(pathFits(SETTINGS, settingsTarget, "/settings/appearance"), true);
  assert.equal(pathFits(SETTINGS, settingsTarget, "/projects/p"), false);
  assert.equal(defaultPathFor(settingsTarget), "/settings");
});

test("adopting appends once and never adds Threads", () => {
  const once = adopt(state({ open: ["gh/gh"] }), "usage/usage");
  assert.deepEqual(once.open, ["gh/gh", "usage/usage"]);
  assert.equal(adopt(once, "usage/usage"), once);
  assert.equal(adopt(once, THREADS), once);
});

test("seeding fills the strip once", () => {
  const seeded = seed(EMPTY_STATE, ["gh/gh", "usage/usage"]);
  assert.deepEqual(seeded.open, ["gh/gh", "usage/usage"]);
  assert.equal(seeded.seeded, true);
  assert.equal(seed(close(seeded, ["gh/gh"]), ["gh/gh"]).open.includes("gh/gh"), false);
});

test("recording a path ignores anything that is not an in-app path", () => {
  const s = recordPath(EMPTY_STATE, "gh/gh", "/plugins/gh/gh/pulls/4");
  assert.equal(s.paths["gh/gh"], "/plugins/gh/gh/pulls/4");
  assert.equal(recordPath(s, "gh/gh", "//evil.example/x"), s);
  assert.equal(recordPath(s, "gh/gh", "https://evil.example/"), s);
  assert.equal(recordPath(s, "gh/gh", "/plugins/gh/gh/pulls/4"), s);
});

test("a location only fits the tab that owns it", () => {
  assert.equal(pathFits(THREADS, null, "/projects/p/threads/t"), true);
  assert.equal(pathFits(THREADS, null, "/plugins/gh/gh"), false);
  assert.equal(pathFits(THREADS, null, "/plugins"), false);
  assert.equal(pathFits(THREADS, null, "/settings"), false);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/gh/gh/pulls/4"), true);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/usage/usage"), false);
  assert.equal(pathFits("gh/gh", target("gh/gh"), "/plugins/ghost/x"), false);
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/plugins"), true);
  assert.equal(pathFits("__bb__/extensions", target("__bb__/extensions"), "/projects/p"), false);
  assert.equal(pathFits("gone/gone", null, "/plugins/gone/gone"), false);
});

test("New thread and Search are actions, everything else is a destination", () => {
  assert.equal(isDestinationAction("new-thread"), false);
  assert.equal(isDestinationAction("search-threads"), false);
  assert.equal(isDestinationAction("open-plugin-panel"), true);
  assert.equal(isDestinationAction("open-extensions"), true);
  assert.equal(isDestinationAction("open-automations"), true);
});

test("the Threads tab knows which thread it will return to", () => {
  assert.equal(threadIdFromPath("/projects/p/threads/thr_ab12"), "thr_ab12");
  assert.equal(threadIdFromPath("/threads/thr_ab12?x=1"), "thr_ab12");
  assert.equal(threadIdFromPath("/projects/p"), null);
  assert.equal(threadIdFromPath("/"), null);
  assert.equal(threadIdFromPath(undefined), null);
});

test("a destination has a fallback path for when bb cannot open it", () => {
  assert.equal(defaultPathFor(target("gh/gh")), "/plugins/gh/gh");
  assert.equal(defaultPathFor(target("__bb__/extensions")), "/plugins");
  assert.equal(defaultPathFor(target("__bb__/skills")), "/skills");
  assert.equal(defaultPathFor({ id: "x", kind: "open-automations", pluginId: null, panelId: null }), null);
  assert.equal(
    defaultPathFor({ id: "x", kind: "open-plugin-panel", pluginId: "a/b", panelId: "c" }),
    "/plugins/a%2Fb/c",
  );
});

test("isAppPath rejects protocol-relative and backslash paths", () => {
  assert.equal(isAppPath("/a"), true);
  assert.equal(isAppPath("//a"), false);
  assert.equal(isAppPath("/\\a"), false);
  assert.equal(isAppPath("a"), false);
  assert.equal(isAppPath(1), false);
});

test("closing the tab in view moves right, then left, then to Threads", () => {
  const open = ["a", "b", "c"];
  assert.equal(successorAfterClose(open, "b", "b"), "c");
  assert.equal(successorAfterClose(open, "c", "c"), "b");
  assert.equal(successorAfterClose(["a"], "a", "a"), THREADS);
});

test("closing a background tab keeps the tab in view", () => {
  assert.equal(successorAfterClose(["a", "b"], "a", "b"), "b");
  assert.equal(successorAfterClose(["a", "b"], "a", THREADS), THREADS);
});

test("closing forgets the location and remembers it for reopening", () => {
  const s = close(state({ open: ["a", "b"], paths: { a: "/plugins/a/a/x" } }), ["a"]);
  assert.deepEqual(s.open, ["b"]);
  assert.equal(s.paths.a, undefined);
  assert.deepEqual(s.closed[0], { id: "a", path: "/plugins/a/a/x", index: 0 });
});

test("reopening restores position and location", () => {
  const closed = close(state({ open: ["a", "b", "c"], paths: { b: "/plugins/b/b/deep" } }), ["b"]);
  const { state: s, tab } = reopen(closed, () => true);
  assert.equal(tab?.id, "b");
  assert.deepEqual(s.open, ["a", "b", "c"]);
  assert.equal(s.paths.b, "/plugins/b/b/deep");
  assert.equal(s.closed.length, 0);
});

test("reopening skips destinations that are gone", () => {
  const closed = close(state({ open: ["a", "b"] }), ["a", "b"]);
  const { tab } = reopen(closed, (id) => id === "a");
  assert.equal(tab?.id, "a");
  assert.equal(reopen(closed, () => false).tab, null);
});

test("a closed batch reopens left to right", () => {
  let s = closeOthers(state({ open: ["a", "b", "c", "d"] }), "c");
  assert.deepEqual(s.open, ["c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b", "c"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b", "c", "d"]);
});

test("a batch reopens left to right whatever order it was closed in", () => {
  let s = close(state({ open: ["a", "b", "c"] }), ["c", "a"]);
  assert.deepEqual(s.open, ["b"]);
  s = reopen(s, () => true).state;
  assert.deepEqual(s.open, ["a", "b"]);
});

test("closed history is capped and deduplicated", () => {
  let s = state({ open: Array.from({ length: CLOSED_LIMIT + 3 }, (_, i) => `t${i}`) });
  for (const id of [...s.open]) s = close(s, [id]);
  assert.equal(s.closed.length, CLOSED_LIMIT);
  s = adopt(s, "t12");
  s = close(s, ["t12"]);
  assert.equal(s.closed.filter((c) => c.id === "t12").length, 1);
});

test("close to the right of Threads closes everything", () => {
  assert.deepEqual(closeToRight(state({ open: ["a", "b"] }), THREADS).open, []);
  assert.deepEqual(closeToRight(state({ open: ["a", "b", "c"] }), "a").open, ["a"]);
  const s = state({ open: ["a"] });
  assert.equal(closeToRight(s, "missing"), s);
});

test("move clamps and keeps every tab", () => {
  const s = state({ open: ["a", "b", "c"] });
  assert.deepEqual(move(s, "a", 2).open, ["b", "c", "a"]);
  assert.deepEqual(move(s, "c", -5).open, ["c", "a", "b"]);
  assert.equal(move(s, "b", 1), s);
});

test("cycle wraps in both directions", () => {
  const order = [THREADS, "a", "b"];
  assert.equal(cycle(order, "b", 1), THREADS);
  assert.equal(cycle(order, THREADS, -1), "b");
  assert.equal(cycle(order, null, 1), THREADS);
  assert.equal(cycle(order, null, -1), "b");
});

test("leaving Threads collapses an open sidebar and remembers it was open", () => {
  assert.deepEqual(
    sidebarStep({ previous: THREADS, next: "a", sidebarOpen: true, threadsSidebarOpen: false }),
    { action: "collapse", threadsSidebarOpen: true },
  );
});

test("leaving Threads with the sidebar collapsed remembers that too", () => {
  assert.deepEqual(
    sidebarStep({ previous: THREADS, next: "a", sidebarOpen: false, threadsSidebarOpen: true }),
    { action: null, threadsSidebarOpen: false },
  );
});

test("returning to Threads reopens the sidebar only if it was open", () => {
  assert.equal(
    sidebarStep({ previous: "a", next: THREADS, sidebarOpen: false, threadsSidebarOpen: true })
      .action,
    "expand",
  );
  assert.equal(
    sidebarStep({ previous: "a", next: THREADS, sidebarOpen: false, threadsSidebarOpen: false })
      .action,
    null,
  );
  assert.equal(
    sidebarStep({ previous: "a", next: THREADS, sidebarOpen: true, threadsSidebarOpen: true })
      .action,
    null,
  );
});

test("moving between two tabs leaves a hand-opened sidebar alone", () => {
  assert.deepEqual(
    sidebarStep({ previous: "a", next: "b", sidebarOpen: true, threadsSidebarOpen: true }),
    { action: null, threadsSidebarOpen: true },
  );
});

test("the first look collapses on a tab", () => {
  assert.equal(
    sidebarStep({ previous: undefined, next: "a", sidebarOpen: true, threadsSidebarOpen: true })
      .action,
    "collapse",
  );
});

test("loading the app on Threads restores the sidebar the user keeps there", () => {
  // Reloaded on a thread after a tab had collapsed the sidebar.
  assert.equal(
    sidebarStep({ previous: undefined, next: THREADS, sidebarOpen: false, threadsSidebarOpen: true })
      .action,
    "expand",
  );
  assert.equal(
    sidebarStep({ previous: undefined, next: THREADS, sidebarOpen: false, threadsSidebarOpen: false })
      .action,
    null,
  );
});

test("Threads never collapses the sidebar", () => {
  for (const previous of [undefined, null, "a"]) {
    assert.equal(
      sidebarStep({ previous, next: THREADS, sidebarOpen: true, threadsSidebarOpen: false }).action,
      null,
    );
  }
});

test("the first sight of Threads learns the preference instead of imposing one", () => {
  assert.deepEqual(
    sidebarStep({ previous: undefined, next: THREADS, sidebarOpen: false, threadsSidebarOpen: null }),
    { action: null, threadsSidebarOpen: false },
  );
  assert.deepEqual(
    sidebarStep({ previous: "a", next: THREADS, sidebarOpen: true, threadsSidebarOpen: null }),
    { action: null, threadsSidebarOpen: true },
  );
});

test("settings leaves the sidebar alone", () => {
  assert.equal(
    sidebarStep({ previous: THREADS, next: null, sidebarOpen: true, threadsSidebarOpen: true })
      .action,
    null,
  );
});

test("parseState keeps the well-formed parts of hostile input", () => {
  assert.deepEqual(parseState(null), EMPTY_STATE);
  assert.deepEqual(parseState("x"), EMPTY_STATE);
  const parsed = parseState({
    open: ["a", "a", THREADS, 4, "", "b"],
    paths: { a: "/plugins/a/a", b: "//evil", c: 3 },
    closed: [{ id: "c", path: "https://x", index: -1 }, { id: THREADS }, "junk"],
    threadsSidebarOpen: "yes",
    seeded: true,
    recent: ["a", "a", 3, "b"],
  });
  assert.deepEqual(parsed, {
    open: ["a", "b"],
    pinned: [],
    paths: { a: "/plugins/a/a" },
    closed: [{ id: "c", path: null, index: 0 }],
    threadsSidebarOpen: null,
    seeded: true,
    recent: ["a", "b"],
    recentThreads: [],
  });
});

const half = (x: number) => ({ x, y: 0, width: 0.5, height: 1 });
const pane = (paneId: string, x: number, threadId: string | null, isFocused = false): SplitPane => ({
  paneId,
  rect: half(x),
  threadId,
  isFocused,
});

test("no split, no panes", () => {
  assert.equal(panesOnScreen(null, new Map(), THREADS), null);
  assert.equal(panesOnScreen([pane("p1", 0, "t1", true)], new Map(), THREADS), null);
});

test("each pane belongs to the tab it shows", () => {
  const screen = panesOnScreen(
    [pane("p1", 0, "t1"), pane("p2", 0.5, null, true), pane("p3", 0.5, null)],
    new Map([["gh/gh", ["p2"]]]),
    "gh/gh",
  );
  assert.deepEqual(
    screen?.map((p) => p.tab),
    [THREADS, "gh/gh", null],
  );
  assert.deepEqual(panesOf(screen, "gh/gh").map((p) => p.paneId), ["p2"]);
  assert.deepEqual(panesOf(null, THREADS), []);
});

test("Threads focuses the thread it last showed, else the first thread pane", () => {
  const screen = panesOnScreen([pane("p1", 0, "t1"), pane("p2", 0.5, "t2", true)], new Map(), THREADS);
  assert.equal(threadPaneFor(screen, "t2")?.paneId, "p2");
  assert.equal(threadPaneFor(screen, "t9")?.paneId, "p1");
  assert.equal(threadPaneFor(screen, null)?.paneId, "p1");
  const noThreads = panesOnScreen([pane("p1", 0, null), pane("p2", 0.5, null)], new Map(), "gh/gh");
  assert.equal(threadPaneFor(noThreads, "t1"), null);
});

test("a split bb is holding while another page has the view is not on screen", () => {
  const layout = [pane("p1", 0, "t1", true), pane("p2", 0.5, null)];
  const destinations = new Map([["gh/gh", ["p2"]]]);
  assert.notEqual(panesOnScreen(layout, destinations, THREADS), null);
  // bb's Plugins page took the whole view; the split waits in memory, and
  // the page has taken over the focused pane's slot.
  assert.equal(panesOnScreen(layout, destinations, "__bb__/extensions"), null);
  const taken = [pane("p1", 0, "t1"), pane("p2", 0.5, null, true)];
  assert.equal(panesOnScreen(taken, new Map(), "__bb__/extensions"), null);
  assert.equal(panesOnScreen(layout, destinations, null), null);
});

test("a split stays on screen while bb's focus catches up with the route", () => {
  // The route already shows gh/gh; bb still calls the thread pane focused.
  const layout = [pane("p1", 0, "t1", true), pane("p2", 0.5, null)];
  assert.notEqual(panesOnScreen(layout, new Map([["gh/gh", ["p2"]]]), "gh/gh"), null);
});

test("recent tabs move to the front and are capped", () => {
  let s = EMPTY_STATE;
  for (const id of ["a", "b", "a", THREADS]) s = recordRecent(s, id);
  assert.deepEqual(s.recent, [THREADS, "a", "b"]);
  assert.equal(recordRecent(s, THREADS), s);
  for (let i = 0; i < 20; i++) s = recordRecent(s, `t${i}`);
  assert.equal(s.recent.length, 10);
});

test("splitting the tab in view pairs it with the tab before it", () => {
  const can = () => true;
  assert.equal(splitPartner("gh/gh", ["gh/gh", "usage/usage", THREADS], [THREADS], can), "usage/usage");
  // Nothing usable in the history: the fallbacks, in order.
  assert.equal(splitPartner("gh/gh", ["gh/gh"], [THREADS], can), THREADS);
  assert.equal(splitPartner(THREADS, [THREADS], ["gh/gh", "usage/usage"], can), "gh/gh");
});

test("a partner that cannot sit in a pane is skipped", () => {
  const can = (id: string) => id !== "__bb__/extensions";
  assert.equal(splitPartner("gh/gh", ["__bb__/extensions", THREADS], [], can), THREADS);
  assert.equal(splitPartner("gh/gh", ["__bb__/extensions"], [], can), null);
});

test("pinning moves a tab to the end of the pinned group", () => {
  let s = state({ open: ["a", "b", "c"] });
  s = pin(s, "c");
  assert.deepEqual(s.open, ["c", "a", "b"]);
  s = pin(s, "b");
  assert.deepEqual(s.open, ["c", "b", "a"]);
  assert.deepEqual(s.pinned, ["c", "b"]);
  assert.equal(isPinned(s, "b"), true);
  // Pinning a destination that is not open opens it.
  assert.deepEqual(pin(state({ open: [] }), "x").open, ["x"]);
  assert.equal(pin(s, THREADS), s);
});

test("unpinning puts a tab first among the ordinary tabs", () => {
  let s = pin(pin(state({ open: ["a", "b", "c"] }), "a"), "b");
  s = unpin(s, "a");
  assert.deepEqual(s.open, ["b", "a", "c"]);
  assert.deepEqual(s.pinned, ["b"]);
  assert.equal(unpin(s, "c"), s);
});

test("pinned tabs survive every close", () => {
  const s = pin(state({ open: ["a", "b", "c"] }), "a");
  assert.deepEqual(close(s, ["a"]).open, ["a", "b", "c"]);
  assert.deepEqual(closeOthers(s, "c").open, ["a", "c"]);
  assert.deepEqual(closeToRight(s, THREADS).open, ["a"]);
  assert.equal(close(s, ["a"]).closed.length, 0);
});

test("reopening never lands a tab among the pinned", () => {
  let s = state({ open: ["a", "b"] });
  s = close(s, ["a"]); // remembered at index 0
  s = pin(s, "b");
  assert.deepEqual(reopen(s, () => true).state.open, ["b", "a"]);
});

test("moving keeps a tab inside its group", () => {
  const s = pin(state({ open: ["a", "b", "c", "d"] }), "a");
  assert.deepEqual(move(s, "d", 0).open, ["a", "d", "b", "c"]);
  assert.deepEqual(move(s, "a", 3).open, ["a", "b", "c", "d"]);
  const two = pin(s, "b");
  assert.deepEqual(move(two, "b", 0).open, ["b", "a", "c", "d"]);
});

test("parseState keeps pinned tabs that are open, and puts them first", () => {
  const parsed = parseState({ open: ["a", "b", "c"], pinned: ["c", "zzz", 4] });
  assert.deepEqual(parsed.open, ["c", "a", "b"]);
  assert.deepEqual(parsed.pinned, ["c"]);
});

test("moveBefore places a tab in front of another in its group, or at the group's end", () => {
  const s = pin(state({ open: ["p", "a", "b", "c"] }), "p");
  assert.deepEqual(moveBefore(s, "c", "a").open, ["p", "c", "a", "b"]);
  assert.deepEqual(moveBefore(s, "a", null).open, ["p", "b", "c", "a"]);
  // A pinned tab is not a valid target for an ordinary one: end of its group.
  assert.deepEqual(moveBefore(s, "c", "p").open, ["p", "a", "b", "c"]);
  assert.equal(moveBefore(s, "b", "c"), s);
  const two = pin(s, "a");
  assert.deepEqual(moveBefore(two, "a", "p").open, ["a", "p", "b", "c"]);
  assert.deepEqual(moveBefore(two, "p", null).open, ["a", "p", "b", "c"]);
});

test("arriving on Settings opens the sidebar its sections live in", () => {
  assert.deepEqual(
    sidebarStep({ previous: "a", next: SETTINGS, sidebarOpen: false, threadsSidebarOpen: true }),
    { action: "expand", threadsSidebarOpen: true },
  );
  assert.equal(
    sidebarStep({ previous: undefined, next: SETTINGS, sidebarOpen: true, threadsSidebarOpen: true })
      .action,
    null,
  );
  // From Threads it records the preference on the way out, as any tab does.
  assert.deepEqual(
    sidebarStep({ previous: THREADS, next: SETTINGS, sidebarOpen: false, threadsSidebarOpen: true }),
    { action: "expand", threadsSidebarOpen: false },
  );
});

test("leaving Settings undoes what Settings did", () => {
  assert.equal(
    sidebarStep({ previous: SETTINGS, next: "a", sidebarOpen: true, threadsSidebarOpen: true }).action,
    "collapse",
  );
  assert.equal(
    sidebarStep({ previous: SETTINGS, next: THREADS, sidebarOpen: true, threadsSidebarOpen: false })
      .action,
    "collapse",
  );
  assert.equal(
    sidebarStep({ previous: SETTINGS, next: THREADS, sidebarOpen: true, threadsSidebarOpen: true })
      .action,
    null,
  );
});

test("leaving Settings by bb's own way out closes its tab; a tab switch does not", () => {
  assert.equal(leavesSettings(SETTINGS, THREADS, false), true);
  assert.equal(leavesSettings(SETTINGS, "gh/gh", false), true);
  assert.equal(leavesSettings(SETTINGS, null, false), true);
  assert.equal(leavesSettings(SETTINGS, THREADS, true), false);
  assert.equal(leavesSettings(SETTINGS, SETTINGS, false), false);
  assert.equal(leavesSettings(THREADS, "gh/gh", false), false);
  assert.equal(leavesSettings(undefined, THREADS, false), false);
});

const thread = (id: string, patch: Partial<ThreadFacts> = {}): ThreadFacts => ({
  id,
  status: "idle",
  indicator: "none",
  hasPendingInteraction: false,
  isArchived: false,
  isHidden: false,
  updatedAt: 0,
  latestAttentionAt: null,
  ...patch,
});

test("a thread's group is what it wants from you, most urgent first", () => {
  assert.equal(threadGroup(thread("a", { hasPendingInteraction: true, status: "active" })), "needs-you");
  assert.equal(threadGroup(thread("a", { indicator: "waiting-for-input" })), "needs-you");
  assert.equal(threadGroup(thread("a", { status: "active" })), "running");
  assert.equal(threadGroup(thread("a", { status: "starting" })), "running");
  assert.equal(threadGroup(thread("a", { indicator: "unread-success" })), "finished");
  assert.equal(threadGroup(thread("a", { indicator: "unread-error" })), "finished");
  assert.equal(threadGroup(thread("a")), null);
  assert.equal(threadGroup(thread("a", { status: "active", isArchived: true })), null);
  assert.equal(threadGroup(thread("a", { status: "active", isHidden: true })), null);
});

test("sections list the most recently stirred thread first", () => {
  const groups = groupThreads(
    [
      thread("old", { status: "active", updatedAt: 1 }),
      thread("new", { status: "active", updatedAt: 5 }),
      thread("loud", { status: "active", updatedAt: 2, latestAttentionAt: 9 }),
    ],
    [],
  );
  assert.deepEqual(groups.running.map((t) => t.id), ["loud", "new", "old"]);
});

test("recent keeps visit order, skips what is listed above, and is capped", () => {
  const threads = ["a", "b", "c", "d", "e", "f", "g"].map((id) => thread(id));
  threads[1] = thread("b", { status: "active" });
  threads[2] = thread("c", { isArchived: true });
  const groups = groupThreads(threads, ["g", "b", "c", "zzz", "a", "d", "e", "f"], 4);
  assert.deepEqual(groups.recent.map((t) => t.id), ["g", "a", "d", "e"]);
  assert.deepEqual(groups.running.map((t) => t.id), ["b"]);
});

test("recent threads move to the front and are capped", () => {
  let s = EMPTY_STATE;
  for (const id of ["a", "b", "a"]) s = recordRecentThread(s, id);
  assert.deepEqual(s.recentThreads, ["a", "b"]);
  assert.equal(recordRecentThread(s, "a"), s);
  for (let i = 0; i < 20; i++) s = recordRecentThread(s, `t${i}`);
  assert.equal(s.recentThreads.length, 8);
});

test("ago is brief", () => {
  const now = 10 * 24 * 3_600_000;
  assert.equal(ago(now - 10_000, now), "now");
  assert.equal(ago(now - 5 * 60_000, now), "5m");
  assert.equal(ago(now - 3 * 3_600_000, now), "3h");
  assert.equal(ago(now - 2 * 24 * 3_600_000, now), "2d");
  assert.equal(ago(now + 60_000, now), "now");
});
