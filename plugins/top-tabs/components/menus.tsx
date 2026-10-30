// Tab Nav's two menus: a tab's context menu, and the + picker.
import { useRef, type ReactNode } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { NavItem } from "../lib/nav.ts";
import { usePortalScopeProps } from "../lib/portal-scope.ts";
import type { TabId } from "../lib/tabs-model.ts";
import { TabIcon } from "./destinations.tsx";
import { PinGlyph, PlusGlyph, SplitGlyph } from "./glyphs.tsx";

/** The modifier bb's navigation uses for "open in split": ⌘ on Apple, Ctrl elsewhere. */
const SPLIT_MODIFIER =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export interface SplitAction {
  label: string;
  run: () => void;
}

export interface TabMenuProps {
  id: TabId;
  /** The destination, or null for Threads. */
  item: NavItem | null;
  isPinned: boolean;
  canCloseOthers: boolean;
  canCloseBelow: boolean;
  canReopen: boolean;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseBelow: () => void;
  onReopen: () => void;
  onTogglePin: () => void;
  /** What "split" means for this tab here, or null when it cannot split. */
  split: SplitAction | null;
  onDetails: () => void;
}

export function TabMenu({ children, ...props }: TabMenuProps & { children: ReactNode }) {
  const scope = usePortalScopeProps();
  const isDestination = props.item !== null;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="bb-tab-nav-menu" {...scope}>
          {isDestination && (
            <ContextMenu.Item className="bb-tab-nav-menu-item" onSelect={props.onTogglePin}>
              {props.isPinned ? "Unpin tab" : "Pin tab"}
            </ContextMenu.Item>
          )}
          {isDestination && !props.isPinned && (
            <ContextMenu.Item className="bb-tab-nav-menu-item" onSelect={props.onClose}>
              Close tab
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className="bb-tab-nav-menu-item"
            disabled={!props.canCloseOthers}
            onSelect={props.onCloseOthers}
          >
            {isDestination ? "Close other tabs" : "Close all tabs"}
          </ContextMenu.Item>
          {isDestination && (
            <ContextMenu.Item
              className="bb-tab-nav-menu-item"
              disabled={!props.canCloseBelow}
              onSelect={props.onCloseBelow}
            >
              Close tabs below
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            className="bb-tab-nav-menu-item"
            disabled={!props.canReopen}
            onSelect={props.onReopen}
          >
            Reopen closed tab
          </ContextMenu.Item>
          {props.split !== null && (
            <>
              <ContextMenu.Separator className="bb-tab-nav-menu-separator" />
              <ContextMenu.Item className="bb-tab-nav-menu-item" onSelect={props.split.run}>
                {props.split.label}
              </ContextMenu.Item>
            </>
          )}
          {props.item !== null && props.item.pluginId !== null && (
            <>
              {props.split === null && <ContextMenu.Separator className="bb-tab-nav-menu-separator" />}
              <ContextMenu.Item className="bb-tab-nav-menu-item" onSelect={props.onDetails}>
                Plugin details
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export interface TabPickerProps {
  /** The rail shows names, so the button says what it does. */
  wide?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: readonly NavItem[];
  openIds: readonly string[];
  pinnedIds: readonly string[];
  active: TabId | null;
  canReopen: boolean;
  /** What "split" means for a destination right now, or null. */
  splitFor: (id: string) => SplitAction | null;
  onPick: (id: string) => void;
  onTogglePin: (id: string) => void;
  onReopen: () => void;
}

/**
 * The + button: every destination bb offers, open or not, in bb's own order.
 *
 * A row opens its tab. Its split button, or a ⌘-click (Ctrl-click elsewhere)
 * as in bb's own navigation, opens it in a split instead. Its pin button pins
 * or unpins it and leaves the menu open, so several pins can be set in one
 * visit; pinning a destination that is not open opens its tab without going
 * there.
 *
 * The rows follow bb's own order: reorder and hide them with bb's Customize
 * navigation, and the menu follows.
 */
export function TabPicker(props: TabPickerProps) {
  const scope = usePortalScopeProps();
  // Radix reports a selection without the event that caused it, so the
  // modifier is noted on the way in. Keyboard selection replays as a click,
  // which is why a click only ever adds the modifier, never clears it.
  const wantsSplit = useRef(false);
  const note = (event: { metaKey: boolean; ctrlKey: boolean }) => {
    wantsSplit.current = event.metaKey || event.ctrlKey;
  };

  return (
    <DropdownMenu.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="bb-tab-nav-add" aria-label="Open a tab" title={props.wide ? undefined : "Open a tab"}>
          <PlusGlyph />
          {props.wide && <span className="bb-tab-nav-label">Open a tab</span>}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="bb-tab-nav-menu bb-tab-nav-picker"
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          {...scope}
        >
          <DropdownMenu.Label className="bb-tab-nav-menu-label">Open a tab</DropdownMenu.Label>
          {props.destinations.map((item) => {
            const isOpen = props.openIds.includes(item.id);
            const isPinned = props.pinnedIds.includes(item.id);
            const split = props.splitFor(item.id);
            return (
              <DropdownMenu.Item
                key={item.id}
                className="bb-tab-nav-menu-item"
                disabled={item.isDisabled || item.isLoading}
                textValue={item.label}
                data-current={props.active === item.id ? "" : undefined}
                onPointerDown={note}
                onKeyDown={note}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) wantsSplit.current = true;
                }}
                onSelect={() => {
                  const splitting = wantsSplit.current && split !== null;
                  wantsSplit.current = false;
                  if (splitting) split.run();
                  else props.onPick(item.id);
                }}
              >
                <span className="bb-tab-nav-menu-icon">
                  <TabIcon item={item} />
                </span>
                <span className="bb-tab-nav-menu-name">
                  <span className="bb-tab-nav-menu-text">{item.label}</span>
                  {isOpen && !isPinned && <span className="bb-tab-nav-menu-open" aria-label="Open" />}
                </span>
                {item.shortcut !== null && (
                  <span className="bb-tab-nav-menu-hint">{item.shortcut.label}</span>
                )}
                {split !== null && (
                  <button
                    type="button"
                    className="bb-tab-nav-menu-split"
                    title={`${split.label} (${SPLIT_MODIFIER}click)`}
                    aria-label={`${split.label}: ${item.label}`}
                    tabIndex={-1}
                    onClick={(event) => {
                      // Keep the row from also opening the tab.
                      event.preventDefault();
                      event.stopPropagation();
                      props.onOpenChange(false);
                      split.run();
                    }}
                  >
                    <SplitGlyph />
                  </button>
                )}
                <button
                  type="button"
                  className="bb-tab-nav-menu-pin"
                  data-pinned={isPinned ? "" : undefined}
                  aria-pressed={isPinned}
                  aria-label={`${isPinned ? "Unpin" : "Pin"} ${item.label}`}
                  title={isPinned ? "Unpin" : "Pin"}
                  tabIndex={-1}
                  onClick={(event) => {
                    // Toggle in place: the row must not also open the tab,
                    // and the menu stays open for the next pin.
                    event.preventDefault();
                    event.stopPropagation();
                    props.onTogglePin(item.id);
                  }}
                >
                  <PinGlyph filled={isPinned} />
                </button>
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Separator className="bb-tab-nav-menu-separator" />
          <DropdownMenu.Item
            className="bb-tab-nav-menu-item"
            disabled={!props.canReopen}
            onSelect={props.onReopen}
          >
            <span className="bb-tab-nav-menu-text">Reopen closed tab</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
