# 技术方案 · QA 审计页（需求 1）

## 概述

**需求 1：QA 审计页**，让管理员能看到系统里所有的问答记录，以及每条回答背后的 RAG 召回详情。

**数据源**：`qa-history.json`（需求 4 B1 已建好，B4 B5 已有数据写入）

**现有数据格式**（`lib/qa-store.js`）：
- `qa-store.listSessions()` — 返回 session 列表（含 summary）
- `qa-store.listBySession(sessionId)` — 返回该 session 全部 record（user + ai 交替，按 turn 升序）
- 每条 record 包含：`ragChunks` 数组（召回片段详情）、`qualityScore`、`feedback`、`workflowId` 等字段

---

## 1. 新增 2 个 Admin API

挂在 `routes/admin.js` 下（已有 `/users`、`/stats`），遵循相同权限模式：`auth.requireAuth` + `role === 'admin'` 校验。

### 1.1 `GET /api/admin/qa-history` — 问答历史列表

**职责**：返回所有 session 列表（按时间倒序），管理员预览用。

**请求**：
```
GET /api/admin/qa-history?limit=50&offset=0
Authorization: Bearer <token>
```

**响应**：
```json
{
  "ok": true,
  "sessions": [
    {
      "sessionId": "s_001",
      "lastTimestamp": "2026-08-13T10:00:00Z",
      "recordCount": 5,
      "summary": "退款流程 PRD 怎么写",
      "userName": "张三",
      "role": "product",
      "bizLine": "trade"
    }
  ],
  "total": 42
}
```

**实现**：
- 调用 `qa-store.listSessions(limit)` + 补充 `userName`/`role`/`bizLine` 字段（从该 session 首条 user record 取）
- 权限：`auth.requireAuth` + `admin` 角色校验
- 分页：支持 `limit` + `offset` 参数（默认 `limit=50`，`offset=0`）

### 1.2 `GET /api/admin/qa-history/:sessionId` — Session 详情（含完整召回信息）

**职责**：返回单个 session 的全部 record，包括每条 AI record 的完整 ragChunks 详情。

**请求**：
```
GET /api/admin/qa-history/s_001
Authorization: Bearer <token>
```

**响应**：
```json
{
  "ok": true,
  "session": {
    "sessionId": "s_001",
    "records": [
      {
        "turn": 1, "type": "user", "content": "退款流程怎么写",
        "role": "product", "bizLine": "trade", "userName": "张三",
        "timestamp": "2026-08-13T10:00:00Z"
      },
      {
        "turn": 1, "type": "ai", "content": "退款流程 PRD 应包含 7 要素...",
        "role": "product", "bizLine": "trade",
        "timestamp": "2026-08-13T10:00:02Z",
        "workflowId": "wf_1723536000000",
        "qualityScore": 8,
        "ragChunks": [
          {
            "chunkId": "chunk_017",
            "content": "退款流程：用户在订单页面发起退款申请...",
            "source": "退款规则.md",
            "sourceDocId": "raw_001",
            "stdId": "std_001_v2",
            "similarity": 0.87,
            "matchedKeywords": ["退款", "流程"],
            "sectionPath": "第3章 退款流程 > 3.1 用户发起退款"
          }
        ],
        "latencyMs": 2341
      },
      {
        "turn": 2, "type": "user", "content": "怎么定验收标准",
        "role": "product", "bizLine": "trade", "userName": "张三",
        "timestamp": "2026-08-13T10:01:00Z"
      },
      {
        "turn": 2, "type": "ai", "content": "验收标准应量化...",
        "role": "product", "bizLine": "trade",
        "timestamp": "2026-08-13T10:01:03Z",
        "workflowId": "wf_1723536060000",
        "qualityScore": null,
        "ragChunks": [],
        "latencyMs": 3002
      }
    ]
  }
}
```

**实现**：
- 调用 `qa-store.listBySession(sessionId)` — 返回全部 record
- 权限：仅 `admin` 角色可读（管理员看所有问答历史）
- 错误：session 不存在 → 404
- 数据完整性：session 内 turn 从 1 开始递增，每个 turn 包含 user + ai 两条记录

---

## 2. 前端页面 `public/admin-qa.html`

### 2.1 页面结构

```
┌─────────────────────────────────────────────────┐
│  QA 审计                    [当前身份: admin]    │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │ 搜索框 [搜索摘要/用户名]  [筛选角色 ▼]     ││
│  └─────────────────────────────────────────────┘│
│                                                 │
│  ┌─────────────────────────────────────────────┐│
│  │ 2026-08-13 10:00                             ││
│  │ 退款流程怎么写           张三 · 产品 · 交易  ││
│  ├─────────────────────────────────────────────┤│
│  │ 2026-08-13 09:30                             ││
│  │ 测试用例生成              李四 · 测试 · 会员 ││
│  ├─────────────────────────────────────────────┤│
│  │ 2026-08-13 09:00                             ││
│  │ 前端组件封装              王五 · 前端 · 全线 ││
│  │ ...                                          ││
│  └─────────────────────────────────────────────┘│
│                                                 │
│  共 42 条                    [1] [2] [3] ...     │
└─────────────────────────────────────────────────┘
```

### 2.2 功能点

| 功能 | 说明 |
|------|------|
| 列表 | 按 `lastTimestamp` 倒序显示所有 session，每条显示摘要、用户名、角色、业务线 |
| 点击进入详情 | 点击某条 session → 进入该 session 的对话详情页 |
| 搜索 | 按摘要关键词搜索（前端过滤或后端 API 扩展） |
| 角色筛选 | 下拉筛选 product / test / frontend / cs |
| 分页 | 支持 `limit` + `offset` 分页 |

### 2.3 详情页结构

进入某条 session 后，展示完整的对话流：

```
┌─────────────────────────────────────────────────┐
│  ← 返回列表                                      │
│  退款流程怎么写                                  │
│  张三 · 产品经理 · 交易线 · 2026-08-13 10:00     │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 用户 (10:00)                               │  │
│  │ 退款流程怎么写                             │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ AI (10:00:02)     质量分 8/10  ⏱ 2341ms  │  │
│  │ 退款流程 PRD 应包含 7 要素...             │  │
│  │                                           │  │
│  │ ── 召回详情 ──                            │  │
│  │                                           │  │
│  │ ① 退款规则.md · 第3章 退款流程            │  │
│  │    相似度 87% · 命中词: 退款, 流程         │  │
│  │    退款流程：用户在订单页面发起退款申请...  │  │
│  │    [📍 定位到知识库]                      │  │
│  │                                           │  │
│  │ ② 客服FAQ.md · 常见问题 > 退款时效        │  │
│  │    相似度 65% · 命中词: 流程               │  │
│  │    退款通常在 3-5 个工作日到账...          │  │
│  │    [📍 定位到知识库]                      │  │
│  │                                           │  │
│  │ 工作流 ID: wf_1723536000000               │  │
│  │ 用户反馈: [👍 有用] [👎 没用]             │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ 用户 (10:01)                               │  │
│  │ 怎么定验收标准                             │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ AI (10:01:03)     质量分 -  ⏱ 3002ms     │  │
│  │ 验收标准应量化...                          │  │
│  │                                           │  │
│  │ ── 召回详情 ──                            │  │
│  │ 本次检索未命中知识库中的相关片段           │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 2.4 交互细节

- **「定位到知识库」按钮**：点击后在新标签页打开 `knowledge.html`，URL 带参数 `?chunkId=chunk_017`，knowledge.html 页面检测到该参数后自动滚动到对应 chunk 并高亮
- **用户反馈记录**：显示该条 AI 回答的用户反馈状态（up/down/null），作为质量评估的参考
- **空召回提示**：若 ragChunks 为空数组，显示"本次检索未命中知识库中的相关片段"
- **质量分显示**：qualityScore 为 null 时显示 "-"（未评估）

---

## 3. 与现有代码的关系

### 3.1 数据层复用

| 现有模块 | 复用方式 |
|----------|----------|
| `lib/qa-store.js` | 直接复用：`listSessions()`、`listBySession()` |
| `routes/admin.js` | 追加 2 个新 endpoint，复用 `auth.requireAuth` + admin 权限校验 |
| `public/js/app.js` | 在导航栏的 admin 入口下增加"QA 审计"子页面链接 |

### 3.2 不修改的文件

- `lib/qa-store.js` — 只读调用，不改动
- `routes/chat.js` — 数据已经通过 B4 写入，不动
- `lib/rag-engine.js` — 不涉及检索逻辑改动
- `server.js` — 路由挂载在 routes/admin.js 下，无需新增 routeModule

### 3.3 新增文件

| 文件 | 说明 |
|------|------|
| `public/admin-qa.html` | QA 审计页前端页面（列表 + 详情） |
| `test/admin-qa.test.js` | 测试文件（4-6 个测试） |

---

## 4. 测试计划（TDD）

### 4.1 测试用例

| # | 测试 | 类型 | 说明 |
|---|------|------|------|
| T1 | 空库时返回空列表 | 正常 | 无任何 qa-history 数据时返回 `{ sessions: [], total: 0 }` |
| T2 | 有数据时返回 session 列表倒序 | 正常 | 2 个 session 按 lastTimestamp 倒序 |
| T3 | 非 admin 角色 403 | 权限 | 非 admin 身份调用返回 403 |
| T4 | 未登录 401 | 权限 | 无 token 调用返回 401 |
| T5 | 查看详情返回完整 record | 正常 | 含 ragChunks 完整信息 |
| T6 | 不存在的 sessionId 返回 404 | 错误 | 查不存在的 session 返回 404 |

### 4.2 测试环境

- 使用 `lib/qa-store` 的 `appendRecord` 写入测试数据（用 `withTempDataDir` 隔离到 `os.tmpdir()`）
- 不碰真实 `data/qa-history.json`

---

## 5. 风险 & 注意

1. **数据量增长**：`qa-history.json` 长期运行会积累大量记录。当前 `trim()` 限制 100 session / 1000 record，QA 审计页的列表分页可以缓解，但需注意大数据量下 `listAll` 的内存占用
2. **ragChunks 字段完整性**：当前 `POST /api/chat/send` 的简化实现中，`ragChunks` 由客户端传入（`req.body.ragChunks`），实际线上应改为服务端 RAG 引擎自动填充。QA 审计页的详情展示依赖该字段，建议在实现时一并确认数据完整性
3. **「定位到知识库」导航**：`knowledge.html` 需要支持 `?chunkId=xxx` 参数并自动滚动。如果该页面还未实现此功能，可以在本需求中一并实现，或先不加链接、只做文字展示

---

## 6. 验收方式

```bash
cd d:\temp\ai-assistant
node --test test/admin-qa.test.js  # 应 4-6/0/0/4-6
node server.js
# 浏览器访问 http://localhost:3000/admin-qa.html
# 用 admin 身份登录，查看问答历史列表和详情
```