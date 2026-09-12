# tests/golden-corpus — Golden Corpus

评审人可见的固定结构语料库（issue 02）。**格式已冻结**，后续票以这些用例为验收输入；从 issue 04/05 起，文本/结构类用例已可执行（见「文本/结构类用例的执行」），其余用例 `result.status` 仍为 `not-executable`。

## 分层

- `library/`：库级基线 —— NDocxTemplater `DocxTemplateEngineTests` 的 15 个 `[Fact]` 与 examples 01–12 场景的逐条转录，固定提交 `9c02f26d0f81b554019441e348f981b67e11a4e7`。
  - `library/docx-tests/`：每个测试方法至少一个用例（条件块测试拆为 shown/hidden 两个变体）。
  - `library/examples/`：每个示例一个用例，含旧 `template.docx` 原件。
- `business/`：业务基线。**目前为空**——需要宿主提供脱敏的真实模板/数据/旧输出（见 `business/README.md`）。

## 用例目录结构

```
<case-dir>/
  case.json              manifest（schema: schemas/golden-corpus/case-manifest.schema.json）
  data.json              输入数据；manifest.dataDigest 记录其字节的 sha256
  template.txt           模板结构文本（测试方法用例）：逐段落/表格行列出标签原文
  template.docx          旧模板原件（示例用例）
  assets/                可选：图片等资产（如 chart.png）
  expected/semantics.json  预期语义（schema: schemas/golden-corpus/case-semantics.schema.json）
```

`template.txt` 约定：每行一个段落；表格用 `| cell | cell |` 行；`@table-begin` / `@table-end` 包围表格；被 Word 拆分的标签用连续 `<run>…</run>` 片段标注（如 `<run>{createdAt|for</run><run>mat:date:yyyy-MM-</run><run>dd}</run>`）。

## 预期语义的表达原则

- 叙述句**最终文本**、表格**行组内容与顺序**、条件块**显隐**、图片**尺寸与顺序**、条码**值与码制**；
- **不以 Word 分页或像素为预期**。旧测试的「含深色像素」条码断言已全部替换为解码值断言（`assertion: "decode-value"`），并在 manifest `notes` 标注「本版补建」。

## `allowedDifferences` 词汇表

| 值 | 含义 |
| --- | --- |
| `word-pagination` | 不继承 Word 的分页/断行结果 |
| `split-run-flattening` | 旧引擎把跨 run 标签的替换结果写入首个 run 并清空其余 run；新平台不保留该行为 |
| `pixel-assertion-rebuilt` | 旧断言为像素级（「含深色像素」），本版补建为解码值/结构断言 |
| `cwd-relative-path` | 旧示例用进程 CWD 解析相对图片路径；corpus 内已改为用例目录相对路径 |
| `invariant-culture-formatting` | 旧格式化固定 InvariantCulture；新平台由模板显式锁定 locale/时区/舍入 |

## 校验

`pnpm --filter @ofd-compose/golden-corpus test`：枚举全部用例，校验 manifest schema、语义 schema、`dataDigest` 与 data.json 字节一致、引用文件存在；并对 15 个测试方法与示例 01–12 的覆盖性做强断言。

## 文本/结构类用例的执行（issue 04 / 05）

`tests/corpus.dual.test.ts` 把 **文本/结构类** 用例（`template.txt` 由静态文本、行内 `{expr}`、控制块 `{#` `{/` `{?`、表格 `@table-begin` / `| a | b |` 及行组标记组成，不含图片/条码 `{%`）经 `src/corpus-template.ts` 转成原生 TemplateSource（`timeZone: UTC`，策略取 manifest `nativeProfile.bindingPolicyVersion`；循环 → RepeatBlock / RepeatRowGroup，序号退化键并显式标注 `orderDependentIdentity`；`{?}` → ConditionalBlock；`<run>` 标注抹平，对应 `allowedDifferences: split-run-flattening`），再经 `compile()` → `bind()` 得到 ResolvedDocument，并把顶层段落文本、表格单元格文本、`structure.conditionals` 的显隐投影成 `case-semantics@1` 的 `paragraphs` / `tables` / `conditionalBlocks` 与 `expected/semantics.json` 逐项比较，同时断言无 error/warning 级诊断。

- 用例清单在测试中固定（当前：测试方法用例 01、02-hidden、02-shown、03、04、05、06、07、08、15 共 10 个）；集合变化必须显式更新，避免用例被静默跳过。示例库（`examples/`）只有 `.docx` 没有 `template.txt`，媒体用例 09–14 含 `{%`，均留待后续票（受限导入器 issue 30、媒体 issue 11+）。
- 同一文件在 Node（`pnpm test`）与浏览器（`pnpm test:browser`，Playwright chromium）两种模式运行；语料经 `import.meta.glob` 读取，不依赖 `node:fs`。浏览器模式下 `document.runtime.tzdataVersion` 为 `null`（ICU 版本不可探测），Node 模式取 `process.versions.tz`。
- 通过的用例 manifest `result.status` 记为 `pass`（测试同时断言其余用例仍为 `not-executable`）。
- `src/corpus-template.ts` 是测试支持代码，不是受限导入器（issue 30）。

## 扫描产物：template.generated.docx 与 scan-reports/

旧 DOCX 扫描器（`dotnet/tools/OFDCompose.DocxScanner`，issue 03）的产物，**已入库**：

- `library/docx-tests/<case>/template.generated.docx`：由 `OFDCompose.CorpusDocxGenerator` 按 `template.txt` 约定生成（确定性字节，供扫描与后续受限导入器使用；**不进入任何 manifest**）。
- `scan-reports/library/<tier>/<case>/*.scan.json`：每个模板一份扫描报告（`ofd-compose/scan-report@1`）。
- `scan-reports/migration-report.json`：聚合迁移报告骨架（`ofd-compose/migration-report@0`）。

重新生成：`pnpm --filter @ofd-compose/golden-corpus run scan`（等价于依次运行 generator 与 scanner corpus 模式）。CI 会在生成后执行 `git diff --exit-code` 证明逐字节可复现；若本地模板或扫描器逻辑变更，需重新运行并提交产物。

