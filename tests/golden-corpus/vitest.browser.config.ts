import { defineConfig } from "vitest/config";
import { browserMatrixOptions } from "../../tools/browser-matrix/vitest.js";

export default defineConfig({
  test: {
    name: "browser",
    include: ["tests/**/*.dual.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      ...browserMatrixOptions(),
    },
  },
});
