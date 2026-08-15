# 核心链路实现计划（任务1→2→9）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 打通 AI 工作台核心链路：Workflow 引擎 → 完整 AI 执行链路 → 链路记录与双向反馈

**Architecture:** 三阶段顺次实现：① Workflow 引擎（数据模型 + 执行引擎 + CRUD 路由）→ ② 重写 chat.js 接入意图识别 + Workflow 路由 + RAG + Prompt 分层组装 → ③ 增强 retrieval-snapshot 全链路记录 + 双向反馈（优秀问答→案例库、AI 生成→知识库回流）

**Tech Stack:** Node.js + Express + JSON 文件存储（lib/store.js）+ TF-IDF 向量检索（lib/vector-store.js）

**Spec:** 
- docs/差距分析与重构方案.md（任务 1/2/9 描述）
- 主人的需求文档/企业研发AI辅助平台_任务执行全流程_文字版.md
- 主人的需求文档/补充说明文档2.md
- 现有的 lib/qa-store.js, lib/prompt-engine.js, lib/retrieval-snapshot.js, lib/rag-engine.js

## 全局约束

- 所有 JSON 数据存于 `data/` 目录，通过 `lib/store.js` 读写
- 新文件必须放在 `lib/` 或 `routes/` 下
- 修改 `server.js` 路由注册行时只加不删
- 测试用 `node --test "test/**/*.test.js"` 运行
- 全部使用现有技术栈，不引入新依赖
- 模拟模式（mock）下不连真实 LLM，用 engine 内的 mock 方法生成结果

---

### 任务 1a: Workflow 数据模型与种子数据

**Files:**
- Create: `lib/workflow-engine.js`（数据模型 + CRUD + 种子数据 + 执行引擎）

**Interfaces:**
- Produces: Workflow CRUD 函数（listWorkflows, getWorkflow, createWorkflow, updateWorkflow, deleteWorkflow）+ 种子数据 4 个 Workflow

- [ ] **Step 1: 定义 Workflow 数据模型**

Workflow 数据模型：
```javascript
{
  id: "wf_prd",           // 唯一标识
  name: "PRD 生成 Workflow",  // 名称
  description: "...",     // 描述
  role: "product",        // 适用角色
  status: "published",    // draft / published / disabled
  nodes: [                // 节点数组（有序）
    {
      id: "node_1",
      type: "intent",     // 节点类型: intent / skill / rag / reference / prompt / llm / qc / output
      name: "意图识别",
      config: { /* 节点配置 */ },
      next: ["node_2"],   // 后续节点 ID 列表
      condition: null,    // 条件分支 { field, operator, value, next }
    },
    // ...
  ],
  entryNode: "node_1",    // 入口节点 ID
  createdAt: "...",
  updatedAt: "...",
}
```

节点类型枚举：
- `intent` — 意图识别（解析用户输入，输出结构化意图）
- `skill` — 调用 Skill 能力（如需求分析、PRD 生成）
- `rag` — 知识检索（RAG 检索）
- `reference` — 获取参考资料（模板/规范/案例）
- `prompt` — Prompt 组装
- `llm` — 调用大模型生成
- `qc` — 质量检查
- `output` — 输出结果

- [ ] **Step 2: 定义种子数据（4 个 Workflow）**

4 个种子 Workflow（对应 4 个角色）：
1. `wf_prd` — PRD 生成 Workflow（product 角色）：intent → skill(需求分析) → rag → reference → skill(PRD生成) → prompt → llm → qc → output
2. `wf_test` — 测试用例生成 Workflow（test 角色）：intent → skill(测试分析) → rag → reference → skill(用例生成) → prompt → llm → qc → output
3. `wf_fe` — 组件设计 Workflow（frontend 角色）：intent → skill(组件分析) → rag → reference → skill(组件设计) → prompt → llm → qc → output
4. `wf_cs` — 客服应答 Workflow（cs 角色）：intent → skill(问题识别) → rag → reference → skill(应答生成) → prompt → llm → qc → output

- [ ] **Step 3: 实现 seedIfEmpty + listWorkflows + getWorkflow**

```javascript
function seedIfEmpty() { /* 写入 4 个种子 Workflow */ }
function listWorkflows() { /* 读 data/workflows.json */ }
function getWorkflow(id) { /* 按 id 查 */ }
```

- [ ] **Step 4: 实现 createWorkflow + updateWorkflow + deleteWorkflow**

```javascript
function createWorkflow(input) { /* 创建新 Workflow */ }
function updateWorkflow(id, patch) { /* 更新 Workflow */ }
function deleteWorkflow(id) { /* 删除 */ }
```

- [ ] **Step 5: 实现 intentClassification（模拟意图识别）**

```javascript
function classifyIntent(userQuestion, role) {
  // 基于关键词匹配的模拟意图识别
  // 输出: { taskType, confidence, role, entities, workflowId }
  // 匹配规则: 按关键词匹配对应 Workflow
}
```

- [ ] **Step 6: 实现 executeWorkflow（核心执行引擎）**

```javascript
function executeWorkflow(workflowId, params) {
  // 1. 加载 Workflow 定义
  // 2. 从 entryNode 开始，按序执行每个节点
  // 3. 每个节点根据 type 执行不同逻辑：
  //    - intent: 跳过（已在外层完成）
  //    - skill: 调用 skill 处理逻辑
  //    - rag: 调用 rag-engine.retrieve
  //    - reference: 收集 Reference
  //    - prompt: 调用 prompt-engine.assemblePrompt
  //    - llm: 生成 mock 结果
  //    - qc: 质量检查
  //    - output: 输出
  // 4. 返回执行结果 + 完整链路日志
}
```

- [ ] **Step 7: 实现 executeNode 单节点执行**

```javascript
function executeNode(node, context, user) {
  switch(node.type) {
    case 'skill': /* 执行 skill 逻辑 */ break;
    case 'rag': /* 执行 RAG 检索 */ break;
    case 'reference': /* 收集 Reference */ break;
    case 'prompt': /* 组装 Prompt */ break;
    case 'llm': /* 生成结果 */ break;
    case 'qc': /* 质量检查 */ break;
    case 'output': /* 输出 */ break;
  }
}
```


### 任务 1b: 重写 Workflow 路由

**Files:**
- Modify: `routes/workflow.js`（全量重写为真实 CRUD + 执行 + 状态）

**Interfaces:**
- Consumes: `lib/workflow-engine.js` 的 CRUD + executeWorkflow
- Produces: RESTful API 端点

- [ ] **Step 1: 实现 CRUD 路由**

```javascript
// GET /api/workflow —— 列表
// GET /api/workflow/:id —— 详情
// POST /api/workflow —— 创建
// PUT /api/workflow/:id —— 更新
// DELETE /api/workflow/:id —— 删除
```

- [ ] **Step 2: 实现执行路由**

```javascript
// POST /api/workflow/:id/execute —— 执行
// 输入: { userQuestion, role, bizLine, sessionId }
// 输出: { ok, executionId, result, nodes, chain }
```

- [ ] **Step 3: 实现状态路由**

```javascript
// GET /api/workflow/:id/status —— 查询状态
// POST /api/workflow/:id/toggle —— 启用/禁用
```

- [ ] **Step 4: 在 server.js 注册路由**

已在 server.js 有 `/api/workflow` 注册，无需修改。


### 任务 1c: Workflow 测试

**Files:**
- Create: `test/workflow-engine.test.js`

- [ ] **Step 1: 测试种子数据初始化**

```javascript
test('T1: 首次调用初始化 4 个种子 Workflow', () => { /* ... */ });
test('T2: 各 Workflow 节点结构正确', () => { /* ... */ });
```

- [ ] **Step 2: 测试 CRUD**

```javascript
test('T3: 创建新 Workflow', () => { /* ... */ });
test('T4: 更新 Workflow', () => { /* ... */ });
test('T5: 删除 Workflow', () => { /* ... */ });
```

- [ ] **Step 3: 测试意图识别**

```javascript
test('T6: 意图识别匹配正确 Workflow', () => { /* ... */ });
test('T7: 未知意图返回默认', () => { /* ... */ });
```

- [ ] **Step 4: 测试执行引擎**

```javascript
test('T8: executeWorkflow 返回完整执行链路', () => { /* ... */ });
test('T9: 执行结果包含所有节点输出', () => { /* ... */ });
```


### 任务 2: 完整 AI 执行链路

**Files:**
- Modify: `routes/chat.js`（全量重写 POST /send）
- Modify: `lib/prompt-engine.js`（增强 assemblePrompt 支持分层）

**Interfaces:**
- Consumes: `lib/workflow-engine.js` (classifyIntent, executeWorkflow), `lib/rag-engine.js` (retrieve), `lib/prompt-engine.js` (assemblePrompt), `lib/qa-store.js` (appendRecord/...)
- Produces: 完整 AI 执行链路

- [ ] **Step 1: 重写 POST /api/chat/send**

```javascript
router.post('/send', auth.requireAuth, auth.requireWrite, (req, res) => {
  // 1. 基础校验
  // 2. 意图识别 → classifyIntent(userQuestion, role)
  // 3. 路由到 Workflow → executeWorkflow(workflowId, params)
  // 4. 执行引擎内部已完成: RAG → Skill → Reference → Prompt → LLM → QC
  // 5. 存储 user record + ai record
  // 6. 记录检索快照（全链路）
  // 7. 更新频次
  // 8. 返回结果
});
```

- [ ] **Step 2: 增强 prompt-engine.js assemblePrompt 支持分层**

```javascript
function assemblePrompt(params) {
  // 分层结构（与 补充说明文档2.md 一致）：
  // 全局 Prompt → 角色 Prompt → Workflow Prompt → Skill Prompt → Reference → RAG → 用户输入
  //
  // 新增参数:
  //   - workflowPrompt: Workflow 级别的指令
  //   - referenceTexts: Reference 文本列表
  //   - skillPrompt: Skill 级别的指令
}
```

- [ ] **Step 3: 确保 RAG 结果真正注入 Prompt**

当前 assemblePrompt 已有 ragChunks 参数，但 chat.js 传的 ragChunks 是 req.body.ragChunks（前端传的）。需要改为从 executeWorkflow 的 rag 节点输出中获取。

- [ ] **Step 4: 测试 chat 重写**

在现有 chat-api.test.js 中追加测试：验证意图识别、Workflow 路由、RAG 注入、分层 Prompt。


### 任务 9: AI 执行链路记录 + 双向反馈

**Files:**
- Modify: `lib/retrieval-snapshot.js`（增强全链路记录）
- Create: `lib/qa-store.js` 新增优秀案例存储
- Modify: `routes/feedback.js`（全量重写）
- Modify: `lib/prompt-engine.js`（增强 few-shot 从案例库加载）

**Interfaces:**
- Consumes: 任务 2 的 executeWorkflow 输出

- [ ] **Step 1: 增强 retrieval-snapshot 全链路记录**

在当前 `recordSnapshot` 基础上，新增字段：
```javascript
{
  // ... 现有字段
  
  // 新增全链路字段
  intentResult: { taskType, confidence, role, entities },
  workflowId: "wf_prd",
  workflowName: "PRD 生成 Workflow",
  chain: [  // 节点执行链路
    { nodeId, nodeType, nodeName, input, output, latencyMs }
  ],
  skillResults: [{ skillName, input, output }],
  referenceResults: [{ name, type, content }],
  promptText: "完整 Prompt 文本",
  llmResult: { content, model, latencyMs, tokenCount },
  qualityCheck: { passed, score, issues },
}
```

- [ ] **Step 2: 实现优秀案例存储（qa-examples.json 增强）**

新建或增强 `lib/qa-store.js` 的案例库功能：
```javascript
function addExample(role, question, answer, tags) { /* 追加到 qa-examples.json */ }
function listExamples(role) { /* 按角色过滤 */ }
function flagAsExample(sessionId, turn) { /* 将某轮问答标记为优秀案例 */ }
```

- [ ] **Step 3: 重写 routes/feedback.js**

```javascript
// POST /api/feedback/up —— 点赞
// POST /api/feedback/down —— 点踩（含原因）
// POST /api/feedback/flag-as-example —— 标记为优秀案例（仅管理员）
// POST /api/feedback/back-to-knowledge —— AI 生成→知识库回流（提交审核）
// GET /api/feedback/examples —— 优秀案例列表
// GET /api/feedback/chain/:sessionId/:turn —— 获取全链路记录
```

- [ ] **Step 4: 增强 prompt-engine 从案例库加载 few-shot**

在 `buildDynamicFewShot` 中，当 qa-examples 有数据时，优先从案例库加载。

- [ ] **Step 5: 测试链路记录与反馈**

```javascript
test('全链路记录包含所有字段', () => { /* ... */ });
test('点赞/点踩反馈', () => { /* ... */ });
test('标记为优秀案例', () => { /* ... */ });
test('全链路查询', () => { /* ... */ });
```