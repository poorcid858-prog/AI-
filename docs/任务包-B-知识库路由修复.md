# 任务包 B：知识库路由修复

## 问题描述
知识库页面出现 `Cannot GET /knowledge.html`，说明知识库路由缺失。

## 当前问题
- 访问 `http://localhost:3000/knowledge.html` 返回 404
- 管理后台负责了上传文档功能（这是知识库的功能）
- 需要理清路由归属

## 修复范围
- `server.js` — 静态资源路由（确认 public 目录已挂载）
- `public/` — 确认是否存在 knowledge.html（若不存在需新建）
- `routes/documents.js` — 确认文档 API 路由已注册
- `public/admin.html` — 移除文档上传功能（迁回知识库页）

## 检查清单
- [ ] public 目录静态资源路由正常
- [ ] knowledge.html 存在或新建
- [ ] /api/documents/* 路由正常
- [ ] 文档上传功能从管理后台迁移到知识库页
- [ ] 测试全部通过：`npm test`

## 验收标准
1. `/knowledge.html` 正常访问，不再 404
2. 知识库页可上传文档
3. 管理后台不再包含上传功能
4. 文档列表/上传/删除功能正常