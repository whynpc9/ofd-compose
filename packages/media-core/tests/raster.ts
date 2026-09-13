import type { PreparedBarcode } from "../src/index.js";
/** Independent test-only CPU rasterizer consumes the IR path, never generator data. */
export function raster(code: PreparedBarcode) {
  const pixelsPerMm = 20,
    margin = 20;
  const width = Math.ceil(code.width * pixelsPerMm),
    height = Math.ceil(code.height * pixelsPerMm) + 2 * margin;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const commands = code.path.commands;
  for (let i = 0; i < commands.length; i += 5) {
    const a = commands[i],
      b = commands[i + 1],
      c = commands[i + 2],
      close = commands[i + 4];
    if (a?.op !== "move" || b?.op !== "line" || c?.op !== "line" || close?.op !== "close")
      throw Error("Expected IR rectangle");
    for (
      let y = Math.ceil(a.y * pixelsPerMm) + margin;
      y < Math.ceil(c.y * pixelsPerMm) + margin;
      y++
    )
      for (let x = Math.ceil(a.x * pixelsPerMm); x < Math.ceil(b.x * pixelsPerMm); x++) {
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
      }
  }
  return { data, width, height, colorSpace: "srgb" as const };
}
