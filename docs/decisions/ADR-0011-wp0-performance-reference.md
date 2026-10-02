# ADR-0011：性能参考的取值口径

**状态：** Accepted — 仅接受固定实验作为性能参考；不设生产 SLO，不批准业务容量或原生 x64 性能。
**日期：** 2026-10-02
**证据：** [2026-09-28 完整审计](../audits/2026-09-28-runtime-reader-performance.md)；测量源码 `5ead51614a41ceb6b581f2a469b211508220b55b`，证据集随 `38aa0ade7a314891fd0a5e04152133956f2ad0a7` 固定，集成基线 `11e39873fc1bf4ec23cba636d3b535946c59c2ee`。本票没有重新测量，不能把数值写成当前文档提交下重跑。

## 决定与复现身份

采用既有分项 p50/p95 作为同条件回归参考，不据此选择更高资源 ceiling。Apple M4 Max，16逻辑CPU/128GiB，共享宿主、盘点时另有13容器，无独占CPU；Docker29.4.0 / OrbStack Linux arm64，2CPU配额、4GiB内存、256MiB tmpfs、network none、只读root。arm64 是原生架构 VM；x64 是 ARM 宿主仿真，绝非原生 x64 硬件基准。

Node24.19.0 / .NET与ASP.NET10.0.12；构建SDK10.0.302 不进入运行镜像。arm64 镜像 `sha256:cbc4ff91d0d70ff37ec1b66249d043ca9de645f467d9077c88828eedb88d1b25`；仿真x64 `sha256:e3eb3bc1fadf11f76914f42b6f62b47a287d6091fc35cc9112d155f71507e961`。完整 base/Node 锁见 [image-lock](../../tests/runtime-matrix/image-lock.json)，[source.json](../../tests/runtime-matrix/evidence/2026-09-28/source.json) 固定源码归档/lock/built JS；[输入归档](../../tests/runtime-matrix/evidence/2026-09-28/corpus-input-archive.json) 的解压字节 SHA-256 为 `4796ec9c30bceeeee22717486abce25fd01c9fc9fcd7c13d23150b23c2ee741a`。原字体/子集、WASM/profile/writer 摘要留在原始行。

每架构4case×(20 cold + 3丢弃warmup + 20hot)=172原始行，其中160测量样本；nearest-rank p50/p95。cold 重启 Node/CLR/module/JIT，不清OS页缓存；hot 保留进程和Node资源获取，但仍做所有权校验/布局/子集。单页/50页是一页一个短段落加分页符，1000行表为合成重复绑定输入；都不是实际业务性能。6000行是 bind 负向，不能计为成功吞吐。

## 数值与包含范围

单位均为毫秒，表内为 p50 / p95；所有 bind/shape/layout-exclusive/subset/OFD/PDF/resource/compile/identity 分布与逐行计时见 [arm64 performance](../../tests/runtime-matrix/evidence/2026-09-28/arm64/performance.json)、[仿真x64 performance](../../tests/runtime-matrix/evidence/2026-09-28/amd64/performance.json)，分项汇总表在上述完整审计中，未合并成无法区分的“render时间”。

| 样本 | arm64 cold total | arm64 hot total | 仿真x64 cold total | 仿真x64 hot total |
| --- | --- | --- | --- | --- |
| 1页 | 560.2 / 589.4 | 234.7 / 273.5 | 3319.2 / 3408.0 | 1623.8 / 1657.7 |
| 50页 | 964.0 / 1002.1 | 443.7 / 509.1 | 3874.7 / 3923.5 | 1896.7 / 2003.8 |
| 1000行/84页 | 3675.2 / 3758.5 | 2629.1 / 2821.9 | 8467.6 / 8635.4 | 5271.3 / 5353.6 |
| 6000行拒绝 | 311.4 / 341.1 | 141.6 / 148.2 | 1381.3 / 1405.7 | 587.7 / 600.6 |

total 包括资源获取、编译/绑定/媒体/整形/布局、一次子集、两次实际 writer、spool/普通缓冲文件I/O及cold启动。layout 分项扣除shape；both-writers 是逐样本加和后取百分位，不能把两个独立 p95 相加。**不包括** HTTP/排队/网络、源附件封装、fsync持久化保证；不能用来承诺 native-source 服务时延。Node/CLR峰值为各进程生命周期高水位，hot含warmup，不相加为同时峰值。

## 未完成项与影响

34case 双架构逐输入/结果一致（28正向各跑双writer + 6负向）提供确定性和实验运行证据。原生x64性能、宿主业务长表/50页及排队/API性能 **Not verified**。按 [既有 harness](../../tests/runtime-matrix/README.md) 在原生x64和固定脱敏业务输入上保留硬件/镜像/源码/输入身份、cold/hot分项和所有失败后再设SLO；不要求为了本文重复现有实验。issue20 不可从这些合成数字冻结业务容量承诺，WP1服务验收仍需对应数据。该 Accepted 仅是计量口径的工程决定，不解除 [总审计 No-Go](../audits/2026-10-02-wp0-go-no-go.md)。
