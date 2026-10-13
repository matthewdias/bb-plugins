// Testing Library unmounts between tests only when vitest globals are on, and
// they are not, so a later test would otherwise find an earlier overlay's
// listeners still on the document.
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// jsdom has no matchMedia. The overlay asks it for bb's compact layout and for
// reduced motion: answer a desktop that animates.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query })) as typeof window.matchMedia;
