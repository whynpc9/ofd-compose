import type { BindingPolicyVersion } from "@ofd-compose/document-model";
import { isJsonArray, isJsonObject, isMissing, type Value } from "./values.js";

/**
 * strict-1 truthiness（声明表，不用 JS truthiness）：
 * Missing/null → 假；布尔 → 本身；数字 → 非 0；字符串 → 去空白后非空且不是 "false"/"0"（不区分大小写）；
 * 数组 → 非空；对象 → 有键。
 */
export function isTruthyStrict(value: Value): boolean {
  if (isMissing(value) || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length === 0) return false;
    const lower = text.toLowerCase();
    return lower !== "false" && lower !== "0";
  }
  if (isJsonArray(value)) return value.length > 0;
  if (isJsonObject(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * legacy-compat-1 truthiness（旧引擎 IsTruthy）：与 strict 的唯一差别是字符串——
 * 任何非空白字符串为真，因此 "false" / "0" 为真。
 */
export function isTruthyLegacy(value: Value): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return isTruthyStrict(value);
}

export interface TruthinessResult {
  readonly value: boolean;
  /** legacy-compat 下结果与 strict 表不同（迁移差分需确认）。 */
  readonly legacyDiverged: boolean;
}

export function evaluateTruthiness(value: Value, policy: BindingPolicyVersion): TruthinessResult {
  const strict = isTruthyStrict(value);
  if (policy === "strict-1") return { value: strict, legacyDiverged: false };
  const legacy = isTruthyLegacy(value);
  return { value: legacy, legacyDiverged: legacy !== strict };
}
