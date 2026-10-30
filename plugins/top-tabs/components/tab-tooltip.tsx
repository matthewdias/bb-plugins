// A destination tab's hover card: its name, unless the tab already shows
// all of it, where inside its panel it is, and, for a pin that has moved,
// where it was pinned, unless that was its panel's start. With none of those
// to say, it stays shut.
//
// Drawn rather than left to the `title` attribute, which in a browser shows
// only after a long, fixed delay. To the rail's right, as bb's Rail draws its
// own.
import { useRef, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { usePortalScopeProps } from "../lib/portal-scope.ts";

/** Wraps the rail, so moving from tab to tab shows each one straight away. */
export function TabTooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </Tooltip.Provider>
  );
}

export interface TabTooltipProps {
  name: string;
  /** Where inside its panel the tab is, or null at the panel's start. */
  where: string | null;
  /**
   * Where a pin away from it was pinned ("Pinned at issues/2"), or null,
   * including for a pin made at its panel's start.
   */
  pin: string | null;
  children: ReactNode;
}

/** Whether the tab draws its whole name: labelled, and not cut short. */
function showsWholeName(trigger: HTMLElement | null): boolean {
  const label = trigger?.querySelector(".bb-tab-nav-label");
  return label instanceof HTMLElement && label.scrollWidth <= label.clientWidth;
}

export function TabTooltip({ name, where, pin, children }: TabTooltipProps) {
  const scope = usePortalScopeProps();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Measured as the tooltip opens: whether the label is cut short depends on
  // how wide the rail is right now.
  const [withName, setWithName] = useState(true);
  const onOpenChange = (next: boolean) => {
    if (next) setWithName(!showsWholeName(trigger.current));
    setOpen(next);
  };
  const hasLines = withName || where !== null || pin !== null;
  return (
    <Tooltip.Root open={open && hasLines} onOpenChange={onOpenChange}>
      <Tooltip.Trigger asChild ref={trigger}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="bb-tab-nav-tooltip" side="right" sideOffset={8} collisionPadding={8} {...scope}>
          {withName && <div className="bb-tab-nav-tooltip-name">{name}</div>}
          {where !== null && <div className="bb-tab-nav-tooltip-where">{where}</div>}
          {pin !== null && <div className="bb-tab-nav-tooltip-pin">{pin}</div>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
