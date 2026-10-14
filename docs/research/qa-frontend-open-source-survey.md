# 开源 NL-to-SQL 产品查询前端调研（WrenAI / DB-GPT / Vanna）

- 调研日期：2026-10-14
- 调研方法：仅依据一手来源——GitHub 仓库源码（raw.githubusercontent.com / api.github.com 逐文件阅读）与官方文档/官网；不采用博客二手转述。
- 目的：为 LingSight M1 科研问答页 v1 设计提供证据支撑，判断哪些 UI/UX 模式是行业共识、哪些是我们的差异化选择。
- 重要背景：**WrenAI 主分支已把对话式 BI UI 下线**，README 明言"早期的 chat-first BI 产品现为 Wren GenBI Classic，保留在 `legacy/v1` 分支，不再新增功能或修复"。其自建 UI 源码全部位于 `legacy/v1` 分支的 `wren-ui/`（Next.js + Apollo GraphQL，见该分支 README）。本调研对该分支逐文件阅读，这是与我们语义层借鉴对象最相关的 UI 证据。
- 引用格式：`wren-ui/...` 等路径均相对 `github.com/Canner/WrenAI` 的 `legacy/v1` 分支；`web/...` 相对 `github.com/eosphoros-ai/DB-GPT` 的 `main` 分支；`frontends/...` 相对 `github.com/vanna-ai/vanna` 的 `main` 分支。

---

## 1. WrenAI（legacy/v1 分支，wren-ui）

产品形态：语义层 + "Ask AI"问答式 BI。每个问题走一条独立管线（检索表 → 生成 SQL → 生成文本答案），问答按 thread 组织。

### 1.1 交互模型：多轮对话 thread，但每个问题独立成块

- 首页提问后创建 thread 并跳转：`wren-ui/src/pages/home/index.tsx` 中 `createThread({...})` 后 `router.push(Path.Home + '/' + threadId)`；页面路由为 `wren-ui/src/pages/home/[id].tsx`。thread URL 可寻址（隐含可分享/可收藏）。
- thread 内是问答块列表：`wren-ui/src/components/pages/home/promptThread/index.tsx` 渲染 `responses` 数组，每项一个 `AnswerResult`，块间 `Divider` 分隔；容器固定 768px 宽。
- 输入框：`wren-ui/src/components/pages/home/prompt/Input.tsx` —— TextArea + "Ask" 主按钮；Enter 提交、Shift+Enter 换行；处理中输入与按钮同置灰（`const isDisabled = innerLoading || isProcessing`）；提交后清空并回焦。
- 关键点：thread 内的追问在数据结构上是独立的 response（各自有 `askingTask`/`answerDetail`），并非把上下文拼进 prompt 的自由对话——thread 更像"带历史的问答流"而非聊天语义。追问时 ViewBlock 会把问题改写后传参（`AnswerResult.tsx` 中"rephrased for follow-ups"）。

### 1.2 结果呈现：三 Tab（Answer / View SQL / Chart-Beta）+ 行内数据预览

- `wren-ui/src/components/pages/home/promptThread/AnswerResult.tsx`：每个回答用 Ant Design 卡片式 Tabs 分三页：
  1. **Answer**（叙述性文本答案，`TextBasedAnswer.tsx`，Markdown 渲染）；
  2. **View SQL**（`ViewSQLTabContent.tsx`）；
  3. **Chart**，标注 `<Tag>Beta</Tag>`，且**懒生成**——仅当用户切到该 Tab 才调用 `onGenerateChartAnswer(id)`。
- 数据表：`wren-ui/src/components/dataPreview/PreviewDataContent.tsx` —— antd `Table`，**`pagination={false}`**（不分页），`scroll={{ y: 280, x: dynamicWidth }}` 固定高度纵向滚动，列全部 `ellipsis`，空态文案走 `locale.emptyText`。**无 CSV/下载按钮**（组件内无任何 download 逻辑）。
- 行数上限与披露：`ViewSQLTabContent.tsx` 明示 "Showing up to 500 rows"；`TextBasedAnswer.tsx` 说明 "we retrieve up to 500 rows of results to generate the answer"，并披露 `numRowsUsedInLLM`（送入 LLM 的行数）。
- 图表库：`wren-ui/src/components/chart/` 目录存在但未逐文件核实具体库 —— **未核实**。

### 1.3 SQL 透明度：独立 Tab 展示、可复制、可编辑重跑、有方言提示

- `ViewSQLTabContent.tsx`：SQL 用 `SQLCodeBlock` 渲染（语法高亮、行号、`maxHeight="300"`），`copyable`；复制 Wren SQL 时弹 toast 警告："You copied Wren SQL. This dialect is for the Wren Engine and may not run directly on your database."。
- **方言切换**：开关 "Show original SQL" 可在 Wren SQL（语义层方言）与数据库原生 SQL 之间切换。
- **编辑重跑**："Adjust SQL" 按钮打开 `wren-ui/src/components/modals/AdjustSQLModal.tsx`：SQL 编辑器（预填原 SQL）→ "Preview data"（先 `dryRun` + `limit:1` 校验，再跑最多 50 行预览）→ "Submit" 应用回原 response。SQL 非法时 Alert("Invalid SQL syntax") + `ErrorCollapse` 展开细节。
- **改动手脚留痕**：人工调整过的回答在 `AnswerResult.tsx` 顶部显示灰色横幅 "Adjusted answer" + 标签（"User-provided SQL applied" / "Reasoning steps adjusted"）。
- 另有失败 SQL 修复入口 `modals/FixSQLModal.tsx`（存在，未逐行核实内容）。

### 1.4 语义层信息的呈现：管线时间线 + 检索到的表 + 推理流

- `wren-ui/src/components/pages/home/preparation/PreparationSteps.tsx`：每个回答上方渲染三步时间线 **Retrieving（显示检索到的表，`tables={retrievedTables}`）→ Organizing（流式显示 `sqlGenerationReasoning`）→ Generating（含 `correcting` 自动纠错状态）**；活动步骤用 Ant Design `Badge status="processing"` 脉冲点。
- `TextBasedAnswer.tsx` 的 "Adjust the answer" 下拉让用户检查"检索到的表"与 SQL 推理；`modals/AdjustReasoningStepsModal.tsx` 允许调整推理步骤（即语义选择）。
- 沉淀语义：回答页脚 "Save to knowledge"（`modals/QuestionSQLPairModal.tsx`，存 Question-SQL 对帮助改进生成）与 `ViewBlock`/`modals/SaveAsViewModal.tsx`（把结果 SQL 存为视图复用）。
- 术语表（glossary）功能：`pages/knowledge/` 目录存在，但未逐文件核实 UI 形态 —— **未核实**。

### 1.5 错误与空结果

- 答案失败：`TextBasedAnswer.tsx` 整块替换为 `Alert type="error"`（`shortMessage` + `description`）。
- 空结果（查询成功但无行可用）：信息级提示引导查 SQL——"Click **View SQL** to review the step-by-step query logic and verify why the data is unavailable."。
- 预览空数据：`PreviewData` 空态 "Sorry, we couldn't find any records that match your search criteria."。
- 中断恢复：状态为 INTERRUPTED 时出现 "Regenerate" 按钮重跑（`TextBasedAnswer.tsx`）。
- 管线层还有 `preparation/ErrorBoundary.tsx`。

### 1.6 示例问题：恰好 3 条、可点、点击即填入并提交

- `wren-ui/src/components/pages/home/RecommendedQuestions.tsx`：`questions.slice(0, 3)`，生成中显示骨架屏（`RecommendedQuestionsTaskStatus.GENERATING`）；渲染为可点击 span（`cursor-pointer`），`onSelect({ question, sql })` 上抛；首页里点击即 `$prompt.current.submit(question)` 填入并提交。
- 示例数据集走 `prompt/DemoPrompt.tsx`，否则用 `RecommendedQuestionsPrompt.tsx`（带重试/生成状态，见 `pages/home/index.tsx`）。

### 1.7 历史与持久化

- 服务端 thread 列表在侧栏：`pages/home/index.tsx` 用 `useHomeSidebar()`，新建 thread 后 `homeSidebar.refetch()` 刷新。
- 每条 thread 有独立 URL（`/home/[id]`）。

### 1.8 延迟 UX：流式 + 阶段时间线 + 自动滚动

- 文本答案流式：`TextBasedAnswer.tsx` 中 `fetchAnswerStreamingTask(id)`，流式期间显示 `LoadingOutlined` 旋转图标 + 骨架遮罩。
- `promptThread/index.tsx`：答案未完成时平滑滚动到底、完成瞬间跳转；多于一屏自动滚到最新回答。

### 1.9 访问控制在前端的呈现

- 所读文件中未见权限相关 UI；WrenAI legacy 自部署版按项目/数据源隔离主要在建模侧 —— **未核实**。

---

## 2. DB-GPT（main 分支，web/）

产品形态：Chat 为主的 AI 数据助手，按 scene 切换能力（普通聊天、连库执行、仪表盘、知识库、Agent）。

### 2.1 交互模型：多轮聊天 + 场景（scene）切换 + 会话侧栏

- scene 是 URL 查询参数：`web/pages/chat/index.tsx` 中 `searchParams.get('scene')` / `get('id')`；出现过的 scene：`chat_normal`（默认）、`chat_with_db_execute`、`chat_dashboard`、`chat_agent`、`chat_knowledge`（见 `web/components/chat/mode-tab/index.tsx` 与 `web/components/chat/completion.tsx` 的分支）。
- 会话列表：`web/pages/chat/index.tsx` 渲染 `ChatSider`，数据来自 `getDialogueList()`，并加载历史 `getChatHistory(chatId)`，记住上次使用的模型。
- 输入：`web/components/chat/completion.tsx` 把输入委托给 `web/components/common/completion-input.tsx` —— Enter 提交、Shift+Enter 换行、空输入忽略、发送按钮 `loading` 状态；**无停止生成按钮、无清空会话按钮**（组件内不存在）。
- dashboard 场景分屏：`web/components/chat/chat-container.tsx` 中 `scene === 'chat_dashboard'` 时 3/4 宽图表面板 + 1/4 聊天栏。

### 2.2 结果呈现：Markdown + chart-view 三 Tab（Chart / SQL / Data）

- 消息渲染：`web/components/chat/chat-content/index.tsx` 用 GPTVis 渲染 Markdown（`formatMarkdownVal` 修正表格标签）；插件/工具结果以 `<dbgpt-view>` 嵌入块呈现，状态映射 `todo/runing/failed/completed`（蓝色加载/绿色完成/红色失败图标）。
- **chart-view 标签**（`web/components/chat/chat-content/config.tsx` + `chart-view.tsx`）：查询结果渲染为 Tabs——
  - `type === 'response_table'` 时只有 **[Data, SQL]** 且 Data 默认激活；
  - 否则 **[Chart, SQL, Data]** 且 Chart 默认第一；
  - Data = antd `Table`，`scroll={{ x: 'auto' }}`，列由首行 key 自动推导（未显式配置分页，落到 antd 默认分页）；
  - Chart = `AutoChart`（图表库 @antv/g2，见 `web/README.md` 依赖说明）。
- HTML 报表/代码执行产物有专门渲染器：`html-preview.tsx`、`vis-code.tsx`、`vis-dashboard.tsx` 等（`chat-content/` 目录清单）。

### 2.3 SQL 透明度：Tab 内只读高亮 + 复制

- SQL 在 chart-view 的 SQL Tab 中以 `CodePreview` 渲染并 `formatSql(sql, 'mysql')` 格式化（`chart-view.tsx`）。
- `web/components/chat/chat-content/code-preview.tsx`：SyntaxHighlighter 高亮、明暗主题、`maxHeight 400px` 滚动、**复制按钮**（成功提示"复制成功"）；**只读，无编辑/重跑**。
- 独立的 SQL 编辑器存在于 `web/components/chat/monaco-editor.tsx`、`db-editor.tsx`（dashboard 编辑器场景），非聊天流内。

### 2.4 语义/引用信息

- 检索到的关系以标签呈现：`chat-content/index.tsx` 解析上下文中的 `\trelations:` 渲染为蓝色 antd `Tag`。
- 知识引用：`config.tsx` 定义 `references` Markdown 组件（规整 `references`/`.knowledge` 数组）与 `summary`（"Document Summary" 头部）。
- 推理过程：`vis-thinking` 代码块渲染（`chat-container.tsx` 的 `parseVisThinking`），以及 `agent-plans.tsx`/`agent-messages.tsx`。

### 2.5 错误与空态

- 插件视图失败：`chat-content/index.tsx` 红色 Close 图标 + `err_msg`；另有 `vis-convert-error.tsx` 渲染器。
- 空会话首屏：`ChatDefault`（`web/components/chat/chat-default/`，未逐行核实内容 —— 部分未核实）。
- 查询成功但 0 行时的专门文案 —— **未核实**（未在所读文件中发现）。

### 2.6 示例问题

- `completion-input.tsx` 集成 `PromptBot` 向当前输入框追加提示词；首屏默认视图 `ChatDefault` 内容未核实。

### 2.7 历史与持久化

- `getChatHistory(chatId)` 拉取会话历史并恢复渲染（`chat-container.tsx`）；侧栏 `ChatSider` 列全部对话（`pages/chat/index.tsx`）。

### 2.8 延迟 UX：SSE 流式 + 乐观更新

- `chat-container.tsx`：发送时乐观追加空 assistant 条目，`chat()` 的 `onMessage` 按 `data?.incremental` 决定增量拼接或整体替换；完成时 `onDone`/`onClose` 解析图表数据。

### 2.9 访问控制

- 所读前端文件未见权限 UI —— **未核实**。

---

## 3. Vanna（main 分支 v2 重写版；仓库已归档 2026-03-29）

产品形态："最准确的 SQL Agent"（官网 vanna.ai），开源多轮对话 + 访问受控；v2 核心变化是"企业安全与用户级权限"（README）。**注意：题面提到的 FluxUI 在当前官网与仓库中均未出现**（官网与 `README_LEGACY.md` 全文检索无此词，Web 检索也无结果）——应为 vanna.ai 旧版托管 UI 的历史名称，现状**未核实**。旧版（README_LEGACY.md）以 `vn.ask("...")` 在 Notebook/Streamlit/Flask/Slack 中使用，返回顺序固定为 SQL → 表 → "automated Plotly chart"。

### 3.1 交互模型：嵌入式聊天 Web Component

- `frontends/webcomponent/src/components/vanna-chat.ts`（Lit）：`<vanna-chat>` 标签，script 引自 `img.vanna.ai/vanna-components.js`；pill 形输入框 + 圆形渐变发送钮，placeholder 默认 "Ask me anything..."，Enter 发送 / Shift+Enter 换行，空输入禁用发送；消息列表由 `ComponentManager` 按类型挂载富组件；空态 "Start a conversation"；支持 normal/maximized/minimized 窗口态与明暗主题。
- 聊天历史在组件内维护（`clearMessages()`、`scrollToLastMessage()`）；服务端持久化在 webcomponent 内**未核实**。

### 3.2 结果呈现：流式富组件（卡片/任务列表/进度条/Plotly/表格）

- 富组件体系：`rich-card.ts`（标题/副标题/状态徽标/可折叠/footer 动作按钮，动作可回注 `vanna-chat.sendMessage`）、`rich-task-list.ts`、`rich-progress-bar.ts`、`vanna-progress-tracker.ts`（侧栏进度追踪，`showProgress` 开启时）。
- 图表：`plotly-chart.ts` —— Plotly.js 全量 `newPlot`（hover 可用、响应式、隐藏 modebar；无增量更新路径）。
- 表格：`dataframe-component.stories.ts` 揭示 `DataFrameComponent` 支持 `searchable / sortable / exportable` 布尔开关与 `max_rows_displayed` 行数上限（50 行 + "pagination and search" 示例）——即搜索/排序/导出是**按需开启的 feature flag**而非默认。

### 3.3 SQL 透明度

- v2 README：SSE 流式渲染 "progress updates, SQL blocks, interactive tables, Plotly charts, and summaries"——SQL 块是流式产物之一。
- SQL 编辑器是**可选 UI 能力**：官方文档 vanna.ai/docs/placeholder/ui-features 列 `sql_editor` 为可注册的自定义 feature（该页自注为 LLM 生成的占位文档，采信度打折，以代码为准）。

### 3.4 语义层信息

- Vanna 无语义层：其方法是对 DDL/文档/历史 SQL 做 RAG 检索（README 主页与 README_LEGACY.md）。前端不呈现"用了哪些语义模型/口径"。

### 3.5 错误处理

- `vanna-chat.ts`：SSE 失败自动降级为轮询（warn "SSE streaming failed, falling back to polling"）；发送失败追加道歉消息 "Sorry, I encountered an error:" + 错误文本；error chunk 抛出并展示 `chunk.rich.data?.message`；连接失败状态条 "Connection failed / Unable to reach server"。

### 3.6 示例问题

- 无内置示例；加载时向后端发 `{ starter_ui_request: true }` 流式拉取"启动 UI"（失败静默忽略，视为可选能力）——`vanna-chat.ts`。

### 3.7 延迟 UX

- SSE 优先、WebSocket/轮询端点可配（`sse-endpoint`/`ws-endpoint`/`poll-endpoint` 属性）；每 chunk 发 `chunk-received` 事件驱动渐进渲染；进度条/任务列表组件随流更新。

### 3.8 访问控制在前端的呈现（本调研中最值得借鉴）

- Web Component "uses existing cookies/JWTs"（README）——复用宿主应用身份而非自带账号体系。
- **按用户组裁剪 UI 能力**：官方文档 ui-features 页给出 `UiFeatures(feature_group_access={...})`：内置可控项 `tool_names / tool_arguments / tool_error / tool_invocation_message_in_chat`，按组（admin/developer…）开放；自定义项示例 `export_data`、`sql_editor`、`charts`；原则是服务端过滤——"The UI receives only what the user is allowed to see"。（该文档页自注 AI 生成，方向与 v2 README 的"user-aware permissions"一致。）

---

## 4. 对比表

| 维度 | WrenAI (legacy/v1) | DB-GPT (main) | Vanna (main v2) | LingSight v1（已定） |
|---|---|---|---|---|
| 交互模型 | 多轮 thread，每问独立管线（`promptThread/`） | 多轮聊天 + scene 参数（`pages/chat/index.tsx`） | 嵌入式多轮聊天组件（`vanna-chat.ts`） | 单发问答、无聊天态 |
| 输入框 | TextArea+Ask，Enter 提交，处理中禁用（`prompt/Input.tsx`） | Enter 提交、Shift+Enter 换行、loading 钮（`completion-input.tsx`） | 同左 + 空输入禁用发送（`vanna-chat.ts`） | 输入框+提交 |
| 结果呈现 | 三 Tab：Answer/View SQL/Chart(Beta,懒加载)；表格无分页固定高滚动，500 行上限披露 | Markdown + chart-view Tab（Chart/SQL/Data，Data 默认为表格型结果首 Tab）；表格 antd 默认分页 | 流式富组件：卡片/表格(可搜索排序导出，flag 控制)/Plotly | 滚动卡片内结果表 |
| SQL 展示 | 独立 Tab、行号高亮、可复制、方言警告、方言切换、Adjust SQL 编辑+dry-run+应用、调整留痕横幅 | 独立 Tab、高亮、复制、只读 | 流内 SQL 块；编辑器为可选 flag | 折叠 SQL + 复制 + attempts/trace |
| 语义信息 | 管线三步时间线（检索到的表/推理流/纠错态）、numRowsUsedInLLM、调整来源横幅 | relations 标签、references 引用、vis-thinking 推理 | 无语义层；仅工具调用信息（可按组隐藏 tool_arguments） | 口径声明 + 数据来源行 |
| 错误处理 | Alert 短语+可展开细节；INTERRUPTED→Regenerate | 视图状态红标 + err_msg；vis-convert-error | 道歉消息 + 错误文本 + 状态条 + SSE 降级轮询 | 类型化拒绝横幅（403/400/502/504） |
| 空结果 | 成功通道：提示"点 View SQL 查为什么没数据"；预览空态文案 | 未核实 | 未核实 | 成功通道 + 建议文案 |
| 示例问题 | 恰好 3 条可点、点击即提交、生成中骨架屏（`RecommendedQuestions.tsx`） | PromptBot 注入提示词（细节未核实） | 后端 starter UI 可选拉取 | 3 条金标准示例问题可点 |
| 历史 | 服务端 thread 列表 + URL 可寻址 | 服务端会话历史 + 侧栏 | 组件内（服务端持久化未核实） | 仅会话内、客户端缓存 |
| 延迟 UX | 文本流式 + 阶段时间线 + 平滑自动滚动 | SSE 流式 + 乐观追加 | SSE 流式 + 进度条/任务列表 + 轮询降级 | 同步等待 + 已耗时秒数 |
| 导出/图表 | 预览无 CSV；Chart 为 Beta 懒加载 | 图表默认第一 Tab（@antv/g2） | 图表自动生成（Plotly）；导出为 flag | 均不做 |
| 前端权限呈现 | 未核实 | 未核实 | cookies/JWT 复用 + 按组 UI feature flag + 服务端过滤 | 403 类型化拒绝 |

---

## 5. 对 LingSight v1 的启示

逐项对照我们的既定设计。结论分四档：**保持**（证据支持）、**重新考虑**（证据与设计相抵且证据较强）、**现在就可低成本借鉴**、**推迟（附理由）**。

### 5.1 保持（设计得到证据支持）

1. **3 条可点金标准示例问题** —— 保持。WrenAI 与我们几乎逐字一致：`RecommendedQuestions.tsx` 取 `slice(0, 3)`、可点、点击后填入并提交、生成期间骨架屏。可直接照抄其交互（点击=填入+提交，而非仅填入）。
2. **结果表：固定高滚动 + 行数上限 + 截断披露** —— 保持。WrenAI 同款：`pagination={false}` + `scroll={{y:280}}` + "Showing up to 500 rows" 上限披露。我们的"截断标记 + 行数"数据来源行正是这个模式的科研强化版；WrenAI 的 `numRowsUsedInLLM`（告知多少行被送入 LLM 做总结）提示我们：若 v1 加一句总结文案，应披露所用行数。
3. **SQL 折叠展示 + 复制** —— 保持。三家都把 SQL 展示为"默认不抢焦点、需要时展开"的形态（WrenAI/DB-GPT 用 Tab，我们用折叠，等价）；复制是标配（DB-GPT "复制成功" toast；WrenAI 带**方言警告 toast**）。低成本借鉴：我们的复制 toast 若展示的是语义层渲染 SQL，应学 WrenAI 加一句方言提示。
4. **空结果走成功通道 + 建议文案** —— 保持。WrenAI 明确区分"查询成功但无数据"（信息级提示 + 引导看 SQL："Click View SQL to review the step-by-step query logic and verify why the data is unavailable."）与错误（Alert）。建议我们的空态文案加同款引导："展开 SQL 查看为何无数据"。
5. **错误短语 + 可展开细节** —— 保持。WrenAI Alert `shortMessage` + `ErrorCollapse` 双层结构 = 我们的"类型化横幅 + 折叠 trace"；且三家的用户可见错误文案都是"一句人话 + 详情可展开"，与我们 403/400/502/504 分类横幅兼容且更粗粒度——我们的做法不与任何一家冲突。
6. **不做 CSV 导出** —— 保持。WrenAI 预览组件内无任何下载逻辑；Vanna 把 `exportable` 做成默认关闭的 feature flag。导出不是此类产品的默认能力。
7. **单发（非聊天）交互** —— 保持，但注意证据形态。三家全部是聊天式，这是品类默认；但 WrenAI 的 thread 在数据结构上是"独立问题块序列"（各自 askingTask），追问靠问题改写而非隐式上下文。这说明显式单问与它们的正确性模型不矛盾；我们的单发是合理子集，且更契合"口径确认"的科研语义。不因"别家都做聊天"而改。
8. **客户端会话内历史** —— 保持（v1）。WrenAI/DB-GPT 都是服务端会话列表，但都依赖账号体系；我们在有用户体系前客户端缓存是合理降级。升级路径照 WrenAI：历史条目 URL 可寻址。

### 5.2 重新考虑（证据与设计相抵，但不足以推翻）

1. **同步等待 + 仅已耗时秒数** —— 部分重新考虑。三家无一例外都有流式或阶段化进度（WrenAI 三步时间线 + 流式答案；DB-GPT SSE 流式 + 乐观更新；Vanna SSE + 进度条/任务列表 + 轮询降级）。"30 秒白屏只有一个秒表"比三家都差。**证据不足以推翻同步管线**（流式需要管线改造），但足以要求：**现在就可低成本借鉴**——加阶段标签。我们已有 attempts/trace 数据，等待期轮询展示"第 N 次尝试 / 校验中 / 执行中"三两个阶段文案，即可达到 WrenAI PreparationSteps 的效果（其本质就是状态机驱动的三行时间线 + 脉冲点），成本一个轮询或后端在响应中带阶段字段。真正的 token 流式推迟。
2. **不做图表** —— 维持推迟，记录矛盾强度。三家全部自动生成图表（WrenAI Beta+懒加载；DB-GPT 非表格结果默认第一 Tab；Vanna 自动 Plotly）。这是品类最强的共识项，与我们的 v1 直接相抵。但：(a) WrenAI 自己都把 Chart 标 Beta 且不预生成；(b) 图表自动选轴/聚合在科研场景极易制造统计粒度错误（AGENTS.md 第 3 节红线：SQL 能运行不等于科研统计正确）。结论：推迟合理，但应在语义层 metric 类型明确后作为 v2 首选增强，而非长期不做。

### 5.3 现在就可低成本借鉴

1. **等待期阶段状态**（见 5.2-1）：WrenAI `PreparationSteps.tsx` 模式的最小复刻。
2. **复制 SQL 的方言提示 toast**（WrenAI `ViewSQLTabContent.tsx`）。
3. **空态引导看 SQL 的文案**（WrenAI `TextBasedAnswer.tsx`）。
4. **调整/产物留痕横幅**（WrenAI "Adjusted answer" 横幅）：v1 无人工改 SQL，暂不需要；但金标准问题若未来允许"标注正确/错误"，横幅式留痕是现成范式。
5. **Regenerate 重试按钮**（WrenAI INTERRUPTED→Regenerate）：我们的 502/504 拒绝横幅旁放一个"重试"按钮即等价，成本极低。
6. **"保存为金标准"入口**（WrenAI "Save to knowledge" 存 Question-SQL 对）：与我们"人工确认 SQL/期望数值构建回归集"的约束（AGENTS.md 第 3 节）天然契合——会话内历史已缓存答案，加一个"提交该问答入回归集"按钮即可让回归集从真实使用中生长。可作 v1.5 或 v2 早期项。

### 5.4 推迟（附理由）

1. **Token 级流式**（三家皆有）：需要管线改 SSE + 前端增量渲染；在同步管线 + 服务端重试的 v1 下性价比低。阶段标签先行。
2. **可编辑 SQL 并重跑**（仅 WrenAI 有完整实现：AdjustSQLModal 编辑→dryRun→预览→应用；DB-GPT 聊天内只读）：与我们"LLM 只提候选、服务端强制校验"的边界完全兼容（WrenAI 的 dry-run 校验模式甚至可作 v2 参照），但 v1 无用户体系且科研口径风险高，推迟。
3. **多轮聊天 / 追问改写**（三家皆有）：依赖会话服务端状态与问题改写质量，推迟；v1 单发已覆盖核心查询价值。
4. **服务端历史与分享 URL**（WrenAI/DB-GPT）：依赖用户体系，推迟。
5. **按组 UI 能力裁剪**（Vanna UiFeatures）：方向与我们"实验访问控制 + 服务端强制"一致——其原则"The UI receives only what the user is allowed to see"（服务端过滤、前端只呈现）恰好是我们 403 设计的理论依据；等权限分组落地再做 UI 层开关。
6. **图表**（见 5.2-2）。

### 5.5 无法核实项汇总（不做猜测）

- WrenAI 图表具体使用的前端库（`components/chart/` 未逐文件核实）。
- WrenAI glossary/知识库页面的 UI 形态（`pages/knowledge/` 未读）。
- WrenAI `FixSQLModal.tsx` 内部细节。
- DB-GPT `ChatDefault` 首屏内容、PromptBot 具体示例问题、查询 0 行的专门文案。
- Vanna FluxUI（当前官网/仓库均无此词，疑为旧托管 UI 名称）。
- Vanna webcomponent 的服务端历史持久化。
- 三家 UI 中的权限呈现（除 Vanna 外均未核实）。

### 5.6 来源索引（主要）

- WrenAI legacy/v1：`wren-ui/src/pages/home/index.tsx`、`wren-ui/src/pages/home/[id].tsx`、`wren-ui/src/components/pages/home/prompt/Input.tsx`、`.../prompt/DemoPrompt.tsx`、`.../home/RecommendedQuestions.tsx`、`.../home/promptThread/{index,AnswerResult,TextBasedAnswer,ChartAnswer,ViewSQLTabContent,ViewBlock}.tsx`、`.../home/preparation/{PreparationSteps,PreparationStatus,ErrorBoundary}.tsx`、`wren-ui/src/components/modals/{AdjustSQLModal,FixSQLModal,QuestionSQLPairModal,SaveAsViewModal,AdjustReasoningStepsModal}.tsx`、`wren-ui/src/components/dataPreview/PreviewDataContent.tsx`、`wren-ui/src/components/code/`（SQLCodeBlock 引用）。主分支归档说明见 `github.com/Canner/WrenAI` README。
- DB-GPT main：`web/pages/chat/index.tsx`、`web/components/chat/{chat-container,completion}.tsx`、`web/components/common/completion-input.tsx`、`web/components/chat/chat-content/{index,config,chart-view,code-preview}.tsx`、`web/components/chat/mode-tab/index.tsx`、`web/README.md`。
- Vanna main：`frontends/webcomponent/src/components/{vanna-chat,vanna-message,rich-card,plotly-chart,dataframe-component.stories}.ts`、`README.md`、`README_LEGACY.md`、官方文档 `vanna.ai/docs/placeholder/web-ui` 与 `vanna.ai/docs/placeholder/ui-features`（两页均自注为 AI 生成占位文档，已降权采信）。
