import type { FormatSpec } from "./ast.js";
import { ExpressionCompileError } from "./errors.js";
import {
  defaultPercentPattern,
  defaultPermillePattern,
  ensureSuffixPattern,
  FormatPatternError,
  parseDatePattern,
  parseNumberPattern,
} from "./format-patterns.js";

const formatKindAliases: Readonly<Record<string, FormatSpec["kind"]>> = {
  number: "number",
  numeric: "number",
  percent: "percent",
  percentage: "percent",
  permille: "permille",
  "per-mille": "permille",
  per_mille: "permille",
  date: "date",
  datetime: "date",
  time: "date",
};

export interface BuiltFormatSpec {
  readonly spec: FormatSpec;
  /** 别名规范化（如 numeric → number）；无别名时为 undefined。 */
  readonly normalizedFrom?: string;
}

/**
 * 由格式种类与模式文本构造 FormatSpec，并在编译期校验模式属于声明子集。
 * 种类不在清单 → EXPRESSION_UNSUPPORTED；模式不在子集 → FORMAT_PATTERN_UNSUPPORTED。
 */
export function buildFormatSpec(kindRaw: string, patternRaw: string | undefined): BuiltFormatSpec {
  const kindKey = kindRaw.trim().toLowerCase();
  const kind = formatKindAliases[kindKey];
  if (kind === undefined) {
    throw new ExpressionCompileError(
      "EXPRESSION_UNSUPPORTED",
      `unsupported format kind '${kindRaw}'`,
      { formatKind: kindRaw },
    );
  }
  const pattern = (patternRaw ?? "").trim();
  const unsupported = (error: unknown, resolvedPattern: string): never => {
    const reason = error instanceof FormatPatternError ? error.message : String(error);
    throw new ExpressionCompileError("FORMAT_PATTERN_UNSUPPORTED", reason, {
      formatKind: kind,
      pattern: resolvedPattern,
    });
  };
  const normalizedFrom = kindKey === kind ? undefined : kindKey;

  switch (kind) {
    case "number": {
      if (pattern.length === 0) {
        throw new ExpressionCompileError(
          "FORMAT_PATTERN_UNSUPPORTED",
          "format:number requires a pattern (e.g. format:number:0.00)",
          { formatKind: kind, pattern: "" },
        );
      }
      try {
        parseNumberPattern(pattern);
      } catch (error) {
        unsupported(error, pattern);
      }
      return { spec: { kind, pattern }, normalizedFrom };
    }
    case "percent":
    case "permille": {
      const suffix = kind === "percent" ? "%" : "‰";
      const resolved =
        pattern.length === 0
          ? kind === "percent"
            ? defaultPercentPattern
            : defaultPermillePattern
          : ensureSuffixPattern(pattern, suffix);
      try {
        const parsed = parseNumberPattern(resolved);
        if (parsed.scaleExponent !== (kind === "percent" ? 2 : 3)) {
          throw new FormatPatternError(resolved, `pattern '${resolved}' must scale by '${suffix}'`);
        }
      } catch (error) {
        unsupported(error, resolved);
      }
      return { spec: { kind, pattern: resolved }, normalizedFrom };
    }
    case "date": {
      if (pattern.length === 0) {
        throw new ExpressionCompileError(
          "FORMAT_PATTERN_UNSUPPORTED",
          "format:date requires a pattern (e.g. format:date:yyyy-MM-dd)",
          { formatKind: kind, pattern: "" },
        );
      }
      try {
        parseDatePattern(pattern);
      } catch (error) {
        unsupported(error, pattern);
      }
      return { spec: { kind, pattern }, normalizedFrom };
    }
  }
}
