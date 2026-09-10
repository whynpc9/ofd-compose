import type { PathRef, PathSegment } from "./ast.js";

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
 * 属性名：不含空白、算术/比较/逻辑运算符、括号与引号（spec §5 明确不支持算术与脚本）。
 * 允许 `-`、`_`、数字与任意非 ASCII 字符（如中文键名）。
 */
const propertyNamePattern = /^[^\s+*/%<>=!&|?~^(){}'"`;,]+$/u;

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
      if (!propertyNamePattern.test(name)) {
        throw new PathSyntaxError(
          path,
          `property name '${name}' in path '${path}' is not a plain identifier (arithmetic, comparison and whitespace are not part of the expression language)`,
        );
      }
      segments.push({ kind: "property", name });
    }
  }
  return segments;
}

/** 解析表达式源路径：`.`（当前项）、`$`（根）、`$.a`、`$[0]`、裸路径。 */
export function parsePathRef(text: string): PathRef {
  const path = text.trim();
  if (path.length === 0) {
    throw new PathSyntaxError(text, "empty data path");
  }
  if (path === ".") {
    return { scope: "current", segments: [] };
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
