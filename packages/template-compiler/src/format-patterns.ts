/**
 * 显式声明的 .NET 格式模式子集（spec §5：编译期校验；未列入的模式返回 FORMAT_PATTERN_UNSUPPORTED）。
 *
 * 数字（自定义数值格式子集）：
 * - 占位符 `0` / `#`，小数点 `.`，分组分隔符 `,`（仅作千分组，不支持尾随 `,` 缩放）；
 * - `%`（×100）与 `‰`（×1000）各至多一个，可出现在前缀或后缀；
 * - 其余字符为字面前缀/后缀（含中文、空格、货币符号）。
 * - 不支持：`;` 分节、科学计数 `E0`、转义 `\`、引号 `'` `"`、整数部分 `0` 后再出现 `#`、小数部分 `#` 后再出现 `0`。
 *
 * 日期（自定义日期时间格式子集）：
 * - 字段：`yyyy` `yy` `MM` `M` `dd` `d` `HH` `H` `mm` `m` `ss` `s`；
 * - 其余非字母字符为字面（`-` `/` `:` 空格、`年月日时分秒` 等）；
 * - 不支持：单字符标准格式（`d`、`D`、`g`…）、`MMM`/`ddd`/`tt`/`hh`/`f`/`z`/`K`、引号与转义。
 */

export interface NumberPattern {
  readonly kind: "number";
  readonly prefix: string;
  readonly suffix: string;
  readonly integerMinDigits: number;
  readonly grouping: boolean;
  readonly fractionMinDigits: number;
  readonly fractionMaxDigits: number;
  /** 十进制缩放指数：`%` → 2，`‰` → 3。 */
  readonly scaleExponent: 0 | 2 | 3;
}

export type DateField =
  | "yyyy"
  | "yy"
  | "MM"
  | "M"
  | "dd"
  | "d"
  | "HH"
  | "H"
  | "mm"
  | "m"
  | "ss"
  | "s";

export type DateToken =
  | { readonly kind: "field"; readonly field: DateField }
  | { readonly kind: "literal"; readonly text: string };

export interface DatePattern {
  readonly kind: "date";
  readonly tokens: readonly DateToken[];
}

export class FormatPatternError extends Error {
  constructor(
    readonly pattern: string,
    message: string,
  ) {
    super(message);
    this.name = "FormatPatternError";
  }
}

export function parseNumberPattern(pattern: string): NumberPattern {
  if (pattern.length === 0) {
    throw new FormatPatternError(pattern, "number pattern must not be empty");
  }
  const fail = (reason: string): never => {
    throw new FormatPatternError(pattern, `number pattern '${pattern}' unsupported: ${reason}`);
  };

  let prefix = "";
  let suffix = "";
  let integerMinDigits = 0;
  let grouping = false;
  let fractionMinDigits = 0;
  let fractionMaxDigits = 0;
  let scaleExponent: 0 | 2 | 3 = 0;
  let sawIntegerHash = false;
  let sawIntegerZero = false;
  let sawFractionHash = false;
  let phase: "prefix" | "integer" | "fraction" | "suffix" = "prefix";

  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i] as string;
    const next = pattern[i + 1];
    if (ch === ";") fail("sections (';') are not supported");
    if (ch === "\\" || ch === "'" || ch === '"')
      fail("escapes and quoted literals are not supported");
    if ((ch === "E" || ch === "e") && next !== undefined && "0+-".includes(next)) {
      fail("scientific notation is not supported");
    }
    if (ch === "%" || ch === "‰") {
      if (scaleExponent !== 0) fail("only one of '%' / '‰' is allowed");
      scaleExponent = ch === "%" ? 2 : 3;
      if (phase === "prefix") prefix += ch;
      else {
        phase = "suffix";
        suffix += ch;
      }
      continue;
    }
    const isPlaceholder = ch === "0" || ch === "#";
    if (phase === "prefix") {
      if (isPlaceholder) phase = "integer";
      else {
        prefix += ch;
        continue;
      }
    }
    if (phase === "integer") {
      if (ch === "0") {
        sawIntegerZero = true;
        integerMinDigits++;
        continue;
      }
      if (ch === "#") {
        if (sawIntegerZero) fail("'#' after '0' in the integer part is not supported");
        sawIntegerHash = true;
        continue;
      }
      if (ch === ",") {
        if (next !== "0" && next !== "#")
          fail("',' must sit between digit placeholders (no scaling)");
        grouping = true;
        continue;
      }
      if (ch === ".") {
        if (!sawIntegerZero && !sawIntegerHash) fail("'.' must follow a digit placeholder");
        phase = "fraction";
        continue;
      }
      phase = "suffix";
    }
    if (phase === "fraction") {
      if (ch === "0") {
        if (sawFractionHash) fail("'0' after '#' in the fraction part is not supported");
        fractionMinDigits++;
        fractionMaxDigits++;
        continue;
      }
      if (ch === "#") {
        sawFractionHash = true;
        fractionMaxDigits++;
        continue;
      }
      if (ch === "." || ch === ",") fail(`unexpected '${ch}' in the fraction part`);
      phase = "suffix";
    }
    if (isPlaceholder || ch === "." || ch === ",") {
      fail(`unexpected '${ch}' after the digit section`);
    }
    suffix += ch;
  }

  if (!sawIntegerZero && !sawIntegerHash) fail("no digit placeholder ('0' or '#')");
  return {
    kind: "number",
    prefix,
    suffix,
    integerMinDigits,
    grouping,
    fractionMinDigits,
    fractionMaxDigits,
    scaleExponent,
  };
}

const dateFieldsByLetter: Readonly<Record<string, readonly DateField[]>> = {
  y: ["yy", "yyyy"],
  M: ["M", "MM"],
  d: ["d", "dd"],
  H: ["H", "HH"],
  m: ["m", "mm"],
  s: ["s", "ss"],
};

export function parseDatePattern(pattern: string): DatePattern {
  if (pattern.length === 0) {
    throw new FormatPatternError(pattern, "date pattern must not be empty");
  }
  const fail = (reason: string): never => {
    throw new FormatPatternError(pattern, `date pattern '${pattern}' unsupported: ${reason}`);
  };
  if (pattern.length === 1) {
    fail("single-character patterns are .NET standard (culture-dependent) specifiers");
  }
  const tokens: DateToken[] = [];
  let literal = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === "\\" || ch === "'" || ch === '"' || ch === "%") {
      fail("escapes, quoted literals and '%' are not supported");
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < pattern.length && pattern[j] === ch) j++;
      const run = pattern.slice(i, j);
      const candidates = dateFieldsByLetter[ch];
      if (!candidates?.includes(run as DateField)) {
        fail(`field '${run}' is not in the declared subset`);
      }
      if (literal.length > 0) {
        tokens.push({ kind: "literal", text: literal });
        literal = "";
      }
      tokens.push({ kind: "field", field: run as DateField });
      i = j;
      continue;
    }
    literal += ch;
    i++;
  }
  if (literal.length > 0) tokens.push({ kind: "literal", text: literal });
  if (!tokens.some((t) => t.kind === "field")) fail("no date/time field");
  return { kind: "date", tokens };
}

/** 旧引擎 EnsureSuffixPattern：模式中不含后缀符号时追加。 */
export function ensureSuffixPattern(pattern: string, suffix: "%" | "‰"): string {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return suffix;
  return trimmed.includes(suffix) ? trimmed : `${trimmed}${suffix}`;
}

export const defaultPercentPattern = "0.##%";
export const defaultPermillePattern = "0.##‰";
