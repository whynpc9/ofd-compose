# dotnet/tools

离线工具（不进生产链路）：

- `OFDCompose.DocxScanner/`：旧 DOCX 扫描器（issue 03）。命令：
  - `OFDCompose.DocxScanner scan <input.docx|dir> [--data data.json] [--out <dir>]` — 扫描单个 DOCX（或目录）并输出 `*.scan.json`（`ofd-compose/scan-report@1`：标签清单（含拆分标签的文本范围→样式映射 `runSpans`）、数据路径、函数、格式模式、资源引用、控制块配对诊断、sidecar 下 truthy 非数组循环（`NON_ARRAY_LOOP`）与旧 truthiness 条件（`LEGACY_TRUTHINESS`，含行内 `if`）的语义变化、页眉页脚范围发现、逐标签与模板级风险/迁移状态（标签级优先级 unsupported > needs-review > auto；模板含 unsupported 标签则整体 unsupported）。
  - `OFDCompose.DocxScanner corpus <corpusRoot> [--out <dir>]`（默认 `<corpusRoot>/scan-reports`）— 扫描 `library/**` 下全部 `template.docx`/`template.generated.docx`（同目录 `data.json` 作为 sidecar），并输出聚合 `migration-report.json`（`ofd-compose/migration-report@0` 骨架）。
  - 两条诚实行为约定：扫描器**从不执行表达式语义**（仅做语法面盘点与 data.json 的纯路径查找），**从不打开/读取数据中出现的图片文件路径**（仅做形式分类）。
  - 输入安全：解析前对 DOCX 归档强制大小/结构限制（压缩体积、条目数、单条目与总展开体积，声明值与实际解压双重校验，见 `DocxArchiveLimits`），超限或非 ZIP 直接报错。
- `OFDCompose.CorpusDocxGenerator/`：语料 DOCX 生成器（issue 03）。`OFDCompose.CorpusDocxGenerator <corpusRoot>` 按 `tests/golden-corpus` 的 `template.txt` 约定生成确定性的 `template.generated.docx`（固定 docProps 时间戳与 zip 条目时间戳，字节可复现）。
- 受限导入器与 Legacy Reference Runner 随对应 issue 加入（见 `.scratch/first-release/issues/` 30、48 号相关票）。
