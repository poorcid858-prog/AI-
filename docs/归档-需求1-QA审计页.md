# 归档：需求 1 — QA 审计页

> **状态**：✅ 已完成（编码 + 测试通过）
> **对应需求文档**：`docs/需求文档.md` 第六章
> **技术方案**：`docs/技术方案-QA审计页.md`

## 功能概述

管理员专用的 QA 审计页面，用于查看所有用户的问答历史记录，包括对话详情、RAG 召回 chunk 详情。

## 实现内容

### API 端点
- `GET /api/admin/qa-history` — session 列表（支持搜索 + 角色筛选 + 分页）
- `GET /api/admin/qa-history/:sessionId` — session 详情（含完整 record + ragChunks）

### 前端页面
- `public/admin-qa.html` — 列表视图（所有 session）+ 详情视图（对话流 + 召回详情）

### 测试
- `test/admin-qa.test.js` — 5 个单元测试（空库、列表排序、创建、详情、404）

## 涉及文件
- `routes/admin.js` — 新增 2 个 API 端点
- `public/admin-qa.html` — 前端页面
- `test/admin-qa.test.js` — 测试文件

## 验证方式
浏览器访问 `http://localhost:3000/admin-qa.html`，用 admin 身份登录查看问答历史。