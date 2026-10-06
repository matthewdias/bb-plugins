// Every test runs here, in jsdom: the timeline helpers read bb's DOM and the
// overlay renders. The server test asks for node in its own header.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ui/setup.ts"],
  },
});
