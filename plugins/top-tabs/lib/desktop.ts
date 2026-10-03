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
