// Every place this plugin depends on bb's DOM rather than its plugin API.
//
// The SDK has no way to read or set whether the sidebar is open, and no slot
// that reserves room above the app. So the sidebar is read from the
// attributes bb's sidebar primitive publishes (`data-side`, `data-state`,
// `data-collapsible`) and toggled by clicking bb's own toggle — never by
// restyling it — so the collapse animates, the page header makes room for the
// toggle, and bb's state stays the single source of truth. Each lookup
// returns null when its element is missing, and every caller treats null as
// "leave it alone": if bb renames these, the strip keeps working and only the
// automatic collapse stops.
//
// The room above the app is reserved in top-tabs.css, for the same reason and
// with the same failure mode.

const SIDEBAR = '[data-side="left"][data-collapsible]';
const TRIGGER = '[data-sidebar="trigger"]';

/** bb's `md` breakpoint: below it the sidebar is a drawer and the strip hides. */
export const COMPACT_QUERY = "(max-width: 767px)";

/** Whether the sidebar is expanded, or null when it cannot be found. */
export function isSidebarOpen(): boolean | null {
  const sidebar = document.querySelector(SIDEBAR);
  if (sidebar === null) return null;
  const state = sidebar.getAttribute("data-state");
  if (state === "expanded") return true;
  if (state === "collapsed") return false;
  return null;
}

/**
 * Call `onChange` whenever the sidebar opens or closes. Watches only the
 * sidebar's own `data-state`, never the whole document.
 */
export function observeSidebar(onChange: (open: boolean) => void): () => void {
  const sidebar = document.querySelector(SIDEBAR);
  if (sidebar === null) return () => {};
  const observer = new MutationObserver(() => {
    const open = isSidebarOpen();
    if (open !== null) onChange(open);
  });
  observer.observe(sidebar, { attributes: true, attributeFilter: ["data-state"] });
  return () => observer.disconnect();
}

const PANE = "[data-split-pane-id]";
const CLOSE_PANE = 'button[aria-label="Close pane"]';

/**
 * Close one pane of a split with its own header button. Closing a tab that is
 * on screen closes the view too, as it would in a browser; bb then decides
 * which pane takes focus. Returns false when the button cannot be found.
 */
export function closePane(paneId: string): boolean {
  const pane = document.querySelector(`[data-split-pane-id="${CSS.escape(paneId)}"]`);
  const button = pane?.querySelector<HTMLElement>(CLOSE_PANE);
  if (button == null) return false;
  button.click();
  return true;
}

/**
 * bb's Close on a page shown on its own: since bb 0.45 a lone thread or plugin
 * page has the same "Close pane" button a split pane has, and pressing it
 * opens New Thread. Null in a split, on the compose screen, and on bb's own
 * pages, which have none.
 */
export function pageClose(): HTMLElement | null {
  const panes = document.querySelectorAll(PANE);
  if (panes.length !== 1) return null;
  return panes[0]!.querySelector<HTMLElement>(CLOSE_PANE);
}

/**
 * Let `take` answer presses of bb's lone-page Close before bb does. Listening
 * on the document's capture phase runs ahead of React, whose handlers sit on
 * the app root; when `take` returns true the press stops there and bb never
 * sees it. A split pane's Close is never offered.
 */
export function interceptPageClose(take: () => boolean): () => void {
  const listener = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest(CLOSE_PANE);
    if (button == null || button !== pageClose()) return;
    if (!take()) return;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("click", listener, true);
  return () => document.removeEventListener("click", listener, true);
}

/** Where bb lays out its pages, beside the sidebar and below the strip. */
export function contentRect(): DOMRect | null {
  return document.querySelector('[data-testid="app-layout-content-shell"]')?.getBoundingClientRect() ?? null;
}

const INSTANT_CLASS = "bb-top-tabs-instant-sidebar";

/**
 * Click bb's sidebar toggle. Returns false when it cannot be found.
 *
 * `instant` switches off bb's 200ms slide for this one toggle (see
 * top-tabs.css). The strip toggles the sidebar as part of switching tabs, and
 * an animated width there means the page being switched to lays itself out
 * again on every frame of the slide; a browser tab switch does not animate
 * either. A toggle the user makes by hand still slides.
 */
export function toggleSidebar(options: { instant?: boolean } = {}): boolean {
  const trigger = document.querySelector<HTMLElement>(TRIGGER);
  if (trigger === null) return false;
  if (options.instant === true) {
    const root = document.documentElement;
    root.classList.add(INSTANT_CLASS);
    // Two frames: the class has to outlive the render that applies the new
    // width, however long that render blocks the main thread.
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove(INSTANT_CLASS)));
  }
  trigger.click();
  return true;
}

/**
 * The motion an instant switch keeps. Each animates only `translate` or
 * `opacity`, which the compositor runs without laying the page out again —
 * the page still lays out once, at its final width, as `instant` promises —
 * and which keeps going while bb finishes rendering a long thread. Nothing
 * here uses `transform` on the page, which would become the containing block
 * of everything fixed inside it.
 */
const ENTRANCES = {
  /** The sidebar slides back in over the space it already holds. */
  sidebar: {
    selector: '[data-side="left"] > [data-sidebar="panel"]',
    keyframes: [{ translate: "-100% 0" }, { translate: "0 0" }],
    timing: { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  },
  /** The page fades in, so a thread rendered afresh does not just appear. */
  page: {
    selector: '[data-testid="app-layout-content-shell"]',
    keyframes: [{ opacity: 0 }, { opacity: 1 }],
    timing: { duration: 180, easing: "ease-out" },
  },
} satisfies Record<string, { selector: string; keyframes: Keyframe[]; timing: KeyframeAnimationOptions }>;

/**
 * How long after it starts an entrance adopts elements bb mounts.
 * Leaving bb's own pages (Plugins, Skills) mounts a fresh sidebar and page
 * shell for the thread, a moment after the old ones are on screen.
 */
const ADOPT_MS = 1000;

/**
 * Longest an entrance holds its elements out of sight, waiting for bb to
 * mount and draw the thread. Going back to Threads always ends on the
 * thread list, so this only bounds a render slower than bb ever is.
 */
const HOLD_MS = 3000;

/**
 * A page's own sidebar rather than the thread list. bb marks each sidebar's
 * top row by its page: `app-sidebar-top-reserve-row` for the thread list,
 * `skills-sidebar-top-reserve-row` on Skills. Matching every other page's
 * mark, not the thread list's, means a rename leaves everything counted as
 * the thread list, which is how this behaved before it knew the difference.
 */
const OTHER_PAGES_SIDEBAR =
  '[data-side="left"] [data-testid$="-sidebar-top-reserve-row"]:not([data-testid="app-sidebar-top-reserve-row"])';

/** A frame this quick means the browser has caught up with bb's render. */
const STEADY_FRAME_MS = 25;

/** Longest to wait for steady frames before moving anyway. */
const SETTLE_MAX_MS = 300;

/**
 * Run `run` once the browser has caught up: two quick frames in a row, or
 * at most `SETTLE_MAX_MS` from now. bb renders a thread in long frames, and
 * motion started during them is spent unseen or stalls, so the strip moves
 * once they're over. Returns a cancel.
 */
export function whenSettled(run: (now: number) => void): () => void {
  const deadline = performance.now() + SETTLE_MAX_MS;
  let last: number | null = null;
  let steady = 0;
  let frame = 0;
  const tick = (now: number) => {
    steady = last !== null && now - last < STEADY_FRAME_MS ? steady + 1 : 0;
    last = now;
    if (steady >= 2 || now >= deadline) run(now);
    else frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

const playing = new Map<keyof typeof ENTRANCES, () => void>();

/**
 * Play one entrance, once bb has drawn what it is for.
 *
 * Until then the elements are held at the entrance's first keyframe, out of
 * sight: through bb's render of the thread, which would otherwise spend or
 * stall the motion (see whenSettled), and, on the way back from a page with
 * its own sidebar, until that sidebar has left — what is on screen at first
 * is that page's sidebar and content, still up while bb renders the thread.
 * The entrance then starts on what is there, new or kept.
 *
 * Once it is playing, anything bb mounts in place of its elements takes the
 * running animation's start time and carries on rather than starting over.
 */
export function playEntrance(kind: keyof typeof ENTRANCES): void {
  playing.get(kind)?.();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { selector, keyframes, timing } = ENTRANCES[kind];
  const holds = new Map<Element, Animation>();
  const animations: Animation[] = [];
  const seen = new WeakSet<Element>();
  let started = false;
  let otherPage = false;
  // When the entrance was first drawn. A replacement mounts after that, so
  // it takes the first animation's start time, or this while that is still
  // on its way to the compositor.
  let begun: number | null = null;
  const hold = (element: Element) => {
    if (holds.has(element)) return;
    holds.set(element, element.animate([keyframes[0]!, keyframes[0]!], { duration: HOLD_MS * 2 }));
  };
  const release = () => {
    for (const animation of holds.values()) animation.cancel();
    holds.clear();
  };
  const adopt = (element: Element) => {
    if (seen.has(element)) return;
    seen.add(element);
    const animation = element.animate(keyframes, timing);
    const lead = animations[0];
    if (lead !== undefined && (lead.startTime ?? begun) !== null) {
      animation.startTime = lead.startTime ?? begun;
    }
    animations.push(animation);
  };
  let timer: number | undefined;
  /** Stop watching for bb's elements in a while, and show anything held. */
  const settle = (ms: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      observer.disconnect();
      release();
    }, ms);
  };
  const start = (now: number) => {
    started = true;
    const targets = [...holds.keys()].filter((element) => element.isConnected);
    release();
    targets.forEach(adopt);
    document.querySelectorAll(selector).forEach(adopt);
    begun = now;
    settle(ADOPT_MS);
  };
  let cancelSettled = () => {};
  const observer = new MutationObserver((records) => {
    const added: Element[] = [];
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches(selector)) added.push(node);
        else added.push(...Array.from(node.querySelectorAll(selector)));
      }
    }
    if (started) {
      added.forEach(adopt);
      return;
    }
    added.forEach(hold);
    if (otherPage && document.querySelector(OTHER_PAGES_SIDEBAR) === null) {
      otherPage = false;
      cancelSettled = whenSettled(start);
    }
  });
  const frame = requestAnimationFrame(() => {
    otherPage = document.querySelector(OTHER_PAGES_SIDEBAR) !== null;
    document.querySelectorAll(selector).forEach(hold);
    observer.observe(document.body, { childList: true, subtree: true });
    // Counted from the first frame, since the render that blocks before it
    // can last longer than the animation. Anything still held by then shows.
    settle(HOLD_MS);
    if (!otherPage) cancelSettled = whenSettled(start);
  });
  playing.set(kind, () => {
    cancelAnimationFrame(frame);
    cancelSettled();
    window.clearTimeout(timer);
    observer.disconnect();
    release();
    for (const animation of animations) animation.cancel();
    playing.delete(kind);
  });
}

/** Stop every entrance now, for a switch away before one has finished. */
export function stopEntrances(): void {
  for (const stop of [...playing.values()]) stop();
}
