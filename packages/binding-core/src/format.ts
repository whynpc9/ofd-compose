import type { JobContext } from "@ofd-compose/document-model";
import type { DatePattern, NumberPattern } from "@ofd-compose/template-compiler";
import Decimal from "decimal.js";
import type { DateTimeParts } from "./date.js";

/**
 * .NET 自定义数值格式子集的自实现（ADR-0001：不用 Intl.NumberFormat；金额走 decimal.js）。
 * 舍入：四舍五入、远离零（MidpointRounding.AwayFromZero，与 decimal.ToString(pattern) 一致）。
 */
export class FormattingLimitError extends Error {}
export function formatDecimal(value: Decimal, pattern: NumberPattern, job?: JobContext): string {
  // Exponent text is compact input but toFixed expands it. Reserve the worst-case result,
  // including rounding carry, grouping and affixes, before any fixed-point allocation.
  const integerDigits = Math.max(1, value.e + pattern.scaleExponent + 2, pattern.integerMinDigits);
  const outputUnits =
    integerDigits +
    Math.ceil(integerDigits / 3) +
    pattern.fractionMaxDigits +
    pattern.prefix.length +
    pattern.suffix.length +
    2;
  if (
    !value.isFinite() ||
    !Number.isSafeInteger(outputUnits) ||
    outputUnits > 1_000_000 ||
    outputUnits < 0
  )
    throw new FormattingLimitError("Formatted number exceeds the output character budget");
  job?.charge("bind", outputUnits * 12 + pattern.fractionMaxDigits ** 2);

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
      groups.push(integerPart.slice(Math.max(0, end - 3), end));
    }
    integerPart = groups.reverse().join(",");
  }

  const digits = fractionPart.length > 0 ? `${integerPart}.${fractionPart}` : integerPart;
  const body = `${pattern.prefix}${digits}${pattern.suffix}`;
  const isZero = rounded.isZero();
  return negative && !isZero ? `-${body}` : body;
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
