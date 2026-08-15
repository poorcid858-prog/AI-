# 能力聚合视图+创建前端 + 审核发布按钮+能力审核 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成能力聚合视图（以AI能力为单位的列表+创建向导）和审核发布按钮+能力审核Tab

**Architecture:** 
- 任务3（能力聚合视图+创建前端）：重写 `capability.html` 为聚合视图（显示能力关联的Workflow及全部要素），新增创建向导UI
- 任务4（审核发布+能力审核）：在 `review.html` 详情页加"发布"按钮，在审核中心加"能力审核"Tab

**Tech Stack:** Express + Bootstrap 5.3 + 本地JSON文件存储

**Spec:** `docs/差距分析与重构方案.md` 任务包3️⃣和4️⃣

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `public/capability.html` | 重写 | 能力聚合视图 + 创建向导 |
| `public/js/capability.js` | 重写 | 能力聚合视图前端逻辑 |
| `public/admin-capability.html` | 不改 | 现有能力编辑页面保留 |
| `public/review.html` | 修改 | 加"发布"按钮 + "能力审核"Tab |
| `routes/capability.js` | 微调 | 加审核接口（通过/驳回/列表） |
| `lib/capability-engine.js` | 增强 | 加审核状态管理、提交审核、审核列表 |
| `test/capability.test.js` | 追加 | 新功能测试 |

---

### 任务4a: 审核发布按钮（review.html 详情页）

**现状：** 审核通过后 status=approved，但需要独立"发布"按钮调 `POST /api/documents/:id/publish` 才能生成向量进入RAG库

**Files:**
- Modify: `public/review.html`（详情页底部加"发布"按钮）

**Interfaces:**
- Consumes: `POST /api/documents/:id/publish`（已有）
- Produces: 审核通过后显示"发布"按钮

- [ ] **Step 1: review.html 详情页加"发布"按钮**

在 `review.html` 的 `loadDetail()` 函数中，审核通过后的状态下显示"发布"按钮：

```js
// 在可审核区域，通过后显示"发布"按钮
// 在 canReview 区块内，审核通过后显示"发布"按钮
// 在 doc.status === 'approved' 时，显示发布按钮
```

- [ ] **Step 2: 验证发布按钮逻辑**

审核通过 → 页面刷新 → 显示"发布"按钮 → 点击调 publish API → 状态变为已发布

---

### 任务4b: 能力审核后端（审核状态+API）

**现状：** 能力中心有 draft→publish 流程，但缺少"提交审核→审核通过/驳回→发布"的审核流程

**Files:**
- Modify: `lib/capability-engine.js`（加审核状态、提交审核、审核列表、审核通过/驳回）
- Modify: `routes/capability.js`（加能力审核API）

**Interfaces:**
- Produces: `POST /api/capabilities/:id/submit-review` 提交审核
- Produces: `GET /api/capabilities/pending-review` 待审核能力列表
- Produces: `POST /api/capabilities/:id/review-capability` 审核决定

- [ ] **Step 1: capability-engine.js 加审核状态管理**

```js
// 新增字段：capability.reviewStatus = null | 'pending_review' | 'approved' | 'rejected'
// 新增函数：
function submitForReview(capId, submittedBy)  // 从草稿状态→待审核
function getPendingReviewCapabilities()       // 获取待审核能力列表
function reviewCapability(capId, decision, reviewer, note)  // 审核通过/驳回
```

- [ ] **Step 2: routes/capability.js 加审核API**

```js
router.post('/:id/submit-review', requireWrite, ...)    // 提交审核
router.get('/pending-review', auth.requireAuth, ...)     // 待审核列表
router.post('/:id/review-capability', requireReview, ...) // 审核决定
```

- [ ] **Step 3: 写测试**

```js
// T38: submitForReview 提交审核
// T39: getPendingReviewCapabilities 待审核列表
// T40: reviewCapability 审核通过/驳回
// T41: 边界测试（无草稿提交审核→400）
```

---

### 任务4c: 审核中心能力审核Tab（review.html）

**Files:**
- Modify: `public/review.html`（加Tab切换：文档审核 / 能力审核）

**Interfaces:**
- Consumes: `GET /api/capabilities/pending-review`（待审核能力列表）
- Consumes: `POST /api/capabilities/:id/review-capability`（审核决定）

- [ ] **Step 1: review.html 加Tab导航**

在标题下方加Tab切换：`文档审核 | 能力审核`，默认显示文档审核

- [ ] **Step 2: 能力审核列表视图**

调用 `GET /api/capabilities/pending-review` 展示待审核能力列表（能力名/类型/提交人/提交时间/操作）

- [ ] **Step 3: 能力审核详情+操作**

点击"审核"进入详情，显示能力详情（名称/类型/描述/草稿内容），提供"通过"和"驳回"按钮

---

### 任务3a: 能力聚合视图（capability.html 重写）

**现状：** `capability.html` 是5种类型列表（Workflow/Skill/Reference/Script/Tool），不是以AI能力为单位的聚合视图

**Files:**
- Modify: `public/capability.html`（重写为聚合视图）
- Modify: `public/js/capability.js`（重写前端逻辑）

**Interfaces:**
- Consumes: `GET /api/capabilities`（列表摘要）
- Consumes: `GET /api/capabilities/:id`（详情）

- [ ] **Step 1: capability.html 改为聚合视图布局**

采用三栏布局：
- 左栏：能力列表（以AI能力为单位，显示名称/类型/状态/版本/关联Workflow）
- 右栏：选定能力的详情面板（显示关联的Workflow及其全部要素）

- [ ] **Step 2: 能力列表渲染**

调用 `GET /api/capabilities` 获取所有能力，按类型分组显示，但以能力为行单位

- [ ] **Step 3: 能力详情面板**

点击能力行，右侧显示详情：
- 基本信息（名称/类型/描述/版本/状态）
- 关联Workflow信息（如果该能力是workflow类型，显示其包含的skill/reference/prompt等）
- 提交审核/发布操作按钮

---

### 任务3b: 能力创建向导

**现状：** `admin-capability.html` 只能编辑已有能力，无"新建能力"入口

**Files:**
- Modify: `public/capability.html`（加"新建能力"按钮+向导模态框）
- Modify: `public/js/capability.js`（向导逻辑）

**Interfaces:**
- Consumes: `POST /api/capabilities`（创建能力，已有）

- [ ] **Step 1: 加"新建能力"按钮**

在能力列表上方加"新建能力"按钮

- [ ] **Step 2: 创建向导模态框**

分步向导：
1. 选类型（workflow/skill/reference/script/tool）
2. 填名称+描述
3. 填内容（JSON编辑器或表单）
4. 确认创建

---

### 任务顺序执行计划

由于 Session 1 的 Workflow 引擎未完成，先做可独立的部分：

1. **任务4a**（审核发布按钮）→ 独立，不依赖任何
2. **任务4b**（能力审核后端）→ 独立
3. **任务4c**（能力审核Tab）→ 依赖4b
4. **任务3a**（能力聚合视图）→ 独立，不依赖Workflow引擎
5. **任务3b**（能力创建向导）→ 独立

---

## 全局约束

- 所有代码在 `d:\temp\ai-assistant\` 项目根目录下
- 前端使用 Bootstrap 5.3 深色主题（`custom-theme.css`）
- API 路径统一以 `/api/` 开头
- 只加不删 server.js 路由注册行
- 修改文件必须先 Read 再 Edit
- 测试通过后更新进展.md