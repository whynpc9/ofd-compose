import type { DiagnosticCode, DiagnosticPhase, JobContext } from "@ofd-compose/document-model";

export class RenderError extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
  ) {
    super(message);
  }
}
export interface Cancellation {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
export const renderLimits = Object.freeze({
  workUnits: 512_000_000,
  jsonNodes: 200_000,
  stringUnits: 8_000_000,
  resourceBytes: 160 * 1024 * 1024,
  resources: 128,
  subsetBytes: 128 * 1024 * 1024,
});
export interface RenderControl {
  /** Explicit opt-in to minimized native editing source; distribution omits it. */
  sourceAttachment?: boolean;
  limits?: Partial<Record<keyof typeof renderLimits, number>>;
  signal?: Cancellation;
}
export class RenderBudget implements JobContext {
  readonly limits: Record<keyof typeof renderLimits, number>;
  readonly used = {
    workUnits: 0,
    jsonNodes: 0,
    stringUnits: 0,
    resourceBytes: 0,
    resources: 0,
    subsetBytes: 0,
  };
  readonly stages: Partial<Record<DiagnosticPhase, number>> = {};
  constructor(
    readonly signal?: Cancellation,
    limits: RenderControl["limits"] = {},
    readonly captureSource = false,
  ) {
    this.limits = { ...renderLimits };
    for (const key of Object.keys(renderLimits) as (keyof typeof renderLimits)[]) {
      const descriptor = Object.getOwnPropertyDescriptor(limits, key);
      if (descriptor && !("value" in descriptor))
        throw new RenderError("MODEL_INVALID", "Budget must contain data fields");
      const value = descriptor?.value ?? renderLimits[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > renderLimits[key])
        throw new RenderError("RESOURCE_LIMIT", `Invalid render limit: ${key}`);
      this.limits[key] = value;
    }
  }
  reserve(key: keyof RenderBudget["used"], amount: number): void {
    this.check();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[key] - this.used[key])
      throw new RenderError("RESOURCE_LIMIT", `Render budget exceeded: ${key}`);
    this.used[key] += amount;
  }
  check(): void {
    if (this.signal?.aborted) throw new RenderError("RENDER_CANCELLED", "Render cancelled");
  }
  charge(phase: DiagnosticPhase, units: number): void {
    this.reserve("workUnits", units);
    this.stages[phase] = (this.stages[phase] ?? 0) + units;
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    this.check();
    if (!this.signal) return promise;
    const signal = this.signal;
    let listener: () => void = () => {};
    const abort = new Promise<never>((_, reject) => {
      listener = () =>
        reject(new RenderError("RENDER_CANCELLED", "Render cancelled while acquiring resources"));
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
    });
    try {
      return await Promise.race([promise, abort]);
    } finally {
      signal.removeEventListener("abort", listener);
    }
  }
}
/** Bounded, descriptor-only JSON snapshot. Reject accessors, cycles, sparse arrays and exotic objects. */
export function snapshot<T>(input: T, budget: RenderBudget, phase: DiagnosticPhase = "render"): T {
  const active = new Set<object>();
  const copy = (value: unknown, depth: number): unknown => {
    budget.reserve("jsonNodes", 1);
    budget.charge(phase, 32);
    if (depth > 64) throw new RenderError("RESOURCE_LIMIT", "JSON depth exceeded");
    if (typeof value === "string") {
      budget.reserve("stringUnits", value.length);
      budget.charge(phase, value.length * 6);
      if (!value.isWellFormed()) throw new RenderError("MODEL_INVALID", "Invalid UTF-16 input");
      return value;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    )
      return value;
    if (!value || typeof value !== "object" || active.has(value))
      throw new RenderError("MODEL_INVALID", "Expected acyclic JSON data");
    const array = Array.isArray(value);
    if (
      !array &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new RenderError("MODEL_INVALID", "Expected plain JSON object");
    const remaining = budget.limits.jsonNodes - budget.used.jsonNodes;
    if (array && value.length > remaining)
      throw new RenderError("RESOURCE_LIMIT", "JSON array exceeds budget before allocation");
    active.add(value);
    const output: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    let count = 0;
    // Enumerate incrementally instead of first allocating Object.keys for a huge object.
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (++count > remaining)
        throw new RenderError("RESOURCE_LIMIT", "JSON properties exceed budget");
      budget.reserve("stringUnits", key.length);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor))
        throw new RenderError("MODEL_INVALID", "Input accessors are forbidden");
      if (array && key !== String(count - 1))
        throw new RenderError("MODEL_INVALID", "Expected dense JSON array");
      Object.defineProperty(output, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    if (array && count !== value.length)
      throw new RenderError("MODEL_INVALID", "Sparse JSON arrays are forbidden");
    if (Object.getOwnPropertySymbols(value).length)
      throw new RenderError("MODEL_INVALID", "Symbol properties are forbidden");
    active.delete(value);
    return output;
  };
  return copy(input, 0) as T;
}

/** Prepay serialization/hash work for owned stage outputs without making another JSON copy. */
export function prepayCanonical(
  value: unknown,
  budget: RenderBudget,
  phase: DiagnosticPhase,
  copies = 1,
): void {
  const visit = (item: unknown, depth: number): void => {
    if (depth > 128) throw new RenderError("RESOURCE_LIMIT", "Generated JSON depth exceeded");
    budget.charge(phase, copies * (32 + (typeof item === "string" ? item.length * 6 : 0)));
    if (item && typeof item === "object")
      for (const key in item)
        if (Object.hasOwn(item, key)) {
          budget.charge(phase, copies * key.length * 6);
          visit((item as Record<string, unknown>)[key], depth + 1);
        }
  };
  visit(value, 0);
}
