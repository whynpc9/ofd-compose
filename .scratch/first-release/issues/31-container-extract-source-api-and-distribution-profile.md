# 31: 容器源提取 API 与分发 profile

**What to build:** 宿主调用 `POST /v1/containers/extract-source` 提交 OFD，得到源模型、资源、版本、完整性与信任状态（WP1 中信任状态为"未签/未验证"），不执行任何内容；渲染时可选择非回编辑分发 profile，产物不带编辑源并在 manifest 中声明为派生物；源最小化政策有测试保证。

**Blocked by:** 17 源附件协议与回编辑 round-trip, 21 .NET API + Job Host

**Status:** ready-for-agent

- [ ] `extract-source` 接口：按校验顺序返回分层状态；伪造/篡改/缺资源/版本不兼容分别可辨识（`IR_VERSION_UNSUPPORTED` 等）
- [ ] 渲染请求可选 `distribution` profile：无编辑源、manifest 声明派生物；可回编辑 profile 为默认
- [ ] 源最小化测试：ResolvedDocument 无未使用数据、无任意路径、无凭证
- [ ] 提取结果可直接送入定稿/工作台加载（round-trip 经 API）
- [ ] ZIP/JSON 大小限制在提取路径生效
