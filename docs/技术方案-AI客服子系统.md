# 技术方案 · AI 客服独立子系统（需求 3）

## 概述

**需求 3：AI 客服独立子系统**，为对外客户提供自助答疑。采用关键字匹配模式（不走向量检索），结合话术库 + 公开级知识库，答不出时转人工。

**核心特点**：
- 独立知识库（话术库 + 企业知识库公开级）
- 关键字匹配检索（可解释、可运营）
- 答不出时转人工 + 收集未命中问题
- 同义词表驱动迭代

---

## 1. 系统架构

### 1.1 数据层

三个新表：

| 表 | 说明 | 数据结构 |
|------|------|---------|
| `service-phrases.json` | 客服话术库（标准答案） | `{ version, updatedAt, phrases: Phrase[] }` |
| `service-synonyms.json` | 同义词表（客户说法 → 标准词） | `{ version, updatedAt, synonyms: { [keyword]: [variants...] } }` |
| `service-unmatch.json` | 未命中问题池（迭代数据） | `{ version, updatedAt, records: UnmatchRecord[] }` |

### 1.2 检索链路

```
客户提问 → 分词 → 停用词过滤 → 同义词归一 → 关键字命中
         ↓
    话术库匹配 ? 返回话术 : 公开级文档匹配 ? 标注出处答复 : 转人工
         ↓
    转人工 → 记入未命中池
```

---

## 2. API 设计

### 2.1 新增 3 个路由模块

在 `routes/` 下创建：
- `routes/service-chat.js` —— 客服对话 API
- `routes/service-admin.js` —— 客服后台管理（话术库、同义词表、未命中池）

### 2.2 服务聊天 API

#### `POST /api/service-chat/send` —— 客户提问

**职责**：接收客户问题，执行关键字检索，返回回答或转人工指示。

**请求**：
```json
{
  "sessionId": "svc_session_001",
  "question": "我买的东西不想要了，钱啥时候能回来",
  "bizLine": "trade"  // 可选，用于检索权限隔离
}
```

**响应 - 命中话术库**：
```json
{
  "ok": true,
  "mode": "phrase",
  "answer": "感谢您的咨询。如需发起退款，请按以下步骤操作：1. 登录账户 2. 进入订单页面 3. 选择\"申请退款\"...",
  "matchedKeywords": ["退款", "时效"],
  "confidence": 0.95,
  "keywords": {
    "退款": { "standard": true, "weight": 0.8 },
    "时效": { "standard": true, "weight": 0.7 }
  }
}
```

**响应 - 兜底公开级文档**：
```json
{
  "ok": true,
  "mode": "document",
  "answer": "根据我们的退货政策...",
  "source": "退货规则.md",
  "sourceDocId": "raw_abc123",
  "matchedKeywords": ["退货", "政策"],
  "confidence": 0.65
}
```

**响应 - 转人工**：
```json
{
  "ok": true,
  "mode": "transfer",
  "message": "感谢您的问题，我没有找到相关答案，已将您转接至客服人员...",
  "originalQuestion": "我买的东西不想要了，钱啥时候能回来",
  "unmatchRecordId": "unmatch_20260812_001"
}
```

### 2.3 客服后台 API（仅 admin / cs 可访问）

#### `GET /api/service-admin/phrases` —— 话术库列表

分页获取所有话术条目。

响应：
```json
{
  "ok": true,
  "phrases": [
    {
      "id": "phrase_001",
      "keyword": "退款",
      "content": "感谢您的咨询。如需发起退款...",
      "createdAt": "2026-08-01T10:00:00Z",
      "createdBy": "user_admin",
      "updatedAt": "2026-08-10T15:30:00Z",
      "hitCount": 152,
      "lastUsed": "2026-08-12T09:15:00Z"
    }
  ],
  "total": 28
}
```

#### `POST /api/service-admin/phrases` —— 新增话术

```json
{
  "keyword": "退款",
  "content": "感谢您的咨询..."
}
```

#### `PUT /api/service-admin/phrases/:id` —— 编辑话术

#### `DELETE /api/service-admin/phrases/:id` —— 删除话术

#### `GET /api/service-admin/synonyms` —— 获取同义词表

```json
{
  "ok": true,
  "synonyms": {
    "退款": ["退钱", "钱啥时候到", "钱回来", "返款"],
    "退货": ["不想要了", "能不能退", "寄回去"],
    "时效": ["多久", "几天", "什么时候"]
  }
}
```

#### `POST /api/service-admin/synonyms/:keyword` —— 新增同义词

```json
{
  "variant": "退钱"
}
```

#### `DELETE /api/service-admin/synonyms/:keyword/:variant` —— 删除同义词

#### `GET /api/service-admin/unmatch?limit=50&offset=0` —— 未命中问题池

```json
{
  "ok": true,
  "records": [
    {
      "id": "unmatch_20260812_001",
      "question": "我买的东西不想要了，钱啥时候能回来",
      "sessionId": "svc_session_001",
      "analyzedKeywords": ["不想要", "钱", "时效"],
      "status": "pending",  // pending / resolved
      "createdAt": "2026-08-12T09:15:00Z",
      "resolution": null,  // 当 status=resolved 时填 {"type": "add_phrase" | "add_synonym" | "ignored", "detail": "..."}
      "hitCount": 1
    }
  ],
  "total": 15
}
```

#### `PATCH /api/service-admin/unmatch/:id` —— 标记未命中问题为已解决

```json
{
  "resolution": {
    "type": "add_synonym",
    "detail": "已将「不想要」加入「退货」的同义词表"
  }
}
```

---

## 3. 前端页面 `public/service-chat.html`

### 3.1 客户窗口

```
┌─────────────────────────────────┐
│ AI 客服                         │
├─────────────────────────────────┤
│ 欢迎！有什么我可以帮助的吗？    │
├─────────────────────────────────┤
│                                 │
│ [对话区域]                      │
│                                 │
├─────────────────────────────────┤
│ [输入框] [发送]                 │
│                                 │
│ 🔌 客服在线  💬 联系我们  ℹ️ FAQ │
└─────────────────────────────────┘
```

**功能**：
- 消息输入 + 发送
- 话术库直接答复 —— 显示"系统回复"
- 公开级文档兜底 —— 显示"系统回复（参考文档：xxx）"
- 答不出时 —— 显示"正在转接人工客服..."

### 3.2 后台管理页面 `public/service-admin.html`

三个 Tab：

#### Tab 1: 话术库

| 操作 | 说明 |
|------|------|
| 列表 | 显示所有话术，含关键词、内容、命中次数、最后更新时间 |
| 编辑 | 修改内容，自动保存 |
| 新增 | 表单创建新话术 |
| 删除 | 确认删除 |

#### Tab 2: 同义词表

- 左侧：标准词列表（展示 "退款"、"退货"、"时效" 等）
- 右侧：该标准词的客户说法列表
- 功能：增删改、拖拽排序（常用的说法排在前）

#### Tab 3: 未命中问题池

| 字段 | 说明 |
|------|------|
| 问题 | 客户的原始提问 |
| 分析结果 | AI 分词出的关键字 |
| 状态 | pending / resolved |
| 建议 | 缺同义词还是缺话术（AI 分析） |
| 操作 | 标记已解决（记录解决方式） |

---

## 4. 数据结构定义

### 4.1 `Phrase` —— 话术条目

```typescript
{
  id: string,           // phrase_001
  keyword: string,      // "退款"
  category?: string,    // 可选分类：售后/账户/产品等
  content: string,      // 标准话术正文
  createdAt: string,    // ISO 时间戳
  createdBy: string,    // 创建人 id
  updatedAt: string,
  updatedBy: string,
  reviewStatus?: 'pending' | 'approved' | 'rejected',  // 可选审核流
  reviewedBy?: string,
  reviewedAt?: string,
  hitCount: number,     // 被命中过的次数（实时统计）
  lastUsed?: string,    // 最后一次使用时间
}
```

### 4.2 `Synonym` —— 同义词映射

```typescript
{
  // 存储形式：同义词表是一个大对象
  [standardKeyword]: {
    variants: string[],      // ["退钱", "钱啥时候到", ...]
    frequency?: {             // 可选：统计客户说每个变体的次数
      "退钱": 45,
      "钱啥时候到": 32
    }
  }
}
```

### 4.3 `UnmatchRecord` —— 未命中问题

```typescript
{
  id: string,                    // unmatch_20260812_001
  question: string,              // 原始客户提问
  sessionId: string,             // 关联对话 session
  timestamp: string,             // 发问时间
  analyzedKeywords: string[],    // 分词结果：["不想要", "钱", "时效"]
  matchAttempt: {
    phraseMatched: boolean,      // 是否匹配话术库
    documentMatched: boolean,    // 是否匹配公开文档
    matchedTerms?: {
      "退货": { source: "phrase" | "document", weight: 0.65 }
    }
  },
  status: 'pending' | 'resolved',
  resolution?: {
    type: 'add_phrase' | 'add_synonym' | 'ignored',
    detail: string,              // 例："已将「不想要」加入「退货」的同义词表"
    resolvedAt?: string,
    resolvedBy?: string
  },
  hitCount: number               // 累计被多少客户问过
}
```

---

## 5. 核心算法

### 5.1 分词 + 停用词过滤

```javascript
function tokenize(question) {
  // 1. 分词（中文 unigram + bigram、英文按词）
  // 2. 转小写
  // 3. 去掉停用词表中的词："的"、"是"、"呢"、"吗" 等
  return tokens;
}
```

### 5.2 同义词归一

```javascript
function normalize(tokens, synonyms) {
  // 将客户说的词映射到标准词
  // input: ["不想要", "钱", "时效"]
  // output: ["退货", "钱", "时效"]
  return normalizedTokens;
}
```

### 5.3 关键字匹配打分

```javascript
function matchAndScore(normalizedTokens, phraseKeywords, synonyms, idf) {
  let scores = {};
  
  for (const phrase of phraseKeywords) {
    let score = 0;
    for (const token of normalizedTokens) {
      if (token === phrase.keyword) {
        // 精确匹配：权重最高
        score += 1.0 * idf[token];
      } else if (synonyms[phrase.keyword]?.includes(token)) {
        // 同义词匹配：权重 0.7
        score += 0.7 * idf[token];
      }
    }
    if (score > 0) {
      scores[phrase.id] = score;
    }
  }
  
  // 按分数降序排列，置信度 = score / maxScore
  return sortedMatches.map(m => ({
    id: m.id,
    score: m.score,
    confidence: m.score / Math.max(...Object.values(scores))
  }));
}
```

### 5.4 结果分流逻辑

```
if (话术库命中 && confidence >= 0.6) {
  return 话术库回答
} else if (公开级文档命中 && confidence >= 0.5) {
  return 文档回答 + 出处
} else {
  记入未命中池
  return 转人工提示
}
```

---

## 6. 与现有代码的关系

### 6.1 数据层复用

| 现有模块 | 复用方式 |
|----------|----------|
| `lib/store.js` | 读写新表：service-phrases / service-synonyms / service-unmatch |
| `lib/knowledge-layers.js` | 调用 `listRaws(filter: {securityLevel: 'public'})` 获取公开级文档 |
| `lib/rag-engine.js` | 复用 tokenize（分词）、idf 计算；**不走向量检索** |
| `lib/auth.js` | 权限校验：GET 查询权限、POST/PUT/DELETE 需 admin/cs 角色 |

### 6.2 不修改的文件

- `routes/chat.js` —— 内部助手的对话 API，不动
- `lib/qa-store.js` —— 内部对话历史，不动
- `public/workspace.html` —— 内部工作台，不动

### 6.3 新增文件

| 文件 | 说明 |
|------|------|
| `routes/service-chat.js` | 客服对话 API |
| `routes/service-admin.js` | 客服后台管理 API |
| `public/service-chat.html` | 客户窗口 |
| `public/service-admin.html` | 后台管理页面 |
| `lib/service-engine.js` | 关键字匹配引擎（核心算法） |
| `test/service-engine.test.js` | 算法单元测试 |

---

## 7. 实现顺序（建议 TDD）

### 阶段 1：核心算法（lib/service-engine.js）

**单元测试**：
- T1: 分词（中文 unigram + bigram、英文按词）
- T2: 停用词过滤
- T3: 同义词归一（客户说法 → 标准词）
- T4: 关键字打分（精确匹配权重 > 同义词匹配）
- T5: IDF 权重计算（罕见词权重高）
- T6: 端到端流程（问题 → 匹配结果）

### 阶段 2：API 后端（routes/service-*.js）

- T7: POST /api/service-chat/send（三种结果分流）
- T8: GET /api/service-admin/phrases（列表 + 分页）
- T9: POST /api/service-admin/phrases（新增）
- T10: PUT /api/service-admin/phrases/:id（编辑）
- T11: DELETE /api/service-admin/phrases/:id（删除）
- T12: GET /api/service-admin/synonyms（查询同义词表）
- T13: POST /api/service-admin/synonyms/:keyword（新增同义词）
- T14: 权限校验（仅 admin/cs 可管理，客户只读）

### 阶段 3：前端页面

- 客户窗口：输入框 + 消息展示 + 转人工提示
- 后台 Tab 1: 话术库管理
- 后台 Tab 2: 同义词表管理
- 后台 Tab 3: 未命中问题池 + 解决流程

---

## 8. 关键设计决策

### 8.1 为什么关键字匹配而不是向量检索

1. **问题高度收敛**：80% 的客服问题是常见问题的变体
2. **可解释可运营**："为什么这条没召回"，管理员能自己看懂
3. **错答成本极高**：宁可转人工，不要"语义接近但实际不对"
4. **法务合规**：某些问题必须用固定话术回答，向量做不到强制

### 8.2 话术库优先于公开级文档

确保对客户说的话都经过审批，降低风险。

### 8.3 转人工是必要功能，而非失败

未命中问题池是知识库唯一的成长路径。通过收集客户问不出的问题，迭代同义词表和话术库。

---

## 9. 验收方式

```bash
cd d:\temp\ai-assistant

# 1. 运行算法单元测试
npm test -- test/service-engine.test.js
# 预期：T1-T6 全部通过

# 2. 启动服务器
npm start

# 3. 客户窗口（http://localhost:3000/service-chat.html）
# - 输入常见问题："我怎样申请退款" → 应命中话术库
# - 输入模棱两可的问题："钱啥时候回" → 应依靠同义词匹配
# - 输入完全不相关的问题："天气怎么样" → 应转人工

# 4. 后台管理（http://localhost:3000/service-admin.html）
# - 创建新话术、编辑同义词
# - 查看未命中问题池、标记已解决
```

---

## 10. 风险 & 注意

1. **同义词表的维护成本**：需要运营人员持续补充。建议 MVP 阶段从「常见问题」列表 × 「口语说法」矩阵出发，列举 20-30 个标准词及其 5-10 种变体。

2. **话术库的法务审核流**：当前方案未包含审核工作流。如需法务把关，可在 `Phrase` 模型中加 `reviewStatus` 字段。

3. **覆盖率 vs 转人工率**：初期可能转人工率很高（40-50%）。通过迭代同义词表，目标是达到 70-80% 的一层命中率（话术库 + 文档）。

4. **跨业务线隔离**：当前方案中 `bizLine` 是可选的。如需严格隔离（交易线客服只看交易话术），需补充过滤逻辑。

---

## 11. 后续扩展方向

1. **多轮对话**：当前是单轮问答。如需多轮，需追加 `sessionId` 和上下文管理。
2. **情感分析**：识别客户的不满情绪，自动提升为人工处理。
3. **A/B 测试**：对同一个问题的两种话术做效果对比。
4. **推荐系统**：根据客户问题的相似度，推荐常见解决方案。
