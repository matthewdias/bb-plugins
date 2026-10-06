// jsdom throughout: the controller tests drive real DOM events through the
// same listeners the plugin installs.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
