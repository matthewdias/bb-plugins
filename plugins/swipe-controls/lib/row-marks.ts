// Let thread rows keep leftward drags on a phone.
//
// bb closes its sidebar drawer with a leftward drag that starts anywhere on
// it, rows included, so a row can only be swiped left if bb is told to ignore
// drags that start on one. bb skips any target inside `data-no-sidebar-swipe`,
// so each row gets that attribute. The drawer still closes from its header,
// from empty space, or with a tap beside it.
//
// Rows come and go as the list scrolls and changes, so an observer marks new
// ones. Only rows this marked are unmarked again, so a row bb or another
// plugin marked itself is left as it was.

import { ROW_SELECTOR, rowSurface } from "./targets.ts";

const BB_ATTRIBUTE = "data-no-sidebar-swipe";
const OURS = "data-swipe-controls-marked";

function mark(row: Element): void {
  if (row.hasAttribute(BB_ATTRIBUTE)) return;
  row.setAttribute(BB_ATTRIBUTE, "");
  row.setAttribute(OURS, "");
}

/** Marks the whole row, not just its anchor: a drag can start on its glyph or buttons. */
function markWithin(node: Node): void {
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (element.matches(ROW_SELECTOR)) mark(rowSurface(element));
  for (const anchor of element.querySelectorAll(ROW_SELECTOR)) mark(rowSurface(anchor));
}

/** Mark every row now and as rows appear. Returns the undo. */
export function markRows(root: Element): () => void {
  markWithin(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) markWithin(node);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    for (const row of root.querySelectorAll(`[${OURS}]`)) {
      row.removeAttribute(BB_ATTRIBUTE);
      row.removeAttribute(OURS);
    }
  };
}
