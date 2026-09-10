import type { TSchema } from "@sinclair/typebox";

/**
 * 把 TypeBox 定义导出为 JSON Schema 2020-12 文档（ADR-0001 §B：契约 schema 存入 `schemas/`）。
 * TypeBox schema 本身就是 JSON Schema；这里只剥离符号键并加 `$schema`。
 */
export function toJsonSchemaDocument(schema: TSchema): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  return { $schema: "https://json-schema.org/draft/2020-12/schema", ...plain };
}
