# 05: Binding Core 全部 P0 操作与结构展开

**What to build:** 模板可以使用 spec 中全部 P0 显示表达式与结构节点——ConditionalBlock、RepeatBlock、RepeatRowGroup、嵌套作用域、`sort/take/first/last/nth/at/count/if`、日期/百分比/千分比格式——绑定后得到语义正确的 ResolvedDocument；空数据、缺失、`null/0/false`、空数组、重复键都有明确结果；超预算返回诊断。corpus 全部文本/结构级用例通过，strict 与 legacy-compat 的差异表以测试形式落地。

**Blocked by:** 04 Document Model v0 + Template Compiler + Binding Core 首条叙述句

**Status:** ready-for-human

- [x] 结构节点：ConditionalBlock 在绑定阶段展开；RepeatBlock/RepeatRowGroup 实例身份 = 模板 nodeId + 重复键，键重复报错，序号退化键带标注；嵌套作用域支持当前项/父级/根
- [x] 操作：`sort:key:asc|desc`（以输入序号稳定 tie-break）、`take:N`、`first/last`、`nth:N`（1 起）、`at:index`（0 起、负数）、`count`、`if:t:f`（单分支 false 为空串）
- [x] 格式：`format:percent`、`format:permille`、`format:date:<pattern>`（含冒号时间模式）；locale/timezone 来自模板锁定配置，用 temporal-polyfill；tzdata 版本写入 provenance
- [x] legacy-compat：truthy 非数组循环一次、`count` 的旧对象/字符串/标量行为、路径 `[-1]` 与 `at:-1` 区分，全部有对照测试并产生 `LEGACY_SEMANTIC_CHANGE`
- [x] 预算：表达式长度、嵌套深度、展开节点数、排序次数上限，超限返回 `REPEAT_LIMIT`/`RESOURCE_LIMIT`
- [x] 不支持的 `sum/average/groupBy`、算术、脚本返回 `EXPRESSION_UNSUPPORTED`
- [x] 插入的字符串不再被扫描为模板标签（有用例）
- [x] corpus 库级基线中全部文本/结构用例在 ResolvedDocument 级通过，Node 与浏览器双模式

## Comments

**2026-09-12 (agent) 实现说明：**

- Document Model（`packages/document-model`）：`body` 递归化为 `BlockNode = Paragraph | Table | ConditionalBlock | RepeatBlock`（TypeBox `Type.Recursive`，JSON Schema 中以 `$id: "BlockNode"` / `$ref` 表达）；`Table.rows` 为 `TableRow | RepeatRowGroup`，单元格 `blocks` 复用 `BlockNode`。RepeatBlock / RepeatRowGroup 必须带 `repeatKey`：`{kind:"path", path}`（数据路径键）或 `{kind:"ordinal", orderDependentIdentity: true}`（序号退化键，字面量强制模板作者确认「重排数据会改变实例身份」，spec §4）。新增 `walkTemplateNodes()`（前序遍历，带结构深度）供校验器与编译器共用；`validateTemplateSource()` 对整棵树做 nodeId / bindingId（DynamicText 与结构绑定共享命名空间）/ controlId 唯一性与 styleId 引用检查。新增诊断码 `REPEAT_KEY_INVALID`。契约快照 `schemas/document-model/*.schema.json` 已重生成并通过 ajv 2020 编译门禁。
- Template Compiler：路径新增显式作用域语法 `^`（父级）、`^^`（祖父）、`^.name` / `^[0]`，`.` / 裸路径仍为当前项，`$` 为根（spec §6「表达式可显式选择作用域」；具体记号为本票判断）。`CompiledBinding` 按 `role` 区分 `dynamic-text` / `conditional-block` / `repeat-block` / `repeat-row-group`，后两者带编译后的 `repeatKey`。编译期预算 `CompileLimits`（默认表达式长度 1024、管道步骤 32、结构嵌套深度 16）超限 → `RESOURCE_LIMIT`（phase `compile`；深度超限只在越界容器上报一次）。`sum/average/groupBy`、算术、脚本形态仍 → `EXPRESSION_UNSUPPORTED`，结构节点上的表达式错误定位到结构节点的 nodeId / bindingId。
- Binding Core：`bind()` 在绑定阶段展开结构——ConditionalBlock 为假时整块消失；RepeatBlock / RepeatRowGroup 每个实例的子块被展平到父级序列，段落 / 表格 / 表格行带 `instancePath: RepeatInstance[]`（`{nodeId, bindingId, key, keyKind, ordinal, dataPath}`），`instanceIdentity()` 生成 `nodeId=key/...` 形式的实例身份。`document.structure = {conditionals, repeats}` 记录每次条件 / 重复求值（表达式、valueState、dataPath、实例数、是否截断）。作用域 `Scope {current, parent, root, dataPath}`：嵌套重复内的相对路径解析成绝对数据路径（如 `orders[1].lines[0].sku`），`^` 越过根 → `BINDING_MISSING`。重复键：路径键缺失 → `BINDING_MISSING`（实例仍以 `#i` 占位键生成），null / 非标量 / 重复 → `REPEAT_KEY_INVALID`（error，details.rule = null / non-scalar / duplicate，dataPath 指向冲突项）；序号键 `String(i)`。绑定预算 `BindBudgets`（默认实例 10 000、展开节点 200 000、排序 10 000 次）：实例 / 节点超限 → `REPEAT_LIMIT`（截断并在 `structure.repeats[].truncated` 标注），排序次数超限 → `RESOURCE_LIMIT`。`document.runtime = {temporalPolyfillVersion, tzdataSource: "runtime-icu", tzdataVersion}`：temporal-polyfill 1.0.4 使用运行时 ICU 的 tzdata，Node 下取 `process.versions.tz`（如 `2025c`），浏览器下为 `null`；可经 `BindingPolicy.runtime` 覆写（部署方从已知 ICU 版本注入）。该字段是非语义 provenance，不进入 LayoutIdentity。
- legacy-compat-1 新增规则（均产生 info 级 `LEGACY_SEMANTIC_CHANGE`，details.rule）：`repeat-non-array-once`（truthy 非数组循环一次）、`repeat-non-array-skipped`（falsy 非数组零次）、`negative-path-index`（路径 `[-1]` 越界为空，与 `at:-1` 区分）、`missing-as-null` 扩展到条件块 / 重复源；strict-1 下非数组重复源 → `EXPRESSION_UNSUPPORTED`（rule `repeat-non-array`）。`packages/binding-core/tests/legacy-compat-diff.test.ts` 以表格形式落地 strict 与 legacy 的全部 8 条差异规则（scope-fallback、string-truthiness、missing-as-null、count-non-array、repeat-non-array-once/-skipped、negative-path-index、boolean-text），并断言表覆盖 binder 能发出的全部规则。
- 插入文本中的 `{…}`、`{#…}`、`{?…}` 不会被再次扫描（重复实例内、条件块内均有用例）。
- corpus：`tests/golden-corpus/src/corpus-template.ts` 取代 `narrative-template.ts`，把 `template.txt` 的循环 / 条件块 / 表格 / 行组 /`<run>` 标注转成 TemplateSource（循环用序号退化键）；`tests/corpus.dual.test.ts` 把 ResolvedDocument 投影成 `case-semantics@1` 的 `paragraphs` / `tables` / `conditionalBlocks` 与预期逐项比较。可执行集合显式固定为 docx-tests 01、02-hidden、02-shown、03、04、05、06、07、08、15 共 10 个（manifest `result.status` → `pass`，Node 与浏览器双模式）；`examples/` 只有 `.docx` 无 `template.txt`，媒体用例 09–14 含 `{%`，保持 `not-executable`（受限导入器 issue 30、媒体 issue 11+）。
- 代码评审（code-reviewer 子代理）处理：(a) 重复实例与条件块求值本身也计入 `maxExpandedNodes`（此前纯结构嵌套 `repeat(repeat(cond))` 可绕过节点预算，300×300 项产生 9 万条 `structure.conditionals` 而无诊断），实例循环在耗尽后立即中断；(b) 预算在首个单元格前耗尽时整行丢弃，避免产出违反 `ResolvedTableRow.cells minItems 1` 的文档；(c) `BindingPolicy.budgets` / `CompileOptions.limits` 逐字段 `??` 合并，宿主转发的显式 `undefined` 不再关闭或反转预算；(d) 占位键 `#i` 也参与唯一性检查，合法键 `"#1"` 与占位键相撞报 `REPEAT_KEY_INVALID`（duplicate）。均有回归用例。
- PR #3 评审（Codex）处理：(a) P1 未受信任的深层嵌套：`validateTemplateSource()` 在递归的 TypeBox 校验之前先做**迭代**的深度预检（`findStructureDepthOverflow`，document-model），深度超过 `maxStructureDepth`（默认 `defaultMaxStructureDepth = 16`，编译器 `CompileLimits.maxStructureDepth` 与之共用并透传）的结构容器直接返回 `RESOURCE_LIMIT`（phase model），2 万层嵌套不再栈溢出；深度恰为预算值的容器仍由编译器逐个报告（phase compile）。(b) legacy-compat-1 下路径负下标 `xs[-1]` 现在得到 `valueState: "null"`（旧引擎结果）而不是 Missing，因而不再附带 `BINDING_MISSING` / `missing-as-null`，只保留 `negative-path-index`；strict-1 仍为 Missing + `BINDING_MISSING`。(c) 全文档节点预算在重复中途耗尽时，`structure.repeats[]` 记录改为实际展开的实例数并标注 `truncated`（RepeatBlock 与 RepeatRowGroup）。(d) `instanceIdentity()` 对 nodeId / key 中的 `=` `/` `\` 转义，`[{a,"b/c=d"}]` 与 `[{a,"b"},{c,"d"}]` 不再串成同一身份。(e) 示例库 01–05、07–10 补齐由 `template.docx` 正文转录的 `template.txt`（manifest 增加 `templateDescription`，保留 `templateAsset`），进入可执行集合并置 `pass`；测试断言其余 `not-executable` 用例全部是媒体用例（语义含 `media` / `barcodes`），没有文本/结构用例被静默留在集合之外。
- 测试规模：document-model 14、template-compiler 17、binding-core 122（bind 61 + structure 52 + 差异表 9）、golden-corpus 36（node）/ 22（browser）、gates 20；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`、`pnpm test:browser` 全绿。无新增依赖。
- 与 spec 的偏差与判断性补充（供人工确认）：
  1. 新增诊断码 `REPEAT_KEY_INVALID`（spec §12 未列；spec §4 只说「键重复报错」）。如需并入既有码位（例如 `BINDING_MISSING` 或 `MODEL_INVALID`）请回复。
  2. 父级作用域记号取 `^` / `^^`（spec §6 未规定具体语法）；`$` 为根、`.` 为当前项沿用 issue 04。
  3. ResolvedDocument 采用「展平 + instancePath」而不是保留嵌套结构：排版层（issue 06+）只需线性块序列，结构信息由 `document.structure` 与 `instancePath` 保留；对应 `resolved-document@0` 的 `structure`、`runtime` 为新增必填字段。
  4. Table v0 只有 `rows / cells / blocks`，无列宽、合并、边框等版式属性（留给表格排版票 issue 13 / 23）。
  5. tzdata 版本在浏览器不可探测（无 `process.versions.tz`，且 Core 禁用 `Intl`），因此 `runtime.tzdataVersion` 可为 `null`；生产环境应由宿主注入。
  6. `count` 在 strict-1 下的类型不匹配仍借用 `EXPRESSION_UNSUPPORTED`（issue 04 第 4 条），本票未改。
