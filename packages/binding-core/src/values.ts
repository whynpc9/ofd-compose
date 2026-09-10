import Decimal from "decimal.js";

export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

/** 数据中不存在（区别于显式 `null`）。 */
export const MISSING: unique symbol = Symbol("ofd-compose.binding.missing");
export type Missing = typeof MISSING;
export type Value = JsonValue | Missing;

export function isMissing(value: Value): value is Missing {
  return value === MISSING;
}

export function isJsonObject(value: Value): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: Value): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** 十进制解析：JSON 数字或规范数字文本（允许千分位逗号与指数）。不接受布尔/对象。 */
export function toDecimal(value: Value): Decimal | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Decimal(value) : undefined;
  }
  if (typeof value === "string") {
    const text = value.trim().replaceAll(",", "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined;
    return new Decimal(text);
  }
  return undefined;
}

export interface DateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** 输入是否带 Z / 偏移（决定是否按模板时区换算）。 */
  readonly zoned: boolean;
}

const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** 只识别 ISO 8601 日期/日期时间文本；其余形态不视为日期（旧引擎的宽松 DateTime.TryParse 不沿用）。 */
export function matchIsoDateTime(value: Value): RegExpExecArray | undefined {
  if (typeof value !== "string") return undefined;
  const match = isoDateTimePattern.exec(value.trim());
  return match ?? undefined;
}

/** 旧引擎 ToText 的确定性版本：null/Missing → 空串；数字不用指数记法；对象/数组 → 紧凑 JSON。 */
export function toText(value: Value, booleanStyle: "lower" | "pascal"): string {
  if (isMissing(value) || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") {
    if (booleanStyle === "pascal") return value ? "True" : "False";
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Decimal(value).toFixed() : String(value);
  }
  return JSON.stringify(value);
}

/**
 * 排序/极值比较（旧引擎 CompareTokens）：null/Missing 最小；双方均为数字 → 数值比较；
 * 双方均为 ISO 日期 → 时间比较；否则不区分大小写的字符串比较（按 UTF-16 码元）。
 */
export function compareValues(left: Value, right: Value): number {
  const leftNull = isMissing(left) || left === null;
  const rightNull = isMissing(right) || right === null;
  if (leftNull) return rightNull ? 0 : -1;
  if (rightNull) return 1;

  const leftDecimal = toDecimal(left);
  const rightDecimal = toDecimal(right);
  if (leftDecimal && rightDecimal) return leftDecimal.comparedTo(rightDecimal);

  const leftDate = matchIsoDateTime(left);
  const rightDate = matchIsoDateTime(right);
  if (leftDate && rightDate) {
    const a = (left as string).trim();
    const b = (right as string).trim();
    return a < b ? -1 : a > b ? 1 : 0;
  }

  const a = toText(left, "pascal").toUpperCase();
  const b = toText(right, "pascal").toUpperCase();
  return a < b ? -1 : a > b ? 1 : 0;
}
