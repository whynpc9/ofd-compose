import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
export default defineConfig({
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
