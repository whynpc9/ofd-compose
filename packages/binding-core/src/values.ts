import Decimal from "decimal.js";
import { compareDateTimes, parseIsoDateTime } from "./date.js";

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

  const leftDate = parseIsoDateTime(left);
  const rightDate = parseIsoDateTime(right);
  if (leftDate && rightDate) return compareDateTimes(leftDate, rightDate);

  const a = toText(left, "pascal").toUpperCase();
  const b = toText(right, "pascal").toUpperCase();
  return a < b ? -1 : a > b ? 1 : 0;
}
