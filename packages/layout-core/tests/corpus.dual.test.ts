import { bind, paragraphText } from "@ofd-compose/binding-core";
import { compile } from "@ofd-compose/template-compiler";
import { expect, it } from "vitest";
import data from "../../../tests/golden-corpus/library/examples/08-inline-friendly-expressions/data.json";
import expected from "../../../tests/golden-corpus/library/examples/08-inline-friendly-expressions/expected/semantics.json";
import template from "../../../tests/golden-corpus/library/examples/08-inline-friendly-expressions/template.txt?raw";
import { templateFromText } from "../../../tests/golden-corpus/src/corpus-template.js";
import { layout } from "../src/index.js";
import { fonts, options } from "./fixtures.js";

it("extracts the committed narrative corpus exactly after binding, shaping and line breaking", async () => {
  const source = templateFromText(template, {
    documentId: "corpus08",
    bindingPolicyVersion: "strict-1",
  });
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const bound = bind(compiled.template, data);
  expect(bound.ok).toBe(true);
  const paragraphs = bound.document.body.map((b) => {
    if (b.kind !== "paragraph") throw new Error("Expected narrative paragraph");
    return paragraphText(b);
  });
  expect(paragraphs).toEqual(expected.paragraphs);
  const { ir } = await layout(bound.document, await fonts(), options);
  const objects = new Map(ir.pages.flatMap((p) => p.objects).map((o) => [o.id, o]));
  const extracted = ir.semantics
    .map((s) => {
      const o = objects.get(s.objectId);
      return o?.kind === "text" ? o.logicalText : "";
    })
    .join("");
  expect(extracted).toBe(paragraphs.join(""));
});
