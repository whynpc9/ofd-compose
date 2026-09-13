import { prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
export async function prepareDecoder() {
  await prepareZXingModule({
    overrides: { wasmBinary: await (await fetch(wasmUrl)).arrayBuffer() },
    fireImmediately: true,
  });
}
