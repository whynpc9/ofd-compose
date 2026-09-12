import type { PathRef, PathSegment } from "./ast.js";
import { ExpressionCompileError } from "./errors.js";

export class PathSyntaxError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "PathSyntaxError";
  }
}

/**
 * 属性名沿用旧引擎 PathResolver 的宽松规则（除 `.`/`[` 外任意字符，含内部空格与中文键名），
 * 只拒绝明显的运算/脚本形态（spec §5 明确不支持算术、比较与脚本）：
 * 括号、引号，以及与空白相邻的运算符（`a + b`、`a >b`、`x && y`）。
 */
const scriptLikePattern = /[(){}'"`]|\s[+\-*/%<>=!&|^~]|[+\-*/%<>=!&|^~]\s/u;

function isPlainPropertyName(name: string): boolean {
  return !scriptLikePattern.test(name);
}

/**
 * 解析相对路径段：`a.b[0].c`。与旧引擎 PathResolver.ParsePath 一致：
 * 连续/首尾 `.` 被忽略；`[n]` 必须是整数（允许负数，负数在绑定阶段视为越界）。
 */
export function parsePathSegments(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let index = 0;
  while (index < path.length) {
    const ch = path[index];
    if (ch === ".") {
      index++;
      continue;
    }
    if (ch === "[") {
      const close = path.indexOf("]", index + 1);
      if (close <= index + 1) {
        throw new PathSyntaxError(path, `invalid path expression '${path}'`);
      }
      const indexText = path.slice(index + 1, close).trim();
      if (!/^-?\d+$/.test(indexText)) {
        throw new PathSyntaxError(path, `invalid array index '${indexText}' in path '${path}'`);
      }
      segments.push({ kind: "index", index: Number.parseInt(indexText, 10) });
      index = close + 1;
      continue;
    }
    if (ch === "]") {
      throw new PathSyntaxError(path, `invalid path expression '${path}'`);
    }
    const start = index;
    while (index < path.length && path[index] !== "." && path[index] !== "[") {
      index++;
    }
    const name = path.slice(start, index).trim();
    if (name.length > 0) {
      if (!isPlainPropertyName(name)) {
        throw new PathSyntaxError(
          path,
          `property name '${name}' in path '${path}' looks like an arithmetic/comparison/script expression, which is not part of the expression language`,
        );
      }
      segments.push({ kind: "property", name });
    }
  }
  return segments;
}

/** 解析表达式源路径：`.`（当前项）、`^`/`^^.a`（父级/祖父级）、`$`（根）、`$.a`、`$[0]`、裸路径。 */
export function parsePathRef(text: string): PathRef {
  const path = text.trim();
  if (path.length === 0) {
    throw new PathSyntaxError(text, "empty data path");
  }
  if (path === ".") {
    return { scope: "current", segments: [] };
  }
  if (path.startsWith("^")) {
    let hops = 0;
    while (path[hops] === "^") hops++;
    const rest = path.slice(hops);
    if (rest.length > 0 && !rest.startsWith(".") && !rest.startsWith("[")) {
      throw new PathSyntaxError(
        text,
        `invalid parent path '${path}': '^' must be followed by '.', '[' or nothing`,
      );
    }
    return { scope: "parent", hops, segments: parsePathSegments(rest) };
  }
  if (path === "$") {
    return { scope: "root", segments: [] };
  }
  if (path.startsWith("$.") || path.startsWith("$[")) {
    return { scope: "root", segments: parsePathSegments(path.slice(1)) };
  }
  if (path.startsWith("$")) {
    throw new PathSyntaxError(text, `invalid root path '${path}'`);
  }
  const segments = parsePathSegments(path);
  if (segments.length === 0) {
    throw new PathSyntaxError(text, `empty data path '${path}'`);
  }
  return { scope: "implicit", segments };
}

/** 解析操作参数中的路径（sort/maxby/minby 键、get 路径）；语法错误统一落为 EXPRESSION_UNSUPPORTED。 */
export function segmentsOf(path: string, what: string): PathSegment[] {
  try {
    return parsePathSegments(path.trim());
  } catch (error) {
    if (error instanceof PathSyntaxError) {
      throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", `${what}: ${error.message}`);
    }
    throw error;
  }
}

/** 解析表达式源路径（`$`, `.`, `a.b[0]`）；语法错误统一落为 EXPRESSION_UNSUPPORTED。 */
export function sourceOf(path: string): PathRef {
  try {
    return parsePathRef(path);
  } catch (error) {
    if (error instanceof PathSyntaxError) {
      throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", error.message, { path });
    }
    throw error;
  }
}
