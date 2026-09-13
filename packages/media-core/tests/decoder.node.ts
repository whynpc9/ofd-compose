import { readFile } from "node:fs/promises";
import { prepareZXingModule } from "zxing-wasm/reader";
export async function prepareDecoder() {
  await prepareZXingModule({
    overrides: {
      wasmBinary: await readFile(
        new URL(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm")),
      ),
    },
    fireImmediately: true,
  });
}
