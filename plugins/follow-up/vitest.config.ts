// UI tests only. `renderSlot` from the SDK's testing/app harness is built for
// vitest with jsdom; the rest of the suite stays on `node --test`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/ui/**/*.test.tsx"],
    setupFiles: ["tests/ui/setup.ts"],
  },
});
