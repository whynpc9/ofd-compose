import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "#font-loader": fileURLToPath(new URL("./tests/load.browser.ts", import.meta.url)) },
  },
  // Preserve Emscripten's import.meta.url-relative WASM asset loading.
  optimizeDeps: { exclude: ["harfbuzzjs"] },
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
