// The app overlay: mounted once per window, draws nothing.
//
// It does two jobs. It keeps one <style> element in <head> holding the rules
// for what you hid, and every few seconds it looks for items the catalog has
// not seen and reports them, which is how the Declutter list fills in.
//
// One kind of item CSS cannot reach by itself: a header split button named
// only by its text, like Commit. While one of bb's own header buttons is
// hidden, a MutationObserver re-marks those as bb re-renders the header, at
// most once a frame; with nothing of that kind hidden there is no observer.
//
// The hidden list is also kept in localStorage, so a reload applies it before
// the server answers instead of flashing every hidden control first.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { itemOf, keyOf, MARK_ATTR, markTextNamed, scan, stylesheetFor, type Item } from "../lib/items";
import { CHANGED, REPORT_MAX } from "../lib/state";
import type { rpcContract } from "../server";

export const STYLE_ID = "bb-plugin-declutter-rules";
export const CACHE_KEY = "bb-plugin-declutter:hidden";
export const SCAN_MS = 4000;

export function readCache(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function writeCache(keys: readonly string[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(keys));
  } catch {
    // Private mode or a full quota: the server still has the list.
  }
}

const itemsOf = (keys: readonly string[]) => keys.map(itemOf).filter((item): item is Item => item !== null);

function applyStylesheet(keys: readonly string[]): void {
  const css = stylesheetFor(itemsOf(keys));
  let style = document.getElementById(STYLE_ID);
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

export function DeclutterOverlay() {
  const rpc = useRpc<typeof rpcContract>();
  const [hidden, setHidden] = useState<string[]>(readCache);
  const known = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const state = await rpc.call("state_get");
      known.current = new Set(state.items.map((entry) => entry.key));
      setHidden(state.hidden);
      writeCache(state.hidden);
    } catch (cause) {
      console.warn("[declutter] could not load what to hide", cause);
    }
  }, [rpc]);

  useEffect(() => void load(), [load]);
  useRealtime(CHANGED, () => void load());

  useEffect(() => applyStylesheet(hidden), [hidden]);
  useEffect(() => () => document.getElementById(STYLE_ID)?.remove(), []);

  useEffect(() => {
    const items = itemsOf(hidden);
    if (!markTextNamed(document, items)) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        markTextNamed(document, items);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const el of document.querySelectorAll(`[${MARK_ATTR}]`)) el.removeAttribute(MARK_ATTR);
    };
  }, [hidden]);

  useEffect(() => {
    const tick = () => {
      // Until the catalog has loaded every item looks new.
      if (known.current === null || document.hidden) return;
      const seen = known.current;
      const fresh = scan(document)
        .filter((item) => !seen.has(keyOf(item)))
        .slice(0, REPORT_MAX);
      if (fresh.length === 0) return;
      for (const item of fresh) seen.add(keyOf(item));
      rpc.call("items_report", { items: fresh }).catch((cause: unknown) => {
        for (const item of fresh) seen.delete(keyOf(item));
        console.warn("[declutter] could not report new items", cause);
      });
    };
    const timer = window.setInterval(tick, SCAN_MS);
    return () => window.clearInterval(timer);
  }, [rpc]);

  return null;
}
