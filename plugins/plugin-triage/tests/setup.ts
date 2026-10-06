// Testing Library unmounts between tests only when vitest globals are on, and
// they are not, so a later query would otherwise find an earlier render too.
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
