import type { DiagnosticPhase } from "./diagnostics.js";
/** One job-owned meter. Stage APIs never create or reset this meter. */
export interface JobContext {
  /** Optional host observation; clocks and timings never enter document identity. */
  observe?(
    stage: "resources" | "compile" | "bind" | "media" | "layout" | "shape" | "subset" | "identity",
    edge: "start" | "end",
  ): void;
  readonly captureSource?: boolean;
  charge(phase: DiagnosticPhase, units: number): void;
}
