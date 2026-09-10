import type { DatePattern, NumberPattern } from "@ofd-compose/template-compiler";
import Decimal from "decimal.js";
import { Temporal } from "temporal-polyfill";
import { type DateTimeParts, matchIsoDateTime, type Value } from "./values.js";

/**
 * .NET 自定义数值格式子集的自实现（ADR-0001：不用 Intl.NumberFormat；金额走 decimal.js）。
 * 舍入：四舍五入、远离零（MidpointRounding.AwayFromZero，与 decimal.ToString(pattern) 一致）。
 */
export function formatDecimal(value: Decimal, pattern: NumberPattern): string {
  let scaled = value;
  if (pattern.scaleExponent !== 0) {
    scaled = scaled.mul(Decimal.pow(10, pattern.scaleExponent));
  }
  const negative = scaled.isNegative();
  const rounded = scaled.abs().toDecimalPlaces(pattern.fractionMaxDigits, Decimal.ROUND_HALF_UP);
  const fixed = rounded.toFixed(pattern.fractionMaxDigits);
  const dot = fixed.indexOf(".");
  let integerPart = dot === -1 ? fixed : fixed.slice(0, dot);
  let fractionPart = dot === -1 ? "" : fixed.slice(dot + 1);

  while (fractionPart.length > pattern.fractionMinDigits && fractionPart.endsWith("0")) {
    fractionPart = fractionPart.slice(0, -1);
  }

  if (integerPart === "0" && pattern.integerMinDigits === 0) {
    integerPart = "";
  } else {
    integerPart = integerPart.padStart(pattern.integerMinDigits, "0");
  }
  if (pattern.grouping && integerPart.length > 3) {
    const groups: string[] = [];
    for (let end = integerPart.length; end > 0; end -= 3) {
      groups.unshift(integerPart.slice(Math.max(0, end - 3), end));
    }
    integerPart = groups.join(",");
  }

  const digits = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart;
  const body = `${pattern.prefix}${digits}${pattern.suffix}`;
  const isZero = rounded.isZero();
  return negative && !isZero ? `-${body}` : body;
}

/**
 * 解析 ISO 8601 文本为字段。带 Z/偏移的值换算到模板锁定时区（temporal-polyfill）；
 * 不带偏移的值按字面字段使用（与旧引擎 DateTimeKind.Unspecified 行为一致）。
 */
export function toDateTimeParts(value: Value, timeZone: string): DateTimeParts | undefined {
  const match = matchIsoDateTime(value);
  if (!match) return undefined;
  const text = (value as string).trim();
  const offset = match[7];
  if (offset !== undefined) {
    const instant = Temporal.Instant.from(text);
    const zoned = instant.toZonedDateTimeISO(timeZone);
    return {
      year: zoned.year,
      month: zoned.month,
      day: zoned.day,
      hour: zoned.hour,
      minute: zoned.minute,
      second: zoned.second,
      zoned: true,
    };
  }
  const plain = Temporal.PlainDateTime.from(text);
  return {
    year: plain.year,
    month: plain.month,
    day: plain.day,
    hour: plain.hour,
    minute: plain.minute,
    second: plain.second,
    zoned: false,
  };
}

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** .NET 自定义日期时间格式子集的自实现（不用 Intl.DateTimeFormat / toLocale*）。 */
export function formatDateTime(parts: DateTimeParts, pattern: DatePattern): string {
  let out = "";
  for (const token of pattern.tokens) {
    if (token.kind === "literal") {
      out += token.text;
      continue;
    }
    switch (token.field) {
      case "yyyy":
        out += pad(parts.year, 4);
        break;
      case "yy":
        out += pad(parts.year % 100, 2);
        break;
      case "MM":
        out += pad(parts.month, 2);
        break;
      case "M":
        out += String(parts.month);
        break;
      case "dd":
        out += pad(parts.day, 2);
        break;
      case "d":
        out += String(parts.day);
        break;
      case "HH":
        out += pad(parts.hour, 2);
        break;
      case "H":
        out += String(parts.hour);
        break;
      case "mm":
        out += pad(parts.minute, 2);
        break;
      case "m":
        out += String(parts.minute);
        break;
      case "ss":
        out += pad(parts.second, 2);
        break;
      case "s":
        out += String(parts.second);
        break;
    }
  }
  return out;
}
