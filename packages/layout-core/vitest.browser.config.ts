import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { browserMatrixOptions } from "../../tools/browser-matrix/vitest.js";

export default defineConfig({
  resolve: {
    alias: {
      "#decoder": fileURLToPath(new URL("../media-core/tests/decoder.browser.ts", import.meta.url)),
      "#font-loader": fileURLToPath(new URL("./tests/load.browser.ts", import.meta.url)),
    },
  },
  // Preserve Emscripten's import.meta.url-relative WASM asset loading.
  optimizeDeps: { exclude: ["harfbuzzjs"] },
  test: {
    include: ["tests/**/*.dual.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      ...browserMatrixOptions(),
    },
  },
});
