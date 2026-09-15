// biome-ignore-all lint/style/noNonNullAssertion: Fixed-cardinality corpus fixtures are checked by their explicit inventory tests.
import type { JsonValue } from "@ofd-compose/binding-core";
import type { BindingPolicyVersion } from "@ofd-compose/document-model";
import { beforeAll, expect, it } from "vitest";
import {
  isExecutableTemplate,
  templateFromText,
} from "../../../tests/golden-corpus/src/corpus-template.js";
import { type ResourcePack, render } from "../src/index.js";
import { profile, resources } from "./fixtures.js";

const templates = import.meta.glob<string>("../../../tests/golden-corpus/library/**/template.txt", {
  eager: true,
  import: "default",
  query: "?raw",
});
const data = import.meta.glob<JsonValue>("../../../tests/golden-corpus/library/**/data.json", {
  eager: true,
  import: "default",
});
const manifests = import.meta.glob<{
  caseId: string;
  nativeProfile: { bindingPolicyVersion: BindingPolicyVersion };
}>("../../../tests/golden-corpus/library/**/case.json", { eager: true, import: "default" });
const semantics = import.meta.glob<{ paragraphs?: string[]; tables?: { rows: string[][] }[] }>(
  "../../../tests/golden-corpus/library/**/expected/semantics.json",
  { eager: true, import: "default" },
);
const cases = Object.entries(templates).filter(([, text]) => isExecutableTemplate(text));
let pack: ResourcePack;
beforeAll(async () => {
  pack = await resources();
});
it("accounts for all 19 executable library text/structure cases", () => {
  expect(cases).toHaveLength(19);
  expect(Object.keys(manifests)).toHaveLength(28);
});
it.each(cases)("renders corpus %s to semantically complete IR", async (path, text) => {
  const dir = path.slice(0, -"/template.txt".length),
    manifest = manifests[`${dir}/case.json`]!,
    expected = semantics[`${dir}/expected/semantics.json`]!;
  const template = templateFromText(text, {
    documentId: manifest.caseId,
    bindingPolicyVersion: manifest.nativeProfile.bindingPolicyVersion,
  });
  const result = await render(template, data[`${dir}/data.json`]!, pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const objects = new Map(result.ir.pages.flatMap((p) => p.objects).map((o) => [o.id, o]));
  const extracted = result.semanticMap
    .map((s) => objects.get(s.objectId))
    .map((o) => (o?.kind === "text" ? o.logicalText : ""))
    .join("");
  // Corpus expected text is independent of compile/bind/render implementations.
  expect(extracted).toBe(
    (expected.paragraphs ?? []).join("") +
      (expected.tables ?? []).flatMap((t) => t.rows.flat()).join(""),
  );
});
