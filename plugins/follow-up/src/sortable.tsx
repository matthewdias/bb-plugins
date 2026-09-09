// Drag-to-reorder, on dnd-kit.
//
// This replaces a hand-rolled pointer-event hook. That version worked in the
// simple case but kept failing around scrolling: the drop target was only
// recomputed on pointermove, so autoscroll slid rows past a stationary
// placeholder. Fixing that exposed the next one, which is the usual shape of
// this problem — the hard part is not dragging, it is scroll containers.
//
// dnd-kit brings autoscroll that walks the scrollable ancestor chain, keyboard
// dragging, and screen-reader announcements, none of which were written by
// hand. React and react-dom come from the BB host at runtime, so its hooks and
// context share the host's single React instance.
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDndContext,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  defaultAnimateLayoutChanges,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type AnimateLayoutChanges,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * Wraps a list whose rows call {@link useSortableRow}.
 *
 * `onCommit` receives the resulting order and the row that moved — the server
 * needs both, because only the moved row is recorded as placed by hand.
 */
export function FollowUpSortable({
  ids,
  onCommit,
  onDragStart,
  children,
}: {
  ids: readonly string[];
  onCommit: (orderedIds: string[], movedId: string) => void;
  /**
   * Fires when a lift begins. Rows already see `anyDragging`, but that only
   * stops a new hover from opening something — whatever the parent has open,
   * or has queued on a timer, has to be told.
   */
  onDragStart?: () => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so tapping the handle on
    // touch does not immediately lift the row.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onCommit(arrayMove([...ids], from, to), String(active.id));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      // Vertical only, and never dragged out of the list it belongs to. The
      // scrollable-ancestor restriction is what keeps a row from being carried
      // off over the composer while the list scrolls beneath it.
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={[...ids]} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

export interface SortableRow {
  /** Goes on the row element. */
  setNodeRef: (node: HTMLElement | null) => void;
  style: React.CSSProperties;
  /** Spread onto the drag handle — it is the activator, not the whole row. */
  handleProps: Record<string, unknown>;
  isDragging: boolean;
  /** True while any row is being dragged, including another one. */
  anyDragging: boolean;
}

/**
 * Animate an index change whoever caused it, not only a drag.
 *
 * dnd-kit's default bails on `!wasDragging`, so a row moved by hand slid into
 * place and the same row moved by the insert button teleported there. Two
 * behaviours for one reorder. This also covers removal: when a row leaves, the
 * ones below it slide up instead of jumping, which is the bridge that list was
 * missing — no extra machinery, the layout animation already measures it.
 */
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges(args) || !args.wasDragging;

export function useSortableRow(id: string): SortableRow {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, animateLayoutChanges });
  const { active } = useDndContext();

  return {
    setNodeRef,
    style: {
      // Translate only, never `CSS.Transform`, which is
      // `[Translate, Scale].join(" ")`. These rows wrap to one or two lines,
      // and dnd-kit's layout-change animation measures a row before and after
      // its index changes and animates the difference — including
      // `scaleY: initial.height / current.height` (`useDerivedTransform`). In
      // a list of equal rows that ratio is always 1 and nobody notices; here a
      // row landing in a slot of a different height was visibly squashed or
      // stretched. Dropping the scale term fixes that while keeping the
      // position animation, which is the part that shows what is happening.
      // The sorting strategy contributes no scale of its own — every branch of
      // `verticalListSortingStrategy` returns `{scaleX: 1, scaleY: 1}`.
      transform: CSS.Translate.toString(transform),
      transition,
      // Lift the dragged row above its neighbours as they slide past it.
      zIndex: isDragging ? 1 : undefined,
      position: isDragging ? "relative" : undefined,
    },
    handleProps: { ref: setActivatorNodeRef, ...attributes, ...listeners },
    isDragging,
    anyDragging: active !== null,
  };
}
