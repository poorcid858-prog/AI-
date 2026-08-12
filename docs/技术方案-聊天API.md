# 技术方案 · 聊天 API（需求 4 B4）

## 概述

B4 实现 `routes/chat.js`：4 个 API endpoint，支撑聊天页的历史、频次、发送、详情功能。

## 4 个 API

### 1. `GET /api/chat/history` — 聊天历史列表

**职责**：列出当前用户的历史聊天 session（倒序，最新优先）

**请求**：
```
GET /api/chat/history?limit=100&offset=0
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
      "summary": "退款流程 PRD 怎么写（首条 user 问题前 50 字）"
    }
  ],
  "total": 42
}
```

**实现**：
- 调用 `lib/qa-store.listSessions(limit=100)` —— 返回 session 列表
- 权限：`auth.requireAuth`
- 错误：无特殊，统一 sendError 处理

---

### 2. `GET /api/chat/frequency?role=product` — 常用问题

**职责**：返回该岗位的常用问题 top 10（按频次）

**请求**：
```
GET /api/chat/frequency?role=product
Authorization: Bearer <token>
```

**响应**：
```json
{
  "ok": true,
  "frequency": [
    { "text": "退款流程prd", "count": 12, "lastAsked": "2026-08-08" },
    { "text": "订单管理需求", "count": 9, "lastAsked": "2026-08-09" }
  ]
}
```

**实现**：
- 调用 `lib/qa-store.getTopFrequency(role, n=10)` —— 返回 top 10
- 权限：`auth.requireAuth`
- 错误：`role` 非法（非 product/test/frontend/cs）→ 400
- **关键**：频次表自动维护（在 B4 的 send 接收时更新）

---

### 3. `POST /api/chat/send` — 发送新问题

**职责**：接收用户问题，跑完整 workflow（RAG + prompt + LLM），返回 AI 回答

**请求**：
```json
POST /api/chat/send
Content-Type: application/json
Authorization: Bearer <token>

{
  "sessionId": "s_001",
  "role": "product",
  "bizLine": "trade",
  "question": "退款流程怎么写"
}
```

**响应**：
```json
{
  "ok": true,
  "record": {
    "id": "qa_20260813_001",
    "sessionId": "s_001",
    "turn": 1,
    "type": "ai",
    "content": "退款流程 PRD 应包含 7 要素...",
    "ragChunks": [
      { "id": "chunk_001", "content": "退款流程：用户在订单页面发起...", "source": "order-management.md" }
    ],
    "qualityScore": 8,
    "timestamp": "2026-08-13T10:00:00Z"
  }
}
```

**实现**：
1. 校验 `sessionId` / `role` / `bizLine` / `question` 非空
2. 权限：`auth.requireAuth` —— 保存 req.user.id 到 record
3. **user 问题 record**：调用 `lib/qa-store.appendRecord({ ..., type: 'user', content: question })`
4. **RAG 检索**：调用 `lib/rag-engine.retrieveChunks(question, user.bizLine)`
5. **Prompt 组装**：调用 `lib/prompt-engine.assemblePrompt({ role, bizLine, userQuestion: question, ragChunks })`
6. **LLM 推理**：调用 `lib/llm-adapter.generate(prompt)` —— 返回 AI 回答
7. **AI 回答 record**：调用 `lib/qa-store.appendRecord({ ..., type: 'ai', content: answer, ragChunks })`
8. **更新频次**：调用 `lib/qa-store.incrementFrequency(role, question)`
9. 返回第 8 步的 record（AI 回答）
10. **错误处理**：业务错误 400/403/404，LLM 异常 500

---

### 4. `GET /api/chat/session/:id` — Session 详情

**职责**：返回单个 session 的全部 record（用户问题 + AI 回答交替）

**请求**：
```
GET /api/chat/session/s_001
Authorization: Bearer <token>
```

**响应**：
```json
{
  "ok": true,
  "session": {
    "sessionId": "s_001",
    "records": [
      { "id": "qa_...", "turn": 1, "type": "user", "content": "退款流程怎么写", "timestamp": "..." },
      { "id": "qa_...", "turn": 1, "type": "ai", "content": "退款流程 PRD 应包含...", "ragChunks": [...], "timestamp": "..." },
      { "id": "qa_...", "turn": 2, "type": "user", "content": "怎么定验收标准", "timestamp": "..." },
      { "id": "qa_...", "turn": 2, "type": "ai", "content": "验收标准应量化...", "timestamp": "..." }
    ]
  }
}
```

**实现**：
- 调用 `lib/qa-store.listBySession(sessionId)` —— 返回全部 record 按 turn 升序
- 权限：`auth.requireAuth` —— 仅该 session 的 userId 可读（与 req.user.id 比）
- 错误：session 不存在 → 404；无权限 → 403

---

## 实现细节

### 错误处理模式

复用 routes/documents.js 的 `sendError` 函数：

```js
function sendError(res, e) {
  const code = Number.isInteger(e.status) ? e.status : 500;
  const msg = code === 500 ? '服务器内部错误' : e.message;
  if (code === 500) console.error('[chat] 意外异常:', e);
  res.status(code).json({ ok: false, error: msg });
}
```

### 权限拦截

- `auth.requireAuth` —— 所有 API 都需要（游客无法聊天）
- `auth.requireWrite` —— send 时需要（对应 `readonly` 模式）
- sessionId 所有权校验（send 时 sessionId 可客户端生成，read 时要检查归属）

### Session 管理

- sessionId 由**客户端**生成并传入（format: `s_<timestamp>_<random>`）
- 第一条 record 决定该 session 的 user（后续 record 验证 userId 一致）
- 关闭浏览器 → sessionId 变（sessionStorage 清空）→ 新 session

---

## TDD 纪律

1. **先写测试**（`test/chat-api.test.js`）：
   - T1: GET /history 返回列表
   - T2: GET /frequency 返回 top 10
   - T3: POST /send 完整流程（RAG + prompt + LLM）
   - T4: GET /session/:id 返回交替 record
   - T5: 权限拦截（403/404）
   - T6: 只读模式拦截 send（403）

2. **再写实现**：routes/chat.js 四个 endpoint

3. **测试全过**：4-6 个新测试 + 全套 0 fail

---

## 风险 & 注意

1. **sessionId 冲突**：客户端生成可能重复 —— 建议用 UUID 或 `Date.now() + Math.random()`
2. **LLM 推理超时**：send 可能 30s+ 慢 —— 前端应加 timeout + 重试逻辑
3. **RAG 无召回**：question 检索不到 chunk —— assemblePrompt 降级到无 RAG 段（已实现）
4. **频次表爆炸**：长期运行积累大量 unique question —— 定期审计 / trim 旧数据

---

## 验收

```bash
cd d:\temp\ai-assistant
node --test test/chat-api.test.js  # 应 4-6/0/0/4-6
node --test                         # 应全过 0 fail
```
