// Turning one of bb's own icons into something Ribbon will draw.
//
// bb hands plugins its icons as hugeicons `IconSvgElement` — an array of
// [tag, attrs] pairs meant for React. Ribbon takes icons as data and re-renders
// them itself, through an allow-list of tags and attributes (`iconDataSchema`
// in its contracts.ts). Anything outside that list is dropped here rather than
// sent, because Ribbon rejects a whole catalog over one bad icon, and a
// rejected catalog is a grouping that silently disappears from the sidebar.
import type { IconSvgElement } from "@hugeicons/react";
import type { IconDataV1 } from "./icons";

const SAFE_TAGS = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);

/** Ribbon's allow-list, verbatim. */
export const SAFE_ATTRIBUTES = new Set([
  "clipRule",
  "cx",
  "cy",
  "d",
  "fill",
  "fillOpacity",
  "fillRule",
  "height",
  "opacity",
  "points",
  "r",
  "rx",
  "ry",
  "stroke",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeOpacity",
  "strokeWidth",
  "transform",
  "viewBox",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2",
]);

const UNSAFE_VALUE = /(?:\b(?:data|https?|javascript):|url\s*\()/iu;

/**
 * A drawable icon, or null when this glyph cannot survive the trip: an
 * unsupported element, or a value that points somewhere. Unknown-but-harmless
 * attributes (a `key`, a miter limit) are dropped instead, since losing them
 * costs nothing visible.
 */
export function iconDataFromGlyph(glyph: IconSvgElement): IconDataV1 | null {
  const children: IconDataV1[] = [];
  for (const node of glyph) {
    const [tag, attrs] = node as [string, Record<string, unknown> | undefined];
    if (!SAFE_TAGS.has(tag)) return null;
    const safe: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(attrs ?? {})) {
      if (!SAFE_ATTRIBUTES.has(name)) continue;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        safe[name] = value;
        continue;
      }
      if (typeof value !== "string") continue;
      if (UNSAFE_VALUE.test(value)) return null;
      safe[name] = value;
    }
    children.push({ tag: tag as IconDataV1["tag"], attrs: safe });
  }
  if (children.length === 0 || children.length > 64) return null;
  // hugeicons draws on a 24-grid and leaves the frame to its renderer.
  return {
    tag: "svg",
    attrs: { viewBox: "0 0 24 24", fill: "none" },
    children,
  };
}
