// DOM tests only: the controller against a copy of bb's markup. The pure
// geometry stays on `node --test`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/ui/**/*.test.ts"],
  },
});
