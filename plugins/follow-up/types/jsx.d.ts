// dnd-kit's published types reference the global `JSX` namespace, which React
// 19 removed in favour of `React.JSX`. Mapping it back is narrower than turning
// on skipLibCheck, which would stop type-checking every dependency to fix one.
import type * as React from "react";

declare global {
  namespace JSX {
    type Element = React.JSX.Element;
    type ElementType = React.JSX.ElementType;
    type ElementClass = React.JSX.ElementClass;
    type IntrinsicElements = React.JSX.IntrinsicElements;
  }
}

export {};
