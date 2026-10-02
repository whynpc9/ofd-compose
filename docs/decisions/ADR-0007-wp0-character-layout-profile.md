# ADR-0007：字符与版式的工程候选及业务准入

**状态：** Proposed — 已实现候选可重复，业务字符/功能交集未验收。
**日期：** 2026-10-02
**证据基线：** `11e39873fc1bf4ec23cba636d3b535946c59c2ee`；[WP0 审计](../audits/2026-10-02-wp0-go-no-go.md)。

## 实际字符统计

issue03 扫描的 28 份库级 DOCX（12 示例原件、16 生成测试样例）共 106 个标签，MigrationReport 为 23 auto / 5 needs-review。现有扫描报告没有全文字符频次字段；本次只读补充 [字符清单](../audits/evidence/2026-10-02-wp0/characters.json)，每份文件与原扫描报告 SHA-256 核对后，统计 `word/document.xml` 及 header/footer 的 `w:t` Unicode 码点。

| 范围 | 字符出现数 | 不同码点 | 候选范围外 |
| --- | --- | --- | --- |
| 正文，含模板标签语法 | 3789 | 169 | 0 |
| 静态 header/footer `w:t` | 0 | 0 | 0 |
| 宿主真实模板/数据及绑定后字符 | Not verified | Not verified | Not verified |

复现：`python3 tools/wp0-audit/character-inventory.py`，stdout 与上述 JSON 比较。它不执行表达式、不读取图片引用、不统计 XML tab/break 元素，不将标签字符当成最终打印字符；0 个页眉页脚字符不表示支持旧引擎动态页眉。动态数据、生成页码/列表标签和真实业务值需另作最终渲染输入检查。该库级统计不能批准业务全集，也不是字体覆盖测试。

保留已实现的 `wp0.4-p0-repertoire-v1` 候选：71850 码点，SHA-256 `98a2b1d874c03a894693db5a93f9d45eb759ac070899dbf5df9996dcf7a58e8b`。含 GB2312 全集、明确拉丁/组合符/汉字扩展与符号，精确范围以 [repertoire-data.ts](../../packages/typography-core/src/repertoire-data.ts) 为准。[assertP0Characters](../../packages/typography-core/src/repertoire.ts) 在整形前拒绝范围外字符；范围内仍可能 `GLYPH_MISSING`。emoji/任意 Unicode、系统字体回退并非承诺。换行/Tab 由 Layout 处理，不直接通过绘制字符准入。

## 可以沿用的实现，不能扩大的承诺

| 层 | 实际工程候选/来源 | 限制及后续动作 |
| --- | --- | --- |
| 绑定与结构 | [Binding Core](../../packages/binding-core/src/bind.ts)、[求值器](../../packages/binding-core/src/evaluate.ts)：路径、sort/take/取项/极值/get/count/if/声明格式，Conditional/Repeat/RepeatRowGroup | 版本化 strict/legacy 政策与显式预算；迁移仍逐节点差分确认，不是完整 DOCX 兼容 |
| 整形与断行 | [Typography](../../packages/typography-core/README.md)：harfbuzzjs 1.6.0 / HB14.3.0、fontkit2.0.4、linebreak4.0.3/Unicode17；完整段落候选断点 | 无系统字体/Intl 度量；静态真实字重/斜体；Typography 可单 run RTL，不等于 Layout 已支持双向段落 |
| 段落/分页 | [Layout Core](../../packages/layout-core/README.md) 09/10：LTR 脚本切分、禁则、cluster 安全重整形、对齐/缩进/Tab、段距、页眉页脚/页数域/水印 | 不做 emergency 单词拆分/连字断词；页数域最多4轮，超预算/溢出显式失败；多节能力存在不扩大首版 P0 范围 |
| 媒体/区域 | 同 README 12、[ADR-0003](ADR-0003-media-core-profile.md)：PNG/JPEG、code128/ean13、路径、固定/流式区域 | truncate/scale/min-font-size 必须显式且诊断；不把源隐藏字符串等同可见文字；其余六码制仍 issue27 |
| 表格/段落约束 | 同 README 13：合并、列宽/行高、共享边、重复表头、keepWithNext/widow/orphan、源映射 | 行不跨页拆分；跨行合并组整体移动，超大组失败；重复表头保持来源标记；控件输出几何不等于填写 UI |

09–13 与18的通过证据覆盖内核/合成数据，双 writer 可接受输入是上述能力与 [ADR-0008](ADR-0008-wp0-writer-profiles.md) 的**交集**。例如合法 Layout IR 的 glyphless 非空逻辑文本、阅读顺序与绘制顺序冲突，可能被 PDF profile 显式拒绝；不能从 IR 支持推导 PDF 放行。

## 冻结条件

保留当前字符版本与测试，不在本票扩大/收窄范围。由宿主提供脱敏首批模板、数据、旧输出（含长表/50页）并固定摘要；扫描静态字符，再实际绑定检查动态字符、所需字重/符号/条码/版式与双 writer 交集，逐差异确认。需要新范围时明确递增版本/摘要及共享基准，不用静默 fallback。未完成前，首版业务 profile **Not verified**，不以库级 169 个码点批准首批业务迁移或 issue20 全部契约冻结。
