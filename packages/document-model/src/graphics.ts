import { type Static, type TProperties, Type } from "@sinclair/typebox";

const object = <T extends TProperties>(p: T) => Type.Object(p, { additionalProperties: false });
const length = Type.Number({ minimum: -100000, maximum: 100000 });
const positive = Type.Number({ minimum: 0.001, maximum: 100000 });
export const BoxSchema = object({ x: length, y: length, width: positive, height: positive });
export const MatrixSchema = object({
  a: length,
  b: length,
  c: length,
  d: length,
  e: length,
  f: length,
});
export const PathCommandSchema = Type.Union([
  object({ op: Type.Literal("move"), x: length, y: length }),
  object({ op: Type.Literal("line"), x: length, y: length }),
  object({
    op: Type.Literal("cubic"),
    x1: length,
    y1: length,
    x2: length,
    y2: length,
    x: length,
    y: length,
  }),
  object({ op: Type.Literal("close") }),
]);
export const StrokeSchema = object({
  color: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{6}$" })),
  width: positive,
  dash: Type.Optional(Type.Array(Type.Number({ minimum: 0, maximum: 10000 }), { maxItems: 32 })),
  dashOffset: Type.Optional(length),
  cap: Type.Optional(
    Type.Union([Type.Literal("butt"), Type.Literal("round"), Type.Literal("square")]),
  ),
  join: Type.Optional(
    Type.Union([Type.Literal("miter"), Type.Literal("round"), Type.Literal("bevel")]),
  ),
  miterLimit: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
});
export const PlacementSchema = object({
  alignment: Type.Optional(
    Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")]),
  ),
  gap: Type.Optional(Type.Number({ minimum: 0, maximum: 10000 })),
  crop: Type.Optional(BoxSchema),
});
export const RegionLayoutSchema = object({
  mode: Type.Union([Type.Literal("fixed"), Type.Literal("flow")]),
  box: BoxSchema,
  overflow: Type.Optional(
    Type.Union([
      object({ kind: Type.Literal("error") }),
      object({ kind: Type.Literal("truncate") }),
      object({
        kind: Type.Literal("scale"),
        minScale: Type.Number({ minimum: 0.001, maximum: 1 }),
      }),
      object({
        kind: Type.Literal("min-font-size"),
        minFontSize: Type.Number({ minimum: 1, maximum: 1000 }),
      }),
    ]),
  ),
});
export const PathNodeSchema = object({
  kind: Type.Literal("path"),
  nodeId: Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9._:-]+$" }),
  width: positive,
  height: positive,
  commands: Type.Array(PathCommandSchema, { minItems: 1, maxItems: 100000 }),
  fill: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{6}$" })),
  fillRule: Type.Optional(Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")])),
  stroke: Type.Optional(StrokeSchema),
  transform: Type.Optional(MatrixSchema),
});
export type Stroke = Static<typeof StrokeSchema>;
export type PathNode = Static<typeof PathNodeSchema>;
export type RegionLayout = Static<typeof RegionLayoutSchema>;
