# 04: Document Model v0 + Template Compiler + Binding Core 首条叙述句

**What to build:** 给定一个含 DynamicText 的段落模板与 JSON 数据，共享 TypeScript 内核编译并绑定出 ResolvedDocument，其中"营收最高的是 X，收入为 Y 元。"这类叙述句以行内片段形式出现、不产生多余换段；旧管道语法与结构化配置得到同一 AST；Missing 与 Null 分别表示；strict 与 legacy-compat 两种 truthiness 可切换；错误以节点级诊断返回。corpus 中叙述类用例的预期文本通过。

**Blocked by:** 01 仓库脚手架与工程门禁, 02 Golden corpus 骨架与库级基线转录

**Status:** ready-for-human

- [x] Document Model v0 的 TypeBox schema：信封（schemaVersion/documentId/revisionId）、样式表、正文树、段落行内序列（静态文本、DynamicText、InputControl）、`nodeId` 与 `bindingId`/`path` 分离、扩展命名空间；未知必需扩展被拒绝而非丢弃
- [x] Template Compiler 将旧管道语法（路径、`maxby/minby`、`get/pick`、`format:number`）与结构化配置编译为同一版本化 AST，并保留模板位置 ↔ 旧表达式 ↔ AST 节点映射
- [x] Binding Core 输出 ResolvedDocument：DynamicText 结果成为带来源映射的文本片段；`expressionLanguageVersion` 与 `bindingPolicyVersion` 写入产物
- [x] strict 策略：Missing/Null 分离、显式作用域；legacy-compat 策略：父级/根回溯、旧 truthiness（`"false"`/`"0"` 为真），且使用时产生 `LEGACY_SEMANTIC_CHANGE`
- [x] 数字格式化自实现声明的 .NET 模式子集，不用 `Intl`；金额走 decimal.js
- [x] 诊断包含 `code / severity / phase / nodeId / bindingId / dataPath / message`；`BINDING_MISSING`、`EXPRESSION_UNSUPPORTED`、`FORMAT_PATTERN_UNSUPPORTED` 有用例
- [x] corpus 叙述类用例在 ResolvedDocument 级通过；同一测试在 Node 与浏览器模式下通过

## Comments

**2026-09-10 (agent) 实现说明：**

- 链路：`TemplateSource` →`compile()`（`packages/template-compiler`）→ `CompiledTemplate`（`ofd-compose/compiled-template@0`）→`bind()`（`packages/binding-core`）→ `ResolvedDocument`（`ofd-compose/resolved-document@0`）。三个包均为 ESM、无 DOM/`Intl`（Biome overrides 与 `tests/gates` 的 core-lint 门禁已把 `document-model`、`template-compiler` 加入受限包集合）。
- Document Model v0（`packages/document-model`）：`TemplateSourceSchema`（`schemaVersion = "ofd-compose/document-model@0"`）含信封、`settings`（locale / IANA timeZone / bindingPolicyVersion）、`styles`、`body`（段落 + 行内 静态文本 / DynamicText / InputControl）、`extensions`（命名空间 → `{required, data}`）、`provenance`。`validateTemplateSource()` 在 TypeBox 校验（`MODEL_INVALID`）之上做 nodeId / bindingId / controlId 唯一性、styleId 引用、未知必需扩展 → `UNSUPPORTED_FEATURE` error（未知非必需扩展原样保留）。`nodeId` 与 `bindingId` 独立（允许相等但语义分离）。
- JSON Schema 契约：`schemas/document-model/template-source.schema.json`、`resolved-document.schema.json` 由 TypeBox 定义导出（`toJsonSchemaDocument`，2020-12）。入库文件由 `tests/gates/src/contract-schemas.test.ts` 用 `toMatchFileSnapshot` 保证与定义一致并可被 ajv 2020 编译；变更后 `pnpm --filter @ofd-compose/gate-tests test -- -u` 重生成。生成文件排除在 Biome 格式化之外。
- Template Compiler：`expressionLanguageVersion = "expr-1"`。旧管道解析器按 `DocxTemplateEngine.cs`（9c02f26d）的参数规则（`get`/`if`/`format` 用 `:` 重接参数、`sort` 方向大小写不敏感、`pick`→`get`、格式别名 numeric/percentage/per-mille/per_mille/datetime/time 规范化并记 `normalizations`）；结构化配置走同一 `StructuredStepSchema` 编译到同一 AST，测试证明两条路径 AST 深等价。来源映射 `ExpressionSourceMap`：`origin`（legacy/structured）、规范化后的 `legacyText`、每个 AST 步骤的字符 span。识别 spec §5 全部 P0 操作（sort/take/first/last/nth/at/maxby/minby/get/count/if/format），其它（`sum`、`groupBy`、算术等）→ `EXPRESSION_UNSUPPORTED`；路径属性名限制为不含空白与运算符字符（`a + b` 等直接判为不支持而不是当属性名）。
- 格式模式子集（`format-patterns.ts`）：数字模式支持前后缀字面、`#`/`0` 整数与小数位、`,` 分组、`%`/`‰` 缩放；拒绝分节 `;`、科学计数 `E0`、引号/转义、尾随 `,` 缩放、`#` 在 `0` 之后等，报 `FORMAT_PATTERN_UNSUPPORTED`。日期模式支持 `yyyy/yy/MM/M/dd/d/HH/H/mm/m/ss/s` 与字面分隔符；拒绝 `MMM`/`ddd`/`tt`/单字符标准格式等。percent/permille 沿用旧 `EnsureSuffixPattern` 语义（默认 `0.##%` / `0.##‰`）。
- Binding Core：`Scope {current, parent, root}`；strict-1 只查 current，缺失即 `BINDING_MISSING`（error）；legacy-compat-1 current → parents → root 回溯、命中非 current 时记 `LEGACY_SEMANTIC_CHANGE`（rule `scope-fallback`），缺失时 `BINDING_MISSING` 降为 warning 且输出空文本（旧引擎行为）。`MISSING` 哨兵与 JSON `null` 全程分离（`valueState: value | null | missing`）。truthiness：strict 把 `"false"`/`"0"`/空白字符串判假；legacy 任意非空白字符串为真，两者不一致时记 `LEGACY_SEMANTIC_CHANGE`（rule `string-truthiness`）；布尔转文本 `True/False` 记 `boolean-text`；`count` 用于非数组在 compat 下记 `count-non-array`。数字全部经 decimal.js（`ROUND_HALF_UP`，等价 .NET 默认 away-from-zero），日期经 temporal-polyfill 按模板 `timeZone` 取字段（`Z`/带偏移 → Instant → ZonedDateTime；无偏移按本地 PlainDateTime）。文本片段带 `origin {nodeId, bindingId, expression, dataPath, valueState}`，`dataPath` 经 sort/take/nth/at/maxby 等仍指向原始数据位置（如 `institutions[1].name`）；插入文本中的 `{…}` 不会被再次扫描。
- 诊断：统一 `Diagnostic {code, severity, phase: model|compile|bind, nodeId?, bindingId?, dataPath?, message, details?}`；`BINDING_MISSING`、`EXPRESSION_UNSUPPORTED`、`FORMAT_PATTERN_UNSUPPORTED` 均有直接用例。
- corpus：`tests/golden-corpus/src/narrative-template.ts` 把只含静态文本与行内 `{expr}` 的 `template.txt` 转为 TemplateSource（时区 UTC，策略取 manifest `nativeProfile`）；`tests/narrative-corpus.dual.test.ts` 用 `import.meta.glob` 读取语料，在 Node 与浏览器（Playwright chromium）两模式下运行，断言叙述类用例的段落文本等于 `expected/semantics.json` 的 `paragraphs`。叙述类集合显式固定为 01、06、07、08 四个用例（对应 basic tags / narrative aggregates / nth-at ranking / inline if + percent + permille），其 manifest `result.status` 置为 `pass`；其余用例保持 `not-executable` 并被测试断言。
- 测试规模：document-model 9、template-compiler 13、binding-core 54、golden-corpus 20（node）/ 6（browser）、gates 20；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`、`pnpm test:browser` 全绿。`pnpm check:licenses` 的 pnpm 侧手工核对：新增生产依赖 `@sinclair/typebox`、`decimal.js`、`temporal-polyfill`（MIT）及其传递依赖 `temporal-spec`（Apache-2.0）、`temporal-utils`（MIT）均在白名单；NuGet 侧因本机无 `global.json` 要求的 .NET SDK 版本带未能运行，由 CI 覆盖（.NET 侧无改动）。
- 与 ADR-0001 / spec 的偏差与判断性补充（供人工确认）：
  1. `temporal-polyfill` 采用 1.0.4（ADR 写的是 0.3.x）；1.x 为 Temporal 提案 Stage 3 稳定 API，许可不变。若需回到 0.3.x 需修改 `packages/binding-core/package.json`。
  2. 新增诊断码 `MODEL_INVALID`（spec §12 未列，用于 TypeBox 结构校验失败），并沿用 `UNSUPPORTED_FEATURE` 表示未知必需扩展。
  3. 日期 `format:date` 的字段化格式化从 issue 05 提前实现（corpus 叙述类用例不依赖它，但编译器需要在编译期校验日期模式）；tzdata 版本来源记录、预算与 `count` 在 strict 下的类型不匹配处理仍留给 issue 05。
  4. 旧路径语法中的属性名做了字符限制（见上），比旧引擎更严格；这是为了让不支持的运算表达式落到 `EXPRESSION_UNSUPPORTED` 而非静默当作缺失路径。
  5. 结构块（循环/条件/表格/图片）不在本票范围，`narrative-template.ts` 遇到控制块即判定非叙述类。
