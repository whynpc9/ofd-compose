import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { browserMatrixOptions } from "../../tools/browser-matrix/vitest.js";

export default defineConfig({
  resolve: {
    alias: {
      "#subset-wasm?url": `${fileURLToPath(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs")))}?url`,
      "#decoder": fileURLToPath(new URL("../media-core/tests/decoder.browser.ts", import.meta.url)),
      "#font-loader": fileURLToPath(new URL("./tests/load.browser.ts", import.meta.url)),
    },
  },
  // Preserve Emscripten's import.meta.url-relative WASM asset loading.
  optimizeDeps: { exclude: ["harfbuzzjs"] },
  test: {
    testTimeout: 30_000,
    include: ["tests/**/*.dual.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      ...browserMatrixOptions(),
    },
  },
});
