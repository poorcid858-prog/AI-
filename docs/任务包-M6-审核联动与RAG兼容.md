# 任务包 M6：知识中心审核联动 + RAG 兼容 + 测试回归

> 对应 PM 问题：**问题3（知识中心重建）— 第四阶段：集成与回归**

---

## 1. 任务描述

将知识中心与审核中心联动（审核通过→显示"生成向量数据"），并确保 RAG 检索仍能使用重建后的数据。最后做全量测试回归。

## 2. 需求要点

### 2.1 审核联动（需求第8节）
- 审核中心"知识审核"Tab 展示待审核的文档版本列表（审核状态=待审核）
- 审核通过 → 原始文档页面显示"生成向量数据"
- 审核失败 → 显示"重新发起审核"

### 2.2 RAG 兼容（需求第36节）
- RAG 正常检索只使用：审核通过 + 处理完成 + 当前有效 + 已上线 的数据
- 下线数据即使保存在数据库，也不得参与正常检索

## 3. 修改清单

### 3.1 修改 `public/review.html`
- "知识审核"Tab 改用新 API（M3 的 `/api/knowledge/` 系列端点）
- 审核通过/驳回功能对接新数据模型
- 点击"审核通过"后，待审核列表移除该文档

### 3.2 修改 `routes/admin.js` 或 `routes/knowledge.js`
- 审核端点改为适配 Document/Version 模型：
  - `POST /api/knowledge/:versionId/review`（通过/驳回）
  - `POST /api/knowledge/:versionId/re-review`（重新发起审核）

### 3.3 修改 `lib/rag-engine.js` 适配新数据模型
- `loadApprovedIndex` 从新的 `DocumentVersion` + `Chunk` + `Vector` 数据建立索引
- 过滤条件：review_status=approved，processing_status=success，online_status=online
- 保留原有权限过滤（bizLine / securityLevel）

### 3.4 修改 `lib/vector-store.js` 适配
- `embedChunks` 适配新的 chunk 数据结构
- 向量记录带 version_id 字段

### 3.5 全量测试回归
- 运行 `npm test`，修复因数据模型变更导致的测试失败
- 为新增功能补齐测试用例（审核联动、RAG 过滤、异步处理）
- 记录测试数量变化到进展.md

## 4. 涉及文件

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `public/review.html` | 修改 | 知识审核 Tab 对接新 API |
| `lib/rag-engine.js` | 修改 | 适配新数据模型 |
| `lib/vector-store.js` | 修改 | 适配新数据结构 |
| `routes/knowledge.js` | 可能修改 | 审核端点 |
| `test/*` | 修改 | 适配新数据模型 |

## 5. 工作量

**预计：3-4 小时 | 难度：中**

## 6. 依赖

- **M3**（数据模型）
- **M4**（处理引擎）
- **M5**（前端页面）

## 7. 验收标准

- [ ] 审核中心"知识审核"Tab 能展示待审核文档，审核通过/驳回正常
- [ ] 审核通过后，原始文档页面显示"生成向量数据"按钮
- [ ] RAG 检索从新数据模型正常加载已发布数据
- [ ] 下线数据不参与 RAG 检索
- [ ] `npm test` 全量通过
- [ ] 新增测试覆盖：审核联动、RAG 过滤、异步处理
- [ ] 全链路：上传→审核→生成向量→上线→RAG 检索 正常跑通