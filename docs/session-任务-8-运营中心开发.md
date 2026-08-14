# Session 任务 8：运营中心开发

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 27 小时 |
| 难度 | 高 |
| 依赖 | 任务 6（知识库四层架构） |
| 类型 | 数据库设计 + API + 前端 |
| 相关文档 | `docs/任务包-F-运营中心.md` |

---

## 问题描述

缺少运营中心功能。运营人员需要能：
1. 查询所有用户的聊天记录
2. 通过 Chunk ID 追踪 AI 回答的知识来源
3. 分析聊天数据和 Chunk 使用情况

这个任务工作量大，包括数据库、后端、前端的完整实现。

---

## 三大功能模块

### 1. 聊天记录查询
- 按用户、日期筛选
- 搜索关键词
- 查看每条回答使用的 Chunk

### 2. Chunk 追踪（核心）
- 显示每条回答使用的 Chunk ID
- 点击 Chunk ID 跳转到知识库详情页
- 显示 Chunk 的使用统计

### 3. 分析统计
- 高频问题排行
- Chunk 使用热度
- 用户满意度趋势

---

## 需要做什么

这个任务工作量大（27小时），建议按以下顺序：

### 第1阶段：数据库和后端（14小时）

1. **数据库设计（2小时）**
   - chat_records 表（聊天记录）
   - chunk_usage 表（Chunk 使用统计）
   - question_analysis 表（问题分析）

2. **修改聊天接口（4小时）**
   - 每条回答时记录使用的 Chunk ID
   - 保存到 chat_records 和 chunk_usage 表

3. **API 开发（8小时）**
   - 聊天记录查询 API
   - Chunk 追踪 API
   - 统计分析 API

### 第2阶段：前端开发（10小时）

1. **创建运营中心页面（3小时）**
   - 左侧菜单（三大功能模块）
   - 中间列表区域
   - 右侧详情区域

2. **聊天记录查询界面（3小时）**
   - 搜索和筛选
   - 聊天记录表格
   - 显示 Chunk 使用信息

3. **Chunk 追踪界面（2小时）**
   - Chunk 详情显示
   - 使用统计
   - 最近的引用列表

4. **分析统计界面（2小时）**
   - KPI 卡片
   - 图表展示（高频问题、Chunk 热度等）

### 第3阶段：集成和测试（3小时）
- 与聊天系统集成
- 与知识库系统集成
- 功能测试
- 性能测试

---

## 核心工作内容

### 聊天接口修改
修改 `routes/chat.js` 中的聊天接口，记录 Chunk 使用：

```javascript
router.post('/api/chat', async (req, res) => {
  const question = req.body.question;
  
  // 1. 调用 AI 生成回答
  const answer = await generateAnswer(question);
  
  // 2. 获取使用的 Chunk ID
  const chunksUsed = answer.metadata.chunksUsed;
  
  // 3. 记录到数据库
  const chatRecord = await db.chat_records.create({
    user_id: req.user.id,
    question,
    answer: answer.text,
    chunks_used: JSON.stringify(chunksUsed),
    chat_time: new Date()
  });
  
  // 4. 记录 Chunk 使用
  for (const chunk of chunksUsed) {
    await db.chunk_usage.create({
      chunk_id: chunk.id,
      chat_record_id: chatRecord.id,
      relevance_score: chunk.score,
      used_time: new Date()
    });
  }
  
  res.json({ success: true, answer: answer.text });
});
```

### 运营中心页面结构
```html
<div class="operation-center">
  <!-- 左侧菜单 -->
  <div class="sidebar">
    <ul>
      <li><a href="#chat-records">聊天记录查询</a></li>
      <li><a href="#chunk-tracing">Chunk追踪</a></li>
      <li><a href="#analytics">分析统计</a></li>
    </ul>
  </div>

  <!-- 主内容区 -->
  <div class="content">
    <div id="chat-records" class="section">
      <!-- 聊天记录查询界面 -->
    </div>
    <div id="chunk-tracing" class="section">
      <!-- Chunk 追踪界面 -->
    </div>
    <div id="analytics" class="section">
      <!-- 分析统计界面 -->
    </div>
  </div>
</div>
```

---

## 验收标准

✅ 运营中心页面可以访问  
✅ 能查询所有聊天记录（带搜索、筛选、分页）  
✅ 能看到每条回答使用的 Chunk ID  
✅ 能点击 Chunk ID 跳转到知识库  
✅ 能查看 Chunk 的使用统计  
✅ 分析统计功能正常  
✅ 权限控制正确（只有运营人员能访问）  
✅ 性能良好（能快速查询大量数据）  
✅ UI 美观  
✅ 所有测试通过  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 运营中心开发（聊天记录、Chunk追踪、分析）"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况

---

## 重要提示

- ⚠️ 这个任务工作量大，可以分两个 session 做（一个做后端，一个做前端）
- ⚠️ 要确保 Chunk 追踪链路完整
- ⚠️ 涉及大量数据，要考虑性能优化（数据库索引、分页等）
- ⚠️ 修改聊天接口，一定要保证不影响现有功能

---

## 依赖关系

- ✅ 任务 6 需要先完成（知识库四层架构）
- 🔄 可与任务 5、7 并行进行
- ⚠️ 任务 9 可能依赖这个任务的某些数据