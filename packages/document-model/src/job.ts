import type { DiagnosticPhase } from "./diagnostics.js";
/** One job-owned meter. Stage APIs never create or reset this meter. */
export interface JobContext {
  charge(phase: DiagnosticPhase, units: number): void;
}
