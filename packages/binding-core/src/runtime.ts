import { Temporal } from "temporal-polyfill/implementation";

/**
 * 绑定运行期来源信息（spec §3：非语义 provenance，不进入 LayoutIdentity）。
 *
 * Temporal API 两端都固定使用 polyfill 实现（ADR-0001；见 `date.ts` 的 `temporal-polyfill/implementation` 入口），
 * 但 polyfill 不自带 tzdata：时区偏移表来自宿主运行时的 ICU（Node 的 `process.versions.tz`、浏览器不可探测）。
 * ADR-0001 要求把 tzdata 版本写入 provenance：Node 侧记录实际版本，浏览器侧记录 `null`（未知），
 * 由宿主在结果 manifest 中补充镜像/离线包声明的版本。**注入 `BindingPolicy.runtime` 只改变记录，不改变实际时区数据**；
 * 跨 ICU 版本的偏移一致性由 WP0.1b 的双端探针门禁保证，而不是由这条记录保证。
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

/**
 * 绑定使用的 Temporal 是否为 polyfill 实现而不是宿主原生实现（ADR-0001「始终用 polyfill」的可测断言）。
 * 在内建 Temporal 的运行时（Chromium）上，这要求 `date.ts` 不从包主入口 `temporal-polyfill` 导入——
 * 主入口在 `globalThis.Temporal` 存在时会改用原生实现。
 */
export function isPolyfillTemporal(): boolean {
  const native = (globalThis as { Temporal?: unknown }).Temporal;
  return Temporal !== native;
}
