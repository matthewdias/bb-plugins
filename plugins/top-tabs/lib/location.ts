// The current in-app location, and a way to return to one.
//
// A tab remembers the exact place it was left — a pull request inside the
// GitHub panel, not just the panel — and the SDK can only navigate to another
// plugin's panel root (`activate`) or to this plugin's own panels. bb routes
// with React Router over the browser history, which follows `popstate`, so a
// pushed entry followed by a `popstate` is an ordinary navigation to it. The
// entry carries the `idx` React Router counts history with, so back and
// forward stay in step.
import { isAppPath } from "./tabs-model.ts";

export function currentPath(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

interface NavigationLike {
  addEventListener(type: "currententrychange", listener: () => void): void;
  removeEventListener(type: "currententrychange", listener: () => void): void;
}

/**
 * Call `onChange` after every navigation. The Navigation API reports pushes
 * as well as pops; where it is missing, a cheap string comparison every
 * half second stands in for the pushes.
 */
export function subscribeLocation(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  const navigation = (window as { navigation?: NavigationLike }).navigation;
  if (navigation !== undefined) {
    navigation.addEventListener("currententrychange", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      navigation.removeEventListener("currententrychange", onChange);
    };
  }
  let last = currentPath();
  const timer = window.setInterval(() => {
    const now = currentPath();
    if (now !== last) {
      last = now;
      onChange();
    }
  }, 500);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.clearInterval(timer);
  };
}

/** Navigate in place to an in-app path. Returns false for anything else. */
export function navigateToPath(path: string): boolean {
  if (!isAppPath(path)) return false;
  if (path === currentPath()) return true;
  const state = history.state as { idx?: unknown } | null;
  const idx = typeof state?.idx === "number" ? state.idx + 1 : 0;
  const key = Math.random().toString(36).slice(2, 10);
  history.pushState({ usr: null, key, idx }, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  return true;
}
