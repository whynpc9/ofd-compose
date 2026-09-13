import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#decoder": fileURLToPath(new URL("../media-core/tests/decoder.node.ts", import.meta.url)),
      "#font-loader": fileURLToPath(new URL("./tests/load.node.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
