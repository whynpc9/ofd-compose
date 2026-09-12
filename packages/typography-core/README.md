# Typography Core

Issue [06](../../.scratch/first-release/issues/06-typography-core.md) / WP0.4.
Node 24 和浏览器共享 HarfBuzz WASM、fontkit 度量与 Unicode 17 UAX #14 数据。

```ts
import { TypographyCore } from "@ofd-compose/typography-core";

const core = new TypographyCore();
// bytes 由宿主提前加载，sha256 来自发布的资源锁；内核不读文件、不联网。
const metrics = core.loadFont(bytes, sha256);
const run = core.shape({
  fontSha256: metrics.sha256,
  text: "中文𠮷",
  direction: "ltr",
  language: "zh-Hans",
  script: "Hani",
});
```

## 契约

- 字体身份为完整文件 SHA-256；仅接收单 face、静态 OTF/CFF 或 TTF。集合、可变字体、WOFF 在此阶段显式拒绝。返回的 `head`、`hhea`、`os2`、`name` 来自 fontkit；它不参与 cmap/glyph 选择或 shaping。
- `shape` 接收已经确定方向、script、language、字体的一个 run。双向段落解析、混合 script 的 run 切分、中文禁则定制、实际断行与分页由后续 Layout Core 完成。调用方在字体就绪后调用；加载顺序不会决定选字。
- glyph ID、advance、offset、flags、cluster 全部来自 HarfBuzz。位置单位是未缩放的字体设计单位，x 向右、y 向上，`x/y` 含累计 advance 和当前 offset。`advance` 是整段度量；字号换算与坐标量化由 Layout Core 完成。
- cluster 和断点统一用原文 UTF-16 下标。`[cluster, clusterEnd)` 可被多个字形共享，包含连字、组合字符和代理对；RTL 字形按 HarfBuzz 视觉顺序输出，区间仍指向逻辑原文。
- `lineBreakOpportunities(text)` 和 `shape().breaks` 返回 UAX #14 候选断点及 `required`；候选并不等于已选中的分页/换行位置。Layout Core 还需结合 cluster/unsafe-to-break flags 在断行处重整形。
- `features` 是全 run 的 OpenType tag→非负整数值，按 tag 排序传给 HarfBuzz。
- `style` 省略时使用锁定文件的真实样式；指定时精确比对 OS/2 字重与斜体标记。禁止合成粗体/斜体。中文主字体无真实斜体，不能用拉丁斜体偷偷补中文。
- `shape` 在 HarfBuzz 前强制检查 `p0CharacterRepertoire`，超范围返回 `CHARACTER_OUT_OF_PROFILE`，`clusters` 附原文 UTF-16 字符起点。字体有字形也不能绕过。范围身份随 `shapingAndLineBreakVersions.repertoire` 输出。
- 未加载摘要为 `FONT_MISSING`，摘要不符为 `FONT_DIGEST_MISMATCH`，缺字为 `GLYPH_MISSING`（附 UTF-16 cluster），样式不符为 `FONT_STYLE_UNAVAILABLE`。不会搜索其他已加载字体或系统字体。
- 单字体上限 32 MiB，每个实例累计 128 MiB，单次文本 100000 个 UTF-16 单元。拒绝不完整代理对。宿主仍负责隔离 Worker、执行超时和进程内存预算。

## WP0.4 字符范围

冻结候选 `wp0.4-p0-repertoire-v1`：GB 2312 的 7445 个字符全集（包含其中希腊/西里尔/假名/注音/符号）、ASCII 可打印字符、U+00A0–024F 拉丁区、U+0300–036F 组合附加符、U+1E00–1EFF 拉丁扩展、U+3400–4DBF / U+4E00–9FFF / U+20000–2A6DF 汉字区（含 GBK 汉字扩展）、另列 € U+20AC 和数学减号 U+2212。共 71850 个允许码点，按排序后 uint32 big-endian 列表计算 SHA-256。允许范围与选定字体实际覆盖是两个检查；范围内缺字仍报 `GLYPH_MISSING`。

源表在 [repertoire-data.ts](src/repertoire-data.ts)，[生成脚本](tools/update-repertoire.py) 使用 Python `gb2312` 映射并验证 7445 个字符；发布运行时仅消费已入库数值表，不依赖系统 codec 或 ICU。首批业务语料是否需要其他符号、收窄范围及最终首版 profile 的批准留给 issue 19；任何调整必须更新范围版本、摘要和共享基准。

换行、制表符、段落分隔符由 Layout Core 在调用 `shape` 前拆分/处理，不是待绘制字符。独立 `lineBreakOpportunities` 是通用 UAX #14 工具，保留换行/CRLF 等控制字符的断点语义，不承担字符准入。

## 固定资源和 WASM

完整字体与 OFL 文本位于 [fonts](fonts/manifest.json)，清单记录上游精确提交、文件大小、字体与许可 SHA-256。包含 Noto Sans CJK SC Regular/Bold（CFF）、LXGW WenKai Regular（中文 TrueType 备选）、Noto Sans Italic/BoldItalic（真实拉丁斜体）。没有对字体做子集化；阅读器 CFF/TTF 互操作仍属于 WP0.9。

`shapingAndLineBreakVersions` 暴露 harfbuzzjs 1.6.0、实际 HarfBuzz 14.3.0、WASM SHA-256、Unicode 17.0.0、linebreak 4.0.3 和 fontkit 2.0.4。包及传递依赖由 pnpm 锁文件固定；Node 测试独立校验安装的 WASM 摘要。

核查上游 [v1.6.0 Makefile](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.0/Makefile) 与 [config-override.h](https://github.com/harfbuzz/harfbuzzjs/blob/v1.6.0/config-override.h)：确实使用 `-DHB_TINY`，但 override 恢复了 CFF、name、metrics、collect-unicodes 等功能。此 issue 所需 UTF-16 buffer、direction/script/language、features、glyph infos/positions、cluster API 在 CFF/TTF 真实字体上均可用，无需自建 WASM。HarfBuzz [内嵌 Unicode 数据](https://github.com/harfbuzz/harfbuzz/blob/4de187dd0a915d13c976fa8bd474c084229f3aab/src/hb-ucd-table.hh) 为 17.0.0。

1.6.0 JS 包未公开手动 `destroy/dispose`，使用 `FinalizationRegistry` 管理 native 生命周期。实例复用 buffer，按摘要缓存字体；不要每段文字创建一个实例。最终资源回收与硬性预算由隔离 Worker 的生命周期保证。子集能力不在本次验收范围内；实际 npm 文件名是 `harfbuzz-subset.wasm`，并非早期 ADR 表格的 `hb-subset.wasm`。

浏览器打包需要保留 WASM 资产：Vite 配置 `optimizeDeps.exclude: ["harfbuzzjs"]`，让 Emscripten 通过 `new URL("harfbuzz.wasm", import.meta.url)` 加载同包字节。部署时随离线包分发，不能指向可变 CDN 文件。参见 [browser config](vitest.browser.config.ts)。

## 验证

`pnpm --filter @ofd-compose/typography-core test` 与 `test:browser` 执行同一 `typography.dual.test.ts`。两端每个完整结果序列化为 UTF-8 字节后与同一个 [expected.json](tests/expected.json) 比较，涵盖中文扩展 A/B、拉丁、数字、符号、组合字符、真实粗斜体、连字开关、竖排、RTL 与空串；另有缺字、同名不同字节、调用方缓冲区修改、UAX #14 和错误输入断言。

基准初始值由锁定依赖的 Node 实现生成，属于回归与跨端一致性证据；cluster、mark offset、断点、样式和错误还用独立断言验证。它不代表所有 Unicode 官方用例或所有浏览器均已验收。需要更新时先 `pnpm --filter @ofd-compose/typography-core build`，再显式执行 `node packages/typography-core/tools/update-fixtures.mjs` 并审查差异；普通测试不会改写基准。
