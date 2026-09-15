import type { Stroke } from "@ofd-compose/document-model";
import type { LayoutIR } from "@ofd-compose/layout-ir";
import { LayoutError } from "./layout.js";
export type Box = LayoutIR["pages"][number]["contentBox"];
export type Matrix = LayoutIR["graphicsStates"][number]["transform"];
export type Command = Extract<
  LayoutIR["pages"][number]["objects"][number],
  { kind: "path" }
>["commands"][number];
export const identity: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
export function rectangle(box: Box): Command[] {
  return [
    { op: "move", x: box.x, y: box.y },
    { op: "line", x: box.x + box.width, y: box.y },
    { op: "line", x: box.x + box.width, y: box.y + box.height },
    { op: "line", x: box.x, y: box.y + box.height },
    { op: "close" },
  ];
}
/** Shared paragraph/cell/table border path. Stroke stays inside its assigned box. */
export function validateBorderFits(box: Box, stroke: Stroke, nodeId?: string): void {
  if (stroke.width > Math.min(box.width, box.height))
    throw new LayoutError("LAYOUT_OVERFLOW", "Border is larger than its assigned box", nodeId);
}
export function borderPath(box: Box, stroke: Stroke): Command[] {
  validateBorderFits(box, stroke);
  const inset = stroke.width / 2;
  return rectangle({
    x: box.x + inset,
    y: box.y + inset,
    width: box.width - stroke.width,
    height: box.height - stroke.width,
  });
}
export function compose(a: Matrix, b: Matrix): Matrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    e: a.a * b.e + a.c * b.f + a.e,
    f: a.b * b.e + a.d * b.f + a.f,
  };
}
export function transformedBox(box: Box, m: Matrix): Box {
  const points = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x = 0, y = 0]) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f }));
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
export function inverse(m: Matrix): Matrix {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new LayoutError("LAYOUT_INPUT", "Singular or degenerate path transform");
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}
export function clipRectangle(box: Box, m: Matrix) {
  const inv = inverse(m);
  return {
    coordinateSpace: "local" as const,
    fillRule: "nonzero" as const,
    commands: rectangle(box).map((c) =>
      c.op === "close"
        ? c
        : {
            op: c.op as "move" | "line",
            x: inv.a * c.x + inv.c * c.y + inv.e,
            y: inv.b * c.x + inv.d * c.y + inv.f,
          },
    ),
  };
}
export function intersect(a: Box, b: Box): Box {
  const x = Math.min(b.x + b.width, Math.max(a.x, b.x)),
    y = Math.min(b.y + b.height, Math.max(a.y, b.y));
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}
