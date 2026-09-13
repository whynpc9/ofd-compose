import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "#decoder": fileURLToPath(new URL("./tests/decoder.browser.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.dual.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
