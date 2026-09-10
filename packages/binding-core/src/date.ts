import { Temporal } from "temporal-polyfill";

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

/** 解析结果：带 Z/偏移 → 绝对时刻；不带偏移 → 字面字段（旧引擎 DateTimeKind.Unspecified）。 */
export type ParsedDateTime =
  | { readonly kind: "instant"; readonly instant: Temporal.Instant }
  | { readonly kind: "plain"; readonly plain: Temporal.PlainDateTime };

const isoDateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * 只识别 ISO 8601 日期/日期时间文本；其余形态不视为日期（旧引擎的宽松 DateTime.TryParse 不沿用）。
 * 形态匹配但字段非法（`2024-13-45`、`2024-01-01Z`）同样返回 undefined，而不是让 Temporal 的 RangeError 逃出绑定。
 */
export function parseIsoDateTime(value: unknown): ParsedDateTime | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const match = isoDateTimePattern.exec(text);
  if (!match) return undefined;
  const hasTime = match[4] !== undefined;
  const offset = match[7];
  try {
    if (offset !== undefined) {
      // 仅有日期却带偏移（`2024-01-01Z`）不是合法 ISO 时刻。
      if (!hasTime) return undefined;
      return { kind: "instant", instant: Temporal.Instant.from(text.replace(" ", "T")) };
    }
    return { kind: "plain", plain: Temporal.PlainDateTime.from(text.replace(" ", "T")) };
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }
}

/** 比较用的绝对时刻：不带偏移的值按 UTC 字面理解（双方一致即可，比较不依赖模板时区）。 */
function toEpochNanoseconds(parsed: ParsedDateTime): bigint {
  return parsed.kind === "instant"
    ? parsed.instant.epochNanoseconds
    : parsed.plain.toZonedDateTime("UTC").epochNanoseconds;
}

export function compareDateTimes(left: ParsedDateTime, right: ParsedDateTime): number {
  const a = toEpochNanoseconds(left);
  const b = toEpochNanoseconds(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 解析 ISO 8601 文本为字段。带 Z/偏移的值换算到模板锁定时区（temporal-polyfill）；
 * 不带偏移的值按字面字段使用（与旧引擎 DateTimeKind.Unspecified 行为一致）。
 */
export function toDateTimeParts(value: unknown, timeZone: string): DateTimeParts | undefined {
  const parsed = parseIsoDateTime(value);
  if (!parsed) return undefined;
  const fields =
    parsed.kind === "instant" ? parsed.instant.toZonedDateTimeISO(timeZone) : parsed.plain;
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
    zoned: parsed.kind === "instant",
  };
}
