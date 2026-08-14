# 任务包 H：运营中心

## PM 要求（来自问题7）
系统需要有一个**运营中心**，能看到所有用户的聊天记录，并且每天的聊天记录会显示AI输出本次使用的**ChunkID**，点击后可跳转到知识库的【Chunk】页面，用于**溯源召回的chunk内容**。

## 需求细节
- 运营中心展示所有用户的聊天记录
- 每条聊天记录显示对应AI回答使用的ChunkID
- 点击ChunkID可跳转到知识库Chunk页面，查看该Chunk的原始内容
- 依赖任务包F（知识库四层架构）的Chunk页面跳转

## 当前状态
- `lib/qa-store.js` — 存会话/问答，可能已有记录
- `lib/retrieval-snapshot.js` — 存检索快照，含ChunkID
- 需要确认聊天记录中是否关联了ChunkID

## 修复范围
- `routes/` — 新增运营中心API（如 `/api/operations`）
- `public/` — 新增运营中心页面（如 `operations.html`）
- `lib/qa-store.js` — 确认/扩展：聊天记录关联ChunkID
- `server.js` — 注册运营中心路由

## 验收标准
1. 运营中心页面展示所有用户的聊天记录
2. 每条记录显示AI回答的ChunkID（可多行展示不同Chunk）
3. 点击ChunkID能跳转到知识库Chunk页面
4. 跳转后能看到该Chunk对应内容
5. 支持按用户/日期过滤