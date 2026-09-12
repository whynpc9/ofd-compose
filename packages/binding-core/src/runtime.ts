/**
 * 绑定运行期来源信息（spec §3：非语义 provenance，不进入 LayoutIdentity）。
 *
 * temporal-polyfill 只提供 Temporal API；时区偏移表来自宿主运行时的 ICU（Node 的 `process.versions.tz`、
 * 浏览器不可探测）。ADR-0001 要求把 tzdata 版本写入 provenance：Node 侧记录实际版本，浏览器侧记录 `null`
 * 并由宿主在结果 manifest 中补充镜像/离线包声明的版本。
 */
export interface TemporalRuntime {
  /** 与 `packages/binding-core/package.json` 的依赖版本一致（有测试守护）。 */
  readonly temporalPolyfillVersion: string;
  /** 时区数据来源：运行时 ICU（polyfill 不自带 tzdata）。 */
  readonly tzdataSource: "runtime-icu";
  /** IANA tzdata 版本（如 `2025c`）；运行时不暴露时为 null。 */
  readonly tzdataVersion: string | null;
}

export const temporalPolyfillVersion = "1.0.4";

interface ProcessLike {
  readonly versions?: Readonly<Record<string, string | undefined>>;
}

/** 探测当前运行时的 tzdata 版本（Node：`process.versions.tz`；其他运行时：null）。 */
export function detectTemporalRuntime(): TemporalRuntime {
  const proc = (globalThis as { process?: ProcessLike }).process;
  const tz = proc?.versions?.tz;
  return {
    temporalPolyfillVersion,
    tzdataSource: "runtime-icu",
    tzdataVersion: typeof tz === "string" && tz.length > 0 ? tz : null,
  };
}
