import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "#decoder": fileURLToPath(new URL("./tests/decoder.node.ts", import.meta.url)) },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
