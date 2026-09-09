// The glyph vocabulary a stage can pick from.
//
// Ribbon sidebar accepts an icon as data, not as a name: a small tree of safe
// SVG primitives it renders itself (see `iconDataSchema` in Ribbon's
// contracts.ts). Only the attributes in its allow-list survive, so every glyph
// here is plain geometry with React-cased stroke attributes.
//
// This module is imported by both server.ts and app.tsx, so it must stay free
// of SDK imports.

export interface IconDataV1 {
  tag:
    | "svg"
    | "g"
    | "path"
    | "circle"
    | "ellipse"
    | "rect"
    | "line"
    | "polyline"
    | "polygon";
  attrs: Record<string, string | number>;
  children?: IconDataV1[];
}

const FRAME: Record<string, string | number> = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function glyph(...children: IconDataV1[]): IconDataV1 {
  return { tag: "svg", attrs: FRAME, children };
}
function path(d: string): IconDataV1 {
  return { tag: "path", attrs: { d } };
}
function polyline(points: string): IconDataV1 {
  return { tag: "polyline", attrs: { points } };
}
function line(x1: number, y1: number, x2: number, y2: number): IconDataV1 {
  return { tag: "line", attrs: { x1, y1, x2, y2 } };
}
function circle(cx: number, cy: number, r: number): IconDataV1 {
  return { tag: "circle", attrs: { cx, cy, r } };
}
function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 1,
): IconDataV1 {
  return { tag: "rect", attrs: { x, y, width, height, rx } };
}

/** Every glyph a stage may name, keyed by the value stored on the row. */
export const GLYPHS = {
  inbox: glyph(
    path("M3 13h4l1.5 3h7L17 13h4"),
    path("M5.5 5h13l2.5 8v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4l2.5-8Z"),
  ),
  pencil: glyph(path("M4 20h4L20 8a2.83 2.83 0 0 0-4-4L4 16v4Z"), line(14, 6, 18, 10)),
  play: glyph({ tag: "polygon", attrs: { points: "8,5 19,12 8,19" } }),
  eye: glyph(
    { tag: "ellipse", attrs: { cx: 12, cy: 12, rx: 9.5, ry: 5.5 } },
    circle(12, 12, 2.5),
  ),
  upload: glyph(polyline("8,8 12,4 16,8"), line(12, 4, 12, 15), path("M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2")),
  check: glyph(polyline("4,12.5 9.5,18 20,6.5")),
  pause: glyph(rect(7, 5, 3.5, 14), rect(13.5, 5, 3.5, 14)),
  flag: glyph(line(6, 3, 6, 21), path("M6 4.5h11l-2.5 4 2.5 4H6")),
  alert: glyph(circle(12, 12, 9), line(12, 7.5, 12, 13), circle(12, 16.5, 0.6)),
  clock: glyph(circle(12, 12, 9), polyline("12,7 12,12 15.5,14")),
  circle: glyph(circle(12, 12, 7.5)),
} as const satisfies Record<string, IconDataV1>;

export type GlyphName = keyof typeof GLYPHS;

export const GLYPH_NAMES = Object.keys(GLYPHS) as GlyphName[];

export function isGlyphName(value: string): value is GlyphName {
  return Object.hasOwn(GLYPHS, value);
}

/** The grouping's own icon, shown beside "Workflow" in Ribbon's picker. */
export const GROUPING_GLYPH: IconDataV1 = glyph(
  rect(3, 4, 5.5, 16),
  rect(10.5, 4, 5.5, 11),
  rect(18, 4, 3, 7),
);
