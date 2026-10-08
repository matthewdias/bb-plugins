// Every test runs here, not on `node --test`: this plugin's modules import one
// another without file extensions, which only a bundler resolves. jsdom
// throughout, because the header, drawer, publisher and settings tests render
// through the SDK's testing/app harness; the server test asks for node in its
// own header.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/ui/setup.ts"],
  },
});
