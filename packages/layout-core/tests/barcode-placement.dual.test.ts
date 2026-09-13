import { bind } from "@ofd-compose/binding-core";
import type { TemplateSource } from "@ofd-compose/document-model";
import { prepareMedia } from "@ofd-compose/media-core";
import { compile } from "@ofd-compose/template-compiler";
import { beforeAll, expect, it } from "vitest";
import { readBarcodes } from "zxing-wasm/reader";
import { prepareDecoder } from "#decoder";
import { layout } from "../src/index.js";
import { options } from "./fixtures.js";

beforeAll(prepareDecoder);
it.each([
  ["code128", "SCAN-2026"],
  ["ean13", "5901234123457"],
] as const)(
  "independently decodes placed/scaled %s IR including full quiet zones",
  async (symbology, value) => {
    const template: TemplateSource = {
      schemaVersion: "ofd-compose/document-model@0",
      documentId: "barcode-page",
      revisionId: "1",
      settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
      styles: {},
      body: [
        {
          kind: "region",
          nodeId: "r",
          layout: {
            mode: "fixed",
            box: { x: 40, y: 50, width: 80, height: 12 },
            overflow: { kind: "scale", minScale: 0.5 },
          },
          children: [
            {
              kind: "barcode-binding",
              nodeId: "b",
              bindingId: "binding",
              expression: { kind: "legacy", text: "code" },
              options: { symbology, width: 60, height: 15 },
            },
          ],
        },
      ],
    };
    const compiled = compile(template);
    if (!compiled.ok || !compiled.template) throw Error("compile");
    const bound = bind(compiled.template, { code: value });
    if (!bound.ok) throw Error("bind");
    const prepared = prepareMedia(bound.document);
    if (!prepared.ok) throw Error("media");
    const result = await layout(bound.document, [], options, prepared);
    const path = result.ir.pages[0]?.objects[0];
    if (path?.kind !== "path") throw Error("path");
    const state = result.ir.graphicsStates.find((s) => s.id === path.stateId);
    if (!state) throw Error("state");
    expect(state.transform.a).toBe(0.8);
    expect(state.transform.d).toBe(0.8);
    expect(path.bounds).toEqual({ x: 40000, y: 50000, width: 48000, height: 12000 });
    const density = 0.02,
      margin = 20,
      width = Math.ceil(path.bounds.width * density),
      height = Math.ceil(path.bounds.height * density) + 2 * margin;
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    const point = (x: number, y: number) => ({
      x:
        (state.transform.a * x + state.transform.c * y + state.transform.e - path.bounds.x) *
        density,
      y:
        (state.transform.b * x + state.transform.d * y + state.transform.f - path.bounds.y) *
          density +
        margin,
    });
    for (let i = 0; i < path.commands.length; i += 5) {
      const a = path.commands[i],
        c = path.commands[i + 2];
      if (a?.op !== "move" || c?.op !== "line") throw Error("rectangle");
      const from = point(a.x, a.y),
        to = point(c.x, c.y);
      for (let y = Math.ceil(from.y); y < Math.ceil(to.y); y++)
        for (let x = Math.ceil(from.x); x < Math.ceil(to.x); x++) {
          const at = (y * width + x) * 4;
          data[at] = data[at + 1] = data[at + 2] = 0;
        }
    }
    const decoded = await readBarcodes(
      { data, width, height, colorSpace: "srgb" },
      { formats: [symbology === "code128" ? "Code128" : "EAN13"] },
    );
    expect(decoded.map((r) => r.text)).toContain(value);
  },
);
