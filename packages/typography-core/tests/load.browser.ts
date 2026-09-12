import wenkai from "../fonts/LXGWWenKai-Regular.ttf?url";
import boldItalic from "../fonts/NotoSans-BoldItalic.ttf?url";
import italic from "../fonts/NotoSans-Italic.ttf?url";
import bold from "../fonts/NotoSansCJKsc-Bold.otf?url";
import regular from "../fonts/NotoSansCJKsc-Regular.otf?url";

const urls: Record<string, string> = {
  "LXGWWenKai-Regular.ttf": wenkai,
  "NotoSans-BoldItalic.ttf": boldItalic,
  "NotoSans-Italic.ttf": italic,
  "NotoSansCJKsc-Bold.otf": bold,
  "NotoSansCJKsc-Regular.otf": regular,
};

export async function loadFontFile(file: string): Promise<Uint8Array> {
  const url = urls[file];
  if (!url) throw new Error(`Unknown fixture ${file}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Font fetch failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
