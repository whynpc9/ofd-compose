import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { IRValidationError } from "./text.js";

/** Finite IEEE-754 number, shortest decimal expanded without exponent; -0 becomes 0. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
    throw new IRValidationError("IR_INVALID_NUMBER", "", "Invalid canonical JSON input");
  if (Object.is(value, -0)) return "0";
  const text = String(value);
  if (!text.includes("e")) return text;
  const [coefficient, exponent] = text.split("e") as [string, string];
  const sign = coefficient.startsWith("-") ? "-" : "";
  const absolute = coefficient.replace("-", "");
  const digits = absolute.replace(".", "");
  const decimal =
    (absolute.indexOf(".") < 0 ? absolute.length : absolute.indexOf(".")) + Number(exponent);
  return (
    sign +
    (decimal <= 0
      ? `0.${"0".repeat(-decimal)}${digits}`
      : decimal >= digits.length
        ? digits + "0".repeat(decimal - digits.length)
        : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`)
  );
}

/** JSON data only. Rejects undefined, holes, exotic objects, accessors, symbols and cycles. */
export function canonicalSerialize(value: unknown): string {
  const seen = new Set<object>();
  function serialize(input: unknown): string {
    if (input === null) return "null";
    if (typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
    if (typeof input === "number") return formatNumber(input);
    if (typeof input !== "object")
      throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
    if (seen.has(input))
      throw new IRValidationError("IR_CYCLIC_VALUE", "", "Invalid canonical JSON input");
    if (Object.getOwnPropertySymbols(input).length)
      throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
    seen.add(input);
    try {
      if (Array.isArray(input)) {
        if (Object.getOwnPropertyNames(input).length !== input.length + 1)
          throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
        return `[${Array.from({ length: input.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !("value" in descriptor))
            throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
          return serialize(descriptor.value);
        }).join(",")}]`;
      }
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      )
        throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
      return `{${Object.getOwnPropertyNames(input)
        .sort()
        .map((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(input, key);
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable)
            throw new IRValidationError("IR_NON_JSON_VALUE", "", "Invalid canonical JSON input");
          return `${JSON.stringify(key)}:${serialize(descriptor.value)}`;
        })
        .join(",")}}`;
    } finally {
      seen.delete(input);
    }
  }
  return serialize(value);
}
export function digestCanonical(value: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalSerialize(value))));
}

/** Round the shortest decimal representation half away from zero, without binary multiply ties. */
export function quantizeMm(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
    throw new IRValidationError("IR_LENGTH_OUT_OF_RANGE", "", "Invalid canonical JSON input");
  const [integer, fraction = ""] = formatNumber(Math.abs(value)).split(".") as [string, string?];
  const padded = fraction.padEnd(4, "0");
  const magnitude =
    Number(integer) * 1000 + Number(padded.slice(0, 3)) + (Number(padded[3]) >= 5 ? 1 : 0);
  return magnitude === 0 ? 0 : Math.sign(value) * magnitude;
}
