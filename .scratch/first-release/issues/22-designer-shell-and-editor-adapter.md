# 22: 工作台壳 + Editor Adapter

**What to build:** 模板作者打开 React + Vite 的设计工作台，新建或打开模板文件，在 canvas-editor 1.0.2 提供的编辑界面中编辑段落与文本样式，保存回自有 Document Model 文件；自有模型与 canvas-editor 私有模型经 Editor Adapter 按显式支持清单双向转换且 round-trip 无损；宿主可通过存取适配接口替换文件打开/保存。

**Blocked by:** 07 canvas-editor 隔离 spike（决定 Editor Adapter 接法）, 20 v1 契约冻结

**Status:** ready-for-agent

- [ ] React 应用壳：文件打开/保存、宿主存取适配接口（默认实现为浏览器文件）
- [ ] Editor Adapter 按 07 选定接法接入 canvas-editor 1.0.2（锁定版本）；宿主不接触其私有 API
- [ ] 支持清单 v1：段落、标题、列表、文本样式（字号/字重/斜体/下划线/删除线/上下标/颜色/高亮/链接）；未支持节点在加载时保留不丢失
- [ ] 双向转换测试：自有模型 → 编辑器 → 自有模型 round-trip 无损；`nodeId` 稳定
- [ ] 撤销/重做、格式刷、查找替换在支持清单范围内工作
- [ ] 中文输入法组合输入基本用例（Playwright）
- [ ] 设计/只读模式切换不产生未记录的内容转换
