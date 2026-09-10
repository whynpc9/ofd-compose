# dotnet/tools

离线工具（不进生产链路）：

- `OFDCompose.DocxScanner/`：旧 DOCX 扫描器（issue 03）。命令：
  - `OFDCompose.DocxScanner scan <input.docx|dir> [--data data.json] [--out <dir>]` — 扫描单个 DOCX（或目录）并输出 `*.scan.json`（`ofd-compose/scan-report@1`：标签清单、数据路径、函数、格式模式、资源引用、控制块配对诊断、页眉页脚范围发现、风险与迁移状态）。
  - `OFDCompose.DocxScanner corpus <corpusRoot> [--out <dir>]`（默认 `<corpusRoot>/scan-reports`）— 扫描 `library/**` 下全部 `template.docx`/`template.generated.docx`（同目录 `data.json` 作为 sidecar），并输出聚合 `migration-report.json`（`ofd-compose/migration-report@0` 骨架）。
  - 两条诚实行为约定：扫描器**从不执行表达式语义**（仅做语法面盘点与 data.json 的纯路径查找），**从不打开/读取数据中出现的图片文件路径**（仅做形式分类）。
- `OFDCompose.CorpusDocxGenerator/`：语料 DOCX 生成器（issue 03）。`OFDCompose.CorpusDocxGenerator <corpusRoot>` 按 `tests/golden-corpus` 的 `template.txt` 约定生成确定性的 `template.generated.docx`（固定 docProps 时间戳与 zip 条目时间戳，字节可复现）。
- 受限导入器与 Legacy Reference Runner 随对应 issue 加入（见 `.scratch/first-release/issues/` 30、48 号相关票）。
