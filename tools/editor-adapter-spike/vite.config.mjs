import { resolve } from "node:path";
export default {
  root: resolve("tools/editor-adapter-spike"),
  server: { host: "127.0.0.1", port: 4535, strictPort: true, fs: { allow: [resolve(".")] } },
  resolve: {
    alias: {
      "@upstream": resolve(".scratch/first-release/reference/issue35/patched/src/editor/index.ts"),
      "@published": resolve(
        ".scratch/first-release/reference/issue35/package/dist/canvas-editor.js",
      ),
    },
  },
};
