import type { PageSettings } from "@ofd-compose/document-model";
import type { LayoutOptions } from "./layout.js";
import { LayoutError } from "./layout.js";

export type PageGeometry = NonNullable<LayoutOptions["page"]>;
/** Dimensions of custom paper are normalized to the requested orientation. */
export function pageGeometry(settings: PageSettings): PageGeometry {
  const paper =
    settings.paper === "A4"
      ? [210, 297]
      : settings.paper === "A5"
        ? [148, 210]
        : [settings.paper.width, settings.paper.height];
  const short = Math.min(...paper),
    long = Math.max(...paper);
  const width = settings.orientation === "portrait" ? short : long;
  const height = settings.orientation === "portrait" ? long : short;
  const m = settings.margins;
  const contentBox = {
    x: m.left,
    y: m.top + (settings.header?.height ?? 0),
    width: width - m.left - m.right,
    height:
      height - m.top - m.bottom - (settings.header?.height ?? 0) - (settings.footer?.height ?? 0),
  };
  if (contentBox.width < 0.001 || contentBox.height < 0.001)
    throw new LayoutError("LAYOUT_OVERFLOW", "Margins and reserved bands leave no content area");
  if (
    settings.border &&
    settings.border.inset * 2 + settings.border.width > Math.min(width, height)
  )
    throw new LayoutError("LAYOUT_OVERFLOW", "Page border exceeds paper");
  return { width, height, contentBox };
}
