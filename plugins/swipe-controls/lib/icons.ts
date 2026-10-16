// The back and forward arrows, as SVG markup: the arrow view is plain DOM,
// built outside React. Paths are Lucide's (ISC): arrow-left, arrow-right.
// A row's icons are bb's own, drawn by the overlay.

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  back: svg('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
  forward: svg('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'),
} as const;

export type IconName = keyof typeof ICONS;
