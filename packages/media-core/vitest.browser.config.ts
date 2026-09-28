import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { browserMatrixOptions } from "../../tools/browser-matrix/vitest.js";
export default defineConfig({
  resolve: {
    alias: { "#decoder": fileURLToPath(new URL("./tests/decoder.browser.ts", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.dual.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      ...browserMatrixOptions(),
    },
  },
});
