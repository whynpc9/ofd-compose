# dotnet

.NET 10 侧解决方案（`OFDCompose.slnx`）。职责边界见 spec §2：契约、鉴权衔接、限额、隔离、固定图元写出；**不做度量与分页**。

- `src/OFDCompose.Api`：API / Job Host（HTTP 契约、排队、Worker 生命周期、幂等、日志脱敏）。
- `src/OFDCompose.OfdIrWriter`：OFD 固定图元写出（ofdrw.net 低层对象）。
- `src/OFDCompose.PdfIrWriter`：自研 PDF 1.7 写入器（ADR-0001 已拍板）。
- `src/OFDCompose.Containers`：OFD 容器源附件协议（WP0/WP1 子集）。
- `src/OFDCompose.ClientSdk`：.NET 调用 SDK。
- `tests/OFDCompose.SmokeTests`：xUnit v3 冒烟测试。
- `tools/`：离线工具（旧 DOCX 扫描器等）。

工程约定：`Directory.Build.props` 锁定 net10.0 + Nullable + TreatWarningsAsErrors + NuGet 锁文件；`Directory.Packages.props` 集中锁定包版本（CPM）；SDK 版本由仓库根 `global.json` 锁定。
