import path from "node:path";
import { ResolvedDocumentSchema } from "@ofd-compose/binding-core";
import { TemplateSourceSchema, toJsonSchemaDocument } from "@ofd-compose/document-model";
import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";

/**
 * ADR-0001 §B：TypeBox 定义 → JSON Schema 2020-12 存入 `schemas/`，供 .NET 侧校验共享。
 * 入库文件必须与 TypeBox 定义逐字节一致；变更定义后运行 `pnpm --filter @ofd-compose/gate-tests test -- -u` 更新。
 */
const schemasDir = path.resolve(import.meta.dirname, "../../../schemas/document-model");

const contracts = [
  ["template-source.schema.json", TemplateSourceSchema],
  ["resolved-document.schema.json", ResolvedDocumentSchema],
] as const;

for (const [file, schema] of contracts) {
  it(`schemas/document-model/${file} matches the TypeBox definition`, async () => {
    const document = toJsonSchemaDocument(schema);
    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot(
      path.join(schemasDir, file),
    );
  });

  it(`schemas/document-model/${file} is a valid JSON Schema 2020-12 document`, () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
    expect(() => ajv.compile(toJsonSchemaDocument(schema))).not.toThrow();
  });
}
