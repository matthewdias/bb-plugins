// What a swipe draws: a row sliding over its actions, and an arrow at the
// edge of the page for back and forward.
//
// Plain DOM rather than React, for two reasons. The row is bb's element, so
// sliding it is a style on bb's node, and what it uncovers has to move in the
// same frame or a seam opens between them. And nothing here outlives the
// gesture, so there is no state for React to hold.
//
// The row slides with the `translate` property, which composes with any
// transform bb sets. bb's list doesn't clip sideways, so the part of the row
// that slides past its own edge is clipped away with `clip-path`. Both inline
// values are put back exactly as found.
// What it uncovers is drawn over the vacated strip, in a fixed layer on
// <body>, not inside bb's row.

import { ICONS, type IconName } from "./icons.ts";
import type { RowArm } from "./row.ts";
import type { HistoryDirection } from "./history.ts";

export type TrailingAction = "pin" | "archive";

export interface RowViewContent {
  leading: { icon: IconName; label: string };
  trailing: { id: TrailingAction; icon: IconName; label: string }[];
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Rows shorter than this show icons alone. bb's touch rows are 44px. */
const LABEL_MIN_HEIGHT_PX = 40;

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

function layer(doc: Document, className: string): HTMLDivElement {
  const element = doc.createElement("div");
  element.className = className;
  // bb treats a click inside a plugin's portaled overlay as inside the
  // plugin, so its own dismissable layers don't take it as an outside click.
  element.setAttribute("data-bb-portaled-overlay", "");
  element.setAttribute("data-no-swipe-controls", "");
  return element;
}

function icon(doc: Document, name: IconName): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "bbsc-icon";
  span.innerHTML = ICONS[name];
  return span;
}

function label(doc: Document, text: string): HTMLSpanElement {
  const span = doc.createElement("span");
  span.className = "bbsc-label";
  span.textContent = text;
  return span;
}

export class RowView {
  readonly row: HTMLElement;
  private readonly root: HTMLDivElement;
  private readonly lead: HTMLDivElement;
  private readonly trail: HTMLDivElement;
  private readonly saved: { translate: string; transition: string; willChange: string; clipPath: string };
  private destroyed = false;

  constructor(
    doc: Document,
    row: HTMLElement,
    box: Box,
    content: RowViewContent,
    onAction: (action: TrailingAction) => void,
  ) {
    this.row = row;
    this.saved = {
      translate: row.style.translate,
      transition: row.style.transition,
      willChange: row.style.willChange,
      clipPath: row.style.clipPath,
    };
    row.style.willChange = "translate";

    this.root = layer(doc, "bbsc-row");
    Object.assign(this.root.style, {
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
    if (box.height >= LABEL_MIN_HEIGHT_PX) this.root.setAttribute("data-labels", "");

    this.lead = doc.createElement("div");
    this.lead.className = "bbsc-lead";
    const leadAction = doc.createElement("span");
    leadAction.className = "bbsc-lead-action";
    leadAction.append(icon(doc, content.leading.icon), label(doc, content.leading.label));
    this.lead.append(leadAction);

    this.trail = doc.createElement("div");
    this.trail.className = "bbsc-trail";
    for (const action of content.trailing) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "bbsc-action";
      button.dataset.action = action.id;
      button.setAttribute("aria-label", action.label);
      button.tabIndex = -1;
      button.append(icon(doc, action.icon), label(doc, action.label));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onAction(action.id);
      });
      this.trail.append(button);
    }

    this.root.append(this.lead, this.trail);
    doc.body.append(this.root);
  }

  /** Move the row to `offset`. `animateMs` > 0 eases there; 0 follows the finger. */
  update(offset: number, arm: RowArm, open: boolean, animateMs: number): void {
    if (this.destroyed) return;
    const transition =
      animateMs > 0 ? `translate ${animateMs}ms ${EASE}, clip-path ${animateMs}ms ${EASE}` : "none";
    const widthTransition = animateMs > 0 ? `width ${animateMs}ms ${EASE}` : "none";
    this.row.style.transition = transition;
    this.row.style.translate = offset === 0 ? "" : `${offset}px 0`;
    // Clip in the row's own coordinates, so the clip slides with it.
    this.row.style.clipPath =
      offset < 0 ? `inset(0 0 0 ${-offset}px)` : offset > 0 ? `inset(0 ${offset}px 0 0)` : "";
    this.lead.style.transition = widthTransition;
    this.trail.style.transition = widthTransition;
    this.lead.style.width = `${Math.max(0, offset)}px`;
    this.trail.style.width = `${Math.max(0, -offset)}px`;
    this.toggle(this.lead, "data-armed", arm === "leading");
    this.toggle(this.trail, "data-full", arm === "full");
    this.toggle(this.root, "data-open", open);
  }

  /** Whether `node` is one of the uncovered buttons. */
  contains(node: EventTarget | null): boolean {
    return node instanceof Node && this.root.contains(node);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
    this.row.style.translate = this.saved.translate;
    this.row.style.transition = this.saved.transition;
    this.row.style.willChange = this.saved.willChange;
    this.row.style.clipPath = this.saved.clipPath;
  }

  private toggle(element: Element, attribute: string, on: boolean): void {
    if (on) element.setAttribute(attribute, "");
    else element.removeAttribute(attribute);
  }
}

/** Diameter of the back/forward arrow. */
const ARROW_PX = 40;
/** How far into the page a fully drawn arrow sits. */
const ARROW_INSET_PX = 16;

export class ArrowView {
  private readonly root: HTMLDivElement;
  private readonly glyphs: Record<HistoryDirection, HTMLSpanElement>;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(doc: Document) {
    this.root = layer(doc, "bbsc-arrow");
    this.root.style.width = `${ARROW_PX}px`;
    this.root.style.height = `${ARROW_PX}px`;
    this.glyphs = { back: icon(doc, "back"), forward: icon(doc, "forward") };
    this.root.append(this.glyphs.back, this.glyphs.forward);
    this.root.hidden = true;
    doc.body.append(this.root);
  }

  show(box: Box, direction: HistoryDirection, progress: number): void {
    this.cancelHide();
    const travel = (ARROW_PX + ARROW_INSET_PX) * progress;
    const left =
      direction === "back"
        ? box.left - ARROW_PX + travel
        : box.left + box.width - travel;
    Object.assign(this.root.style, {
      top: `${box.top + box.height / 2 - ARROW_PX / 2}px`,
      left: `${left}px`,
      opacity: String(Math.min(1, progress * 1.5)),
    });
    this.glyphs.back.hidden = direction !== "back";
    this.glyphs.forward.hidden = direction !== "forward";
    this.root.toggleAttribute("data-ready", progress >= 1);
    this.root.removeAttribute("data-leaving");
    this.root.hidden = false;
  }

  /** The swipe went through: hold the filled arrow a beat, then fade. */
  commit(fadeMs: number): void {
    this.root.setAttribute("data-ready", "");
    this.hide(fadeMs);
  }

  hide(fadeMs = 0): void {
    this.cancelHide();
    if (fadeMs <= 0) {
      this.root.hidden = true;
      return;
    }
    this.root.setAttribute("data-leaving", "");
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.root.hidden = true;
      this.root.removeAttribute("data-leaving");
    }, fadeMs);
  }

  destroy(): void {
    this.cancelHide();
    this.root.remove();
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
