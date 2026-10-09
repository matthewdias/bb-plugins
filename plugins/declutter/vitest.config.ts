// Every test runs here, in jsdom: the scanner reads bb's DOM and the overlay
// renders. The server test asks for node in its own header.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ui/setup.ts"],
  },
});
