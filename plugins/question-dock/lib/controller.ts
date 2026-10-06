// Lifts bb's own question card out of the chat and places it.
//
// bb draws the card inside the thread's sticky footer, above the composer,
// and lets it grow to the whole height of the chat. No plugin slot replaces
// it, and a rebuilt form would fight bb's 1–9 answer shortcuts, which stay
// bound to bb's form. So the card stays bb's, in bb's DOM, untouched by
// React's view of it: this marks it with data attributes and CSS variables,
// and question-dock.css positions it. Answering, the shortcuts, Escape and
// the multi-question tabs all remain bb's.
//
// Every hook into bb is an attribute bb publishes: the card's data-testid,
// data-expanded and its aria-expanded toggle, and the thread's
// data-page-scroll-viewport and data-scroll-footer. If one stops matching,
// the card is not lifted and bb lays it out as it always does.
import {
  DEFAULT_FLOAT,
  canDock,
  chooseMode,
  dockPlacement,
  dockWidth,
  floatBounds,
  floatMaxHeight,
  floatWidth,
  fromFraction,
  inDockZone,
  floatPositionOf,
  isFloatPosition,
  placeFloat,
  sheetHeight,
  sheetRoom,
  snapSheet,
  toFraction,
  type DesktopMode,
  type FloatPosition,
  type Mode,
  type Rect,
} from "./geometry.ts";
import { listenForDrags, swallowNextClick, type DragSession } from "./drag.ts";

/**
 * The cards this moves. Approvals share the wrapper but stay where bb puts
 * them: they are short, and want answering beside the composer.
 */
export const LIFTED_TEST_IDS = ["user-question-banner", "plan-review-banner", "plugin-interaction-shell"] as const;
export const CARD_SELECTOR = LIFTED_TEST_IDS.map((id) => `section[data-testid="${id}"]`).join(", ");
const PANE_SELECTOR = "[data-page-scroll-viewport]";
const FOOTER_SELECTOR = "[data-scroll-footer]";
const COMPACT_QUERY = "(max-width: 767px), (pointer: coarse) and (hover: none)";

const MODE_ATTR = "data-qd-mode";
const DRAGGING_ATTR = "data-qd-dragging";
const ANCHOR_ATTR = "data-qd-anchor";
const FOOTER_ATTR = "data-qd-lifted";
const HOST_ATTR = "data-qd-host";
const DOCKED_ATTR = "data-qd-docked";
const VARS = ["--qd-x", "--qd-y", "--qd-w", "--qd-h", "--qd-max-h", "--qd-pad-b", "--qd-cb-x", "--qd-cb-y"] as const;

/** When to look again after the keyboard moves: bb's refit, then the keyboard's animation. */
const SETTLE_DELAYS_MS = [120, 400] as const;

const DESKTOP_KEY = "question-dock:desktop";
const FLOAT_KEY = "question-dock:float";
const DOCK_WIDTH_KEY = "question-dock:dock-width";
/** How near the dock's left edge a press resizes it rather than reaching the card. */
const RESIZE_EDGE_PX = 6;
const SHEET_KEY = "question-dock:sheet";

export interface DockOptions {
  desktopMode: DesktopMode;
  mobileSheet: boolean;
}

interface Lifted {
  section: HTMLElement;
  pane: HTMLElement;
  footer: HTMLElement;
  mode: Mode;
}

type Drag =
  | { kind: "float"; section: HTMLElement; origin: { left: number; top: number }; at: { left: number; top: number } }
  | { kind: "sheet"; section: HTMLElement; startHeight: number; height: number }
  | { kind: "resize"; section: HTMLElement; startWidth: number; width: number };

export type GhostListener = (ghost: Rect | null) => void;

export class DockController {
  private readonly doc: Document;
  private readonly lifted = new Map<HTMLElement, Lifted>();
  private options: DockOptions;
  private drag: Drag | null = null;
  private ghost: Rect | null = null;
  private readonly ghostListeners = new Set<GhostListener>();
  private frame: number | null = null;
  private programmaticClick = false;
  private teardown: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private readonly observed = new Set<Element>();
  private readonly timers = new Set<number>();
  private cancelSwallow: (() => void) | null = null;

  constructor(
    private readonly win: Window & typeof globalThis,
    options: DockOptions,
  ) {
    this.doc = win.document;
    this.options = options;
  }

  start(): void {
    if (this.teardown.length > 0) return;
    const schedule = () => this.schedule();

    const mutations = new this.win.MutationObserver(schedule);
    mutations.observe(this.doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-expanded"],
    });
    this.teardown.push(() => mutations.disconnect());

    if (typeof this.win.ResizeObserver === "function") {
      this.resizeObserver = new this.win.ResizeObserver(schedule);
      this.teardown.push(() => {
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.observed.clear();
      });
    }

    this.win.addEventListener("resize", schedule);
    this.teardown.push(() => this.win.removeEventListener("resize", schedule));
    // The on-screen keyboard: bb refits its shell to what stays visible, on
    // a frame of its own, so look again once the keyboard has settled too.
    const viewport = this.win.visualViewport;
    if (viewport) {
      const settle = () => this.scheduleSettled();
      viewport.addEventListener("resize", settle);
      viewport.addEventListener("scroll", settle);
      this.teardown.push(() => {
        viewport.removeEventListener("resize", settle);
        viewport.removeEventListener("scroll", settle);
      });
    }
    const onFocusIn = (event: FocusEvent) => this.onFocusIn(event);
    this.doc.addEventListener("focusin", onFocusIn, true);
    this.doc.addEventListener("focusout", schedule, true);
    this.teardown.push(() => {
      this.doc.removeEventListener("focusin", onFocusIn, true);
      this.doc.removeEventListener("focusout", schedule, true);
    });
    // An ancestor's entrance animation moves the box the card is placed in.
    this.doc.addEventListener("animationend", schedule, true);
    this.doc.addEventListener("transitionend", schedule, true);
    this.teardown.push(() => {
      this.doc.removeEventListener("animationend", schedule, true);
      this.doc.removeEventListener("transitionend", schedule, true);
    });

    this.teardown.push(listenForDrags(this.doc, (target, event) => this.beginDrag(target, event)));

    const onDoubleClick = (event: MouseEvent) => this.onDoubleClick(event);
    this.doc.addEventListener("dblclick", onDoubleClick, true);
    this.teardown.push(() => this.doc.removeEventListener("dblclick", onDoubleClick, true));

    const onOutside = (event: PointerEvent) => this.onPointerDownOutside(event);
    this.doc.addEventListener("pointerdown", onOutside, true);
    this.teardown.push(() => this.doc.removeEventListener("pointerdown", onOutside, true));

    // A collapse bb does itself (Escape, its chevron) is an attribute change
    // the observer sees; nothing to listen for here.
    this.update();
  }

  stop(): void {
    for (const dispose of this.teardown.splice(0)) dispose();
    for (const timer of this.timers) this.win.clearTimeout(timer);
    this.timers.clear();
    this.cancelSwallow?.();
    this.cancelSwallow = null;
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }
    for (const entry of [...this.lifted.values()]) this.unlift(entry);
    this.drag = null;
    this.setGhost(null);
  }

  setOptions(options: DockOptions): void {
    if (options.desktopMode === this.options.desktopMode && options.mobileSheet === this.options.mobileSheet) return;
    this.options = options;
    this.schedule();
  }

  /** A card that could be lifted is on screen. */
  hasCard(): boolean {
    return this.doc.querySelector(CARD_SELECTOR) !== null;
  }

  /** Dock cards from now on, on this device, where the pane has room. */
  dock(): void {
    this.write(DESKTOP_KEY, "dock");
    this.update();
  }

  /** Float cards from now on, on this device. */
  float(): void {
    this.write(DESKTOP_KEY, "float");
    this.update();
  }

  /** Forget this device's choices: back to the setting, default spot and height. */
  reset(): void {
    for (const key of [DESKTOP_KEY, FLOAT_KEY, SHEET_KEY, DOCK_WIDTH_KEY]) this.remove(key);
    this.update();
  }

  subscribeGhost(listener: GhostListener): () => void {
    this.ghostListeners.add(listener);
    listener(this.ghost);
    return () => this.ghostListeners.delete(listener);
  }

  /** Lay every card out now. Runs on the next frame after any change. */
  update(): void {
    if (this.frame !== null) {
      this.cancelFrame(this.frame);
      this.frame = null;
    }

    // One card per pane: bb rarely shows two, and the second stays in place.
    const chosen = new Map<HTMLElement, { section: HTMLElement; footer: HTMLElement }>();
    for (const section of this.doc.querySelectorAll<HTMLElement>(CARD_SELECTOR)) {
      const pane = section.closest<HTMLElement>(PANE_SELECTOR);
      const footer = section.closest<HTMLElement>(FOOTER_SELECTOR);
      if (!pane || !footer || chosen.has(pane)) continue;
      chosen.set(pane, { section, footer });
    }
    const keep = new Set([...chosen.values()].map((card) => card.section));
    for (const entry of [...this.lifted.values()]) {
      if (!keep.has(entry.section) || !entry.section.isConnected) this.unlift(entry);
    }

    const compact = this.isCompact();
    const desktopMode = this.desktopMode();
    for (const [pane, { section, footer }] of chosen) {
      const dragging = this.drag?.section === section;
      const mode = dragging
        ? this.lifted.get(section)?.mode ?? null
        : chooseMode({
            compact,
            expanded: section.hasAttribute("data-expanded"),
            paneWidth: pane.clientWidth,
            desktopMode,
            mobileSheet: this.options.mobileSheet,
          });
      const current = this.lifted.get(section);
      if (mode === null) {
        if (current) this.unlift(current);
        continue;
      }
      const entry: Lifted = { section, pane, footer, mode };
      if (current && (current.pane !== pane || current.footer !== footer)) this.unlift(current);
      this.lift(entry);
      this.place(entry);
    }
  }

  /** Lay out now-ish, and again after a keyboard or bb's refit has settled. */
  private scheduleSettled(): void {
    this.schedule();
    for (const delay of SETTLE_DELAYS_MS) {
      const timer = this.win.setTimeout(() => {
        this.timers.delete(timer);
        this.schedule();
      }, delay);
      this.timers.add(timer);
    }
  }

  /** Typing into a sheet grows it to the whole room, and keeps the text box in view. */
  private onFocusIn(event: FocusEvent): void {
    this.schedule();
    const target = event.target;
    if (!(target instanceof this.win.HTMLElement) || !isTextEntry(target)) return;
    const section = target.closest<HTMLElement>(`section[${MODE_ATTR}="sheet"]`);
    if (!section) return;
    this.scheduleSettled();
    const timer = this.win.setTimeout(() => {
      this.timers.delete(timer);
      if (this.doc.activeElement === target) target.scrollIntoView?.({ block: "nearest" });
    }, SETTLE_DELAYS_MS[SETTLE_DELAYS_MS.length - 1]);
    this.timers.add(timer);
  }

  private schedule(): void {
    if (this.frame !== null) return;
    const raf = this.win.requestAnimationFrame?.bind(this.win);
    this.frame = raf
      ? raf(() => {
          this.frame = null;
          this.update();
        })
      : (this.win.setTimeout(() => {
          this.frame = null;
          this.update();
        }, 16) as unknown as number);
  }

  private cancelFrame(frame: number): void {
    if (this.win.cancelAnimationFrame) this.win.cancelAnimationFrame(frame);
    else this.win.clearTimeout(frame);
  }

  private isCompact(): boolean {
    return this.win.matchMedia?.(COMPACT_QUERY).matches ?? false;
  }

  private desktopMode(): DesktopMode {
    const chosen = this.read(DESKTOP_KEY);
    return chosen === "dock" || chosen === "float" ? chosen : this.options.desktopMode;
  }

  private lift(entry: Lifted): void {
    const { section, pane, footer, mode } = entry;
    this.lifted.set(section, entry);
    setAttr(section, MODE_ATTR, mode);
    setAttr(footer, FOOTER_ATTR, "");
    setAttr(pane, HOST_ATTR, "");
    if (mode === "dock") setAttr(pane, DOCKED_ATTR, "");
    else if (!this.paneHasDock(pane, section)) {
      pane.removeAttribute(DOCKED_ATTR);
      pane.style.removeProperty("--qd-dock-w");
    }
    this.observe(section);
    this.observe(pane);
  }

  private unlift(entry: Lifted): void {
    const { section, pane, footer } = entry;
    this.lifted.delete(section);
    section.removeAttribute(MODE_ATTR);
    section.removeAttribute(DRAGGING_ATTR);
    section.removeAttribute(ANCHOR_ATTR);
    for (const name of VARS) section.style.removeProperty(name);
    const others = [...this.lifted.values()];
    if (!others.some((other) => other.footer === footer)) footer.removeAttribute(FOOTER_ATTR);
    if (!others.some((other) => other.pane === pane)) pane.removeAttribute(HOST_ATTR);
    if (!this.paneHasDock(pane, section)) {
      pane.removeAttribute(DOCKED_ATTR);
      pane.style.removeProperty("--qd-dock-w");
    }
    this.unobserve(section);
    if (this.drag?.section === section) {
      this.drag = null;
      this.setGhost(null);
    }
  }

  private paneHasDock(pane: HTMLElement, except: HTMLElement): boolean {
    for (const other of this.lifted.values()) {
      if (other.pane === pane && other.section !== except && other.mode === "dock") return true;
    }
    return false;
  }

  private observe(element: Element): void {
    if (!this.resizeObserver || this.observed.has(element)) return;
    this.observed.add(element);
    this.resizeObserver.observe(element);
  }

  private unobserve(element: Element): void {
    if (!this.resizeObserver || !this.observed.delete(element)) return;
    this.resizeObserver.unobserve(element);
  }

  /** The pane in viewport coordinates, without its scrollbar. */
  private paneRect(pane: HTMLElement): Rect {
    const rect = pane.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: pane.clientWidth || rect.width, height: rect.height };
  }

  private place(entry: Lifted): void {
    const { section, pane, footer, mode } = entry;
    const paneRect = this.paneRect(pane);
    let x: number;
    let y: number;
    let width: number;
    let maxHeight: number;
    let height: number | null = null;
    let anchor: "top" | "bottom" = mode === "float" ? "top" : "bottom";

    if (mode === "dock") {
      const resize = this.drag?.kind === "resize" && this.drag.section === section ? this.drag : null;
      const dock = dockPlacement(paneRect, dockWidth(paneRect.width, resize ? resize.width : this.dockWidthChoice()));
      ({ left: x, bottom: y, width, maxHeight } = dock);
      // The chat moves over by exactly as much.
      setVar(pane, "--qd-dock-w", px(width));
    } else if (mode === "float") {
      const bounds = floatBounds(paneRect, footer.getBoundingClientRect().top);
      width = floatWidth(bounds);
      maxHeight = floatMaxHeight(paneRect, bounds);
      const size = { width, height: Math.min(section.getBoundingClientRect().height, maxHeight) };
      const drag = this.drag?.kind === "float" && this.drag.section === section ? this.drag : null;
      if (drag) {
        x = drag.at.left;
        y = drag.at.top;
      } else {
        const position = this.floatPosition();
        ({ left: x, edge: y } = placeFloat(bounds, size, position));
        anchor = position.anchor;
      }
    } else {
      // The pane, not the window: bb fits the pane between its top bar and
      // the on-screen keyboard itself, so a sheet on the pane's bottom edge
      // sits on the keyboard and never runs under the top bar. Below the pane
      // bb's shell keeps the home indicator's inset; the sheet reaches over it
      // and pads by the same amount, as bb's composer does, except while
      // typing, when the keyboard hides the indicator anyway.
      const paneBox = entry.pane.getBoundingClientRect();
      const inset = bottomInset(entry.pane);
      const typing = typingIn(section);
      const pad = typing ? 0 : inset;
      const drag = this.drag?.kind === "sheet" && this.drag.section === section ? this.drag : null;
      const detent = this.read(SHEET_KEY) === "full" ? "full" : "half";
      maxHeight = sheetRoom(paneBox.height) + pad;
      height = drag ? Math.min(drag.height, maxHeight) : sheetHeight(paneBox.height, detent, typing) + pad;
      x = paneBox.left;
      y = paneBox.bottom + inset;
      width = paneBox.width;
      setVar(section, "--qd-pad-b", px(pad));
    }

    setVar(section, "--qd-x", px(x));
    setVar(section, "--qd-y", px(y));
    setVar(section, "--qd-w", px(width));
    setVar(section, "--qd-max-h", px(maxHeight));
    if (height === null) section.style.removeProperty("--qd-h");
    else setVar(section, "--qd-h", px(height));
    if (mode === "float" && anchor === "bottom") setAttr(section, ANCHOR_ATTR, "bottom");
    else section.removeAttribute(ANCHOR_ATTR);
    this.calibrate(section, x, y, anchor);
  }

  /**
   * Correct for where `position: fixed` actually measures from.
   *
   * The coordinates above are the viewport's, which is where fixed boxes are
   * placed unless an ancestor has a transform, a filter or containment, and
   * bb's tree has several candidates (the card sits inside the composer,
   * inside nested containers; Top Tabs fades pages in with a transform).
   * Which of them really move a fixed box differs between engines, so this
   * measures where the card landed rather than guessing from styles, and
   * shifts it by the difference. Skipped while the card is animating, whose
   * box is not where it will settle; the transition's end runs it again.
   */
  private calibrate(section: HTMLElement, x: number, y: number, anchor: "top" | "bottom"): void {
    if (section.getAnimations?.().some((animation) => animation.playState === "running")) return;
    const rect = section.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const oldX = parsePx(section.style.getPropertyValue("--qd-cb-x"));
    const oldY = parsePx(section.style.getPropertyValue("--qd-cb-y"));
    // The card's box is at (wanted - old offset) inside its containing block.
    const originX = rect.left - (x - oldX);
    const originY = (anchor === "top" ? rect.top : rect.bottom) - (y - oldY);
    if (Math.abs(originX - oldX) >= 0.5) setVar(section, "--qd-cb-x", px(originX));
    if (Math.abs(originY - oldY) >= 0.5) setVar(section, "--qd-cb-y", px(originY));
  }

  private dockWidthChoice(): number | null {
    const width = Number.parseFloat(this.read(DOCK_WIDTH_KEY) ?? "");
    return Number.isFinite(width) ? width : null;
  }

  private floatPosition(): FloatPosition {
    const raw = this.read(FLOAT_KEY);
    if (raw === null) return DEFAULT_FLOAT;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isFloatPosition(parsed) ? parsed : DEFAULT_FLOAT;
    } catch {
      return DEFAULT_FLOAT;
    }
  }

  // --- Gestures -----------------------------------------------------------

  /** The lifted card whose header (or sheet grabber) `target` is in. */
  private headerCard(target: Element): Lifted | null {
    const section = target.closest<HTMLElement>(`section[${MODE_ATTR}]`);
    if (!section) return null;
    const entry = this.lifted.get(section);
    if (!entry) return null;
    const header = section.firstElementChild;
    if (!header || !header.contains(target)) return null;
    return entry;
  }

  private beginDrag(target: Element, event: PointerEvent): DragSession | null {
    const edge = this.dockEdge(target, event);
    if (edge) return this.resizeSession(edge);
    const entry = this.headerCard(target);
    if (!entry) return null;
    const { section } = entry;

    if (entry.mode === "sheet") {
      return {
        start: () => {
          const startHeight = section.getBoundingClientRect().height;
          this.drag = { kind: "sheet", section, startHeight, height: startHeight };
          section.setAttribute(DRAGGING_ATTR, "");
        },
        move: (_dx, dy) => {
          if (this.drag?.kind !== "sheet") return;
          this.drag.height = Math.max(48, this.drag.startHeight - dy);
          this.place(entry);
        },
        end: (_event, cancelled) => {
          const drag = this.drag?.kind === "sheet" ? this.drag : null;
          this.drag = null;
          section.removeAttribute(DRAGGING_ATTR);
          if (drag && !cancelled) {
            const snap = snapSheet(drag.height, entry.pane.getBoundingClientRect().height);
            if (snap === "collapse") this.collapse(section);
            else this.write(SHEET_KEY, snap);
          }
          this.update();
        },
      };
    }

    const pointerOffset = (() => {
      const rect = section.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    })();
    return {
      start: () => {
        const rect = section.getBoundingClientRect();
        const origin = { left: rect.left, top: rect.top };
        this.drag = { kind: "float", section, origin, at: origin };
        section.setAttribute(DRAGGING_ATTR, "");
        // A docked card comes out as a float under the pointer.
        if (entry.mode !== "float") {
          const next: Lifted = { ...entry, mode: "float" };
          this.lift(next);
          this.place(next);
        }
      },
      move: (_dx, _dy, moveEvent) => {
        const drag = this.drag?.kind === "float" ? this.drag : null;
        const current = this.lifted.get(section);
        if (!drag || !current) return;
        const bounds = floatBounds(this.paneRect(current.pane), current.footer.getBoundingClientRect().top);
        const rect = section.getBoundingClientRect();
        const wanted = { left: moveEvent.clientX - pointerOffset.x, top: moveEvent.clientY - pointerOffset.y };
        drag.at = fromFraction(bounds, rect, toFraction(bounds, rect, wanted));
        this.place(current);
        const pane = this.paneRect(current.pane);
        this.setGhost(inDockZone(pane, moveEvent.clientX) ? dockGhost(pane, dockWidth(pane.width, this.dockWidthChoice())) : null);
      },
      end: (endEvent, cancelled) => {
        const drag = this.drag?.kind === "float" ? this.drag : null;
        const current = this.lifted.get(section);
        this.drag = null;
        section.removeAttribute(DRAGGING_ATTR);
        this.setGhost(null);
        if (drag && current && !cancelled) {
          const pane = this.paneRect(current.pane);
          if (inDockZone(pane, endEvent.clientX)) {
            this.write(DESKTOP_KEY, "dock");
          } else {
            const bounds = floatBounds(pane, current.footer.getBoundingClientRect().top);
            const rect = section.getBoundingClientRect();
            const dropped = { left: drag.at.left, top: drag.at.top, width: rect.width, height: rect.height };
            this.write(FLOAT_KEY, JSON.stringify(floatPositionOf(bounds, dropped)));
            this.write(DESKTOP_KEY, "float");
          }
        }
        this.update();
      },
    };
  }

  /** The docked card whose left edge, its resize handle, is under the press. */
  private dockEdge(target: Element, event: PointerEvent): Lifted | null {
    if (!(target instanceof this.win.HTMLElement)) return null;
    const entry = this.lifted.get(target);
    if (!entry || entry.mode !== "dock") return null;
    return event.clientX - target.getBoundingClientRect().left <= RESIZE_EDGE_PX ? entry : null;
  }

  /** Drag the dock's left edge to make it wider or narrower; the chat follows. */
  private resizeSession(entry: Lifted): DragSession {
    const { section } = entry;
    return {
      start: () => {
        const startWidth = section.getBoundingClientRect().width;
        this.drag = { kind: "resize", section, startWidth, width: startWidth };
        section.setAttribute(DRAGGING_ATTR, "");
      },
      move: (dx) => {
        if (this.drag?.kind !== "resize") return;
        this.drag.width = dockWidth(this.paneRect(entry.pane).width, this.drag.startWidth - dx);
        this.place(entry);
      },
      end: (_event, cancelled) => {
        const drag = this.drag?.kind === "resize" ? this.drag : null;
        this.drag = null;
        section.removeAttribute(DRAGGING_ATTR);
        if (drag && !cancelled) this.write(DOCK_WIDTH_KEY, String(Math.round(drag.width)));
        this.update();
      },
    };
  }

  private onDoubleClick(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const entry = this.headerCard(event.target);
    if (!entry || entry.mode === "sheet") return;
    // The two clicks before it toggled bb's card twice, which is no change.
    if (entry.mode === "float" && canDock(entry.pane.clientWidth)) this.dock();
    else this.float();
  }

  /** A tap on the dimmed chat around an open sheet closes the sheet, and only that. */
  private onPointerDownOutside(event: PointerEvent): void {
    if (!(event.target instanceof Node)) return;
    for (const entry of this.lifted.values()) {
      if (entry.mode !== "sheet" || entry.section.contains(event.target)) continue;
      event.preventDefault();
      event.stopPropagation();
      this.collapse(entry.section);
      this.cancelSwallow?.();
      this.cancelSwallow = swallowNextClick(this.doc);
      return;
    }
  }

  /** Collapse a card with bb's own toggle, so bb's state stays the truth. */
  private collapse(section: HTMLElement): void {
    const toggle = section.firstElementChild?.querySelector<HTMLElement>("button[aria-expanded='true']");
    if (!toggle || this.programmaticClick) return;
    this.programmaticClick = true;
    try {
      toggle.click();
    } finally {
      this.programmaticClick = false;
    }
  }

  private setGhost(ghost: Rect | null): void {
    if (sameRect(ghost, this.ghost)) return;
    this.ghost = ghost;
    for (const listener of this.ghostListeners) listener(ghost);
  }

  private read(key: string): string | null {
    try {
      return this.win.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.win.localStorage.setItem(key, value);
    } catch {
      // Private mode or a full quota: the choice lasts until reload.
    }
  }

  private remove(key: string): void {
    try {
      this.win.localStorage.removeItem(key);
    } catch {
      // As above.
    }
  }
}

function dockGhost(pane: Rect, width: number): Rect {
  const dock = dockPlacement(pane, width);
  return { left: dock.left, top: dock.bottom - dock.maxHeight, width: dock.width, height: dock.maxHeight };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function px(value: number): string {
  return `${Math.round(value * 100) / 100}px`;
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setVar(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

/**
 * The home indicator's inset bb's content shell keeps below `pane`, or 0. The
 * shell pads by it (bb's native app reports it; a browser uses env()), so it
 * is read from the shell rather than assumed.
 */
function bottomInset(pane: HTMLElement): number {
  const shell = pane.closest<HTMLElement>("[data-app-content-shell]");
  const view = pane.ownerDocument.defaultView;
  if (!shell || !view) return 0;
  return parsePx(view.getComputedStyle(shell).paddingBottom);
}

function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if (element.tagName === "TEXTAREA") return true;
  if (element.tagName === "INPUT") return !["checkbox", "radio", "button", "submit"].includes((element as HTMLInputElement).type);
  return (element as HTMLElement).isContentEditable === true;
}

/** Whether the person is typing into `section`, so the keyboard is (or is about to be) up. */
function typingIn(section: HTMLElement): boolean {
  const active = section.ownerDocument.activeElement;
  return active !== null && section.contains(active) && isTextEntry(active);
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
