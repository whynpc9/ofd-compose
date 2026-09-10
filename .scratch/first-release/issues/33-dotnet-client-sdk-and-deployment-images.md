# 33: .NET 调用 SDK 与部署镜像

**What to build:** UniDmrCore 这样的宿主用 `OfdCompose.Client`（或最小调用示例）提交渲染并处理结果 manifest 与诊断，不接触引擎私有 API；运维用多架构容器镜像（不含 Word/LibreOffice/Chromium/JVM）部署 API + Worker，并可在无外网环境配置字体包与 wasm/tzdata 离线分发。

**Blocked by:** 21 .NET API + Job Host

**Status:** ready-for-agent

- [ ] .NET 客户端：能力发现、校验、渲染、定稿、源提取的强类型调用；由 OpenAPI 生成或手写并有契约测试
- [ ] 最小调用示例项目：模板 + 数据 → OFD/PDF 落盘，打印诊断
- [ ] 镜像：linux/amd64 与 linux/arm64；镜像内无浏览器/办公软件；镜像 SBOM
- [ ] 无外网模式：字体包、wasm、tzdata 以卷或离线包挂载；缺失时启动即失败并说明
- [ ] 资源预算、池大小、超时通过配置暴露；健康检查端点
- [ ] 部署 README（启动、配置、诊断码速查）
