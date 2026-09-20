import type { ParagraphLayout, TextStyle } from "@ofd-compose/document-model";

/** Shared effective paragraph defaults for layout and appearance-preserving source projection. */
export function effectiveParagraphStyle(
  defaults: TextStyle,
  own: TextStyle | undefined,
  layout: ParagraphLayout | undefined,
  generated?: TextStyle,
): TextStyle {
  const heading =
    layout?.role === "heading"
      ? { fontSize: [24, 20, 18, 16, 14, 12][(layout.headingLevel ?? 1) - 1], bold: true }
      : {};
  return { ...defaults, ...heading, ...own, ...generated };
}
