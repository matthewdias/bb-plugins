// Whether the window's macOS traffic lights sit over the strip.
//
// bb's desktop app exposes `window.bbDesktop`, and bb itself reserves room
// for the traffic lights only when `getInfo()` reports macOS and
// `getWindowState()` says the window is not full screen — in full screen the
// lights are gone. The strip asks the same two questions the same way, so it
// leaves room exactly when bb's own header would. Everything is optional and
// shape-checked: in a browser `bbDesktop` is absent and the answer is no.
import { useEffect, useState } from "react";

interface DesktopBridge {
  platform?: unknown;
  getInfo?: () => Promise<unknown>;
  onChange?: (listener: (info: unknown) => void) => (() => void) | void;
  getWindowState?: () => Promise<unknown>;
  onWindowStateChange?: (listener: (state: unknown) => void) => (() => void) | void;
}

function bridge(): DesktopBridge | null {
  const desktop = (window as { bbDesktop?: unknown }).bbDesktop;
  return typeof desktop === "object" && desktop !== null ? (desktop as DesktopBridge) : null;
}

function isMacInfo(info: unknown): boolean {
  return typeof info === "object" && info !== null && (info as { platform?: unknown }).platform === "macos";
}

function isFullScreenState(state: unknown): boolean {
  return (
    typeof state === "object" && state !== null && (state as { isFullScreen?: unknown }).isFullScreen === true
  );
}

/** True while the macOS traffic lights are drawn over the top-left corner. */
export function useReservesTrafficLights(): boolean {
  const [mac, setMac] = useState(() => bridge()?.platform === "macos");
  const [fullScreen, setFullScreen] = useState(false);

  useEffect(() => {
    const desktop = bridge();
    if (desktop === null) return;
    let alive = true;
    const cleanups: (() => void)[] = [];
    const call = <T,>(fn: (() => Promise<T>) | undefined, then: (value: T) => void) => {
      fn?.call(desktop).then(
        (value) => {
          if (alive) then(value);
        },
        () => {},
      );
    };
    call(desktop.getInfo, (info) => setMac(isMacInfo(info)));
    call(desktop.getWindowState, (state) => setFullScreen(isFullScreenState(state)));
    const offInfo = desktop.onChange?.call(desktop, (info) => setMac(isMacInfo(info)));
    if (typeof offInfo === "function") cleanups.push(offInfo);
    const offState = desktop.onWindowStateChange?.call(desktop, (state) =>
      setFullScreen(isFullScreenState(state)),
    );
    if (typeof offState === "function") cleanups.push(offState);
    return () => {
      alive = false;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return mac && !fullScreen;
}

/**
 * bb's controls that can sit in the strip's row: the macOS title bar's
 * buttons, and the browser's floating sidebar toggle, which top-tabs.css
 * moves up into the row.
 */
const ROW_CONTROLS = [
  '[data-testid="app-window-title-bar"] button',
  '[data-testid="app-sidebar-trigger-overlay"] button',
].join(", ");
/**
 * A page's own controls, which bb puts in the same row: in its macOS frame
 * every page header is part of the title bar, and on the web's compose
 * screen bb lifts the right panel toggle into the top row. Only the last
 * page's, at the row's right end, are left clear; in a split the others sit
 * mid-row, under the tabs, whose menus close those panes.
 */
const PAGE_CONTROLS = ['button[aria-label="Close pane"]', 'button[aria-label*="right panel"]'].join(", ");
/** Space between those controls and the strip's first and last items. */
const CONTROL_GAP = 8;
/** Re-measure without a resize too: controls mount after the strip, and full screen moves them. */
const MEASURE_MS = 1000;

export interface RowInsets {
  left: number;
  right: number;
  /**
   * Where each of those controls is, in the viewport. In bb's desktop app the
   * strip is a window-drag region, and Electron works drag regions out in
   * page order: the strip's, coming after bb's title bar, would cover the
   * title bar's buttons again, and a drag region takes the click. The strip
   * marks these rectangles no-drag after its own, so the buttons stay
   * clickable.
   */
  holes: readonly { x: number; y: number; width: number; height: number }[];
  /**
   * bb frames the window, as its macOS app does: a gray frame around the
   * page, which the strip then sits on. Read here because it is checked on
   * the same schedule.
   */
  framed: boolean;
  /**
   * How far below the strip's middle those controls' middle sits, or null
   * with none in the row. bb's macOS app centres its title bar controls on
   * the traffic lights, which the desktop shell places, not on the row; the
   * strip moves its contents by this much to sit level with them.
   */
  shift: number | null;
}

const NO_INSETS: RowInsets = { left: 0, right: 0, holes: [], framed: false, shift: null };

function sameInsets(a: RowInsets, b: RowInsets): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.framed === b.framed &&
    a.shift === b.shift &&
    JSON.stringify(a.holes) === JSON.stringify(b.holes)
  );
}

/** Whether bb frames the window, as its macOS app does (see RowInsets.framed). */
export function isFramed(): boolean {
  return document.querySelector('[data-testid="app-layout-root"][data-framed]') !== null;
}

/**
 * How much of the strip's row bb's own controls take at each end. Since bb
 * 0.46 its desktop app on macOS draws a title bar along the top of the
 * window: the traffic lights, back and forward and the sidebar toggle at the
 * left, the right panel toggle at the right. The strip sits in that row, so
 * it starts after the controls at the left and stops before the ones at the
 * right. Measured rather than fixed, because they move with full screen, with
 * the page, and with what bb puts there.
 */
export function measureRowInsets(row: { top: number; bottom: number }): RowInsets {
  const width = document.documentElement.clientWidth;
  let left = 0;
  let right = 0;
  const holes: RowInsets["holes"][number][] = [];
  const middles: number[] = [];
  const pageControls = new Set(Array.from(document.querySelectorAll(PAGE_CONTROLS)));
  for (const control of Array.from(document.querySelectorAll(`${ROW_CONTROLS}, ${PAGE_CONTROLS}`))) {
    if (control.closest("#bb-top-tabs") !== null) continue;
    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.top >= row.bottom || box.bottom <= 0) continue;
    if (pageControls.has(control) && box.left + box.width / 2 < width / 2) continue;
    middles.push(box.top + box.height / 2);
    holes.push({
      x: Math.floor(box.left),
      y: Math.floor(box.top),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    });
    if (box.left + box.width / 2 < width / 2) left = Math.max(left, Math.ceil(box.right + CONTROL_GAP));
    else right = Math.max(right, Math.ceil(width - box.left + CONTROL_GAP));
  }
  return { left, right, holes, framed: isFramed(), shift: rowShift(middles, row) };
}

/**
 * How far to move the strip's contents so their middle meets the controls',
 * to the half pixel: the median control, so one control bb has moved
 * elsewhere does not pull the row with it. Null with no controls.
 */
export function rowShift(middles: readonly number[], row: { top: number; bottom: number }): number | null {
  if (middles.length === 0) return null;
  const sorted = [...middles].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return Math.round((median - (row.top + row.bottom) / 2) * 2) / 2;
}

/** `measureRowInsets` for the strip, kept current. */
export function useRowInsets(strip: { current: HTMLElement | null }): RowInsets {
  const [insets, setInsets] = useState<RowInsets>(NO_INSETS);
  useEffect(() => {
    const read = () => {
      const el = strip.current;
      if (el === null) return;
      // The row below the strip's top padding, which clears an iPad's status bar.
      const box = el.getBoundingClientRect();
      const top = box.top + (Number.parseFloat(getComputedStyle(el).paddingTop) || 0);
      const next = measureRowInsets({ top, bottom: box.bottom });
      setInsets((before) => (sameInsets(before, next) ? before : next));
    };
    read();
    const timer = window.setInterval(read, MEASURE_MS);
    window.addEventListener("resize", read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", read);
    };
  }, [strip]);
  return insets;
}
