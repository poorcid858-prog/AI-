# Session 任务 7：知识库四层架构前端开发

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 12 小时 |
| 难度 | 中 |
| 依赖 | 任务 6（后端 API） |
| 类型 | 前端页面开发 |
| 相关文档 | `docs/任务包-E-知识库四层架构.md` |

---

## 问题描述

知识库前端需要支持四层视图，用户能看到：
1. 原始文档列表
2. 标准化文档列表
3. Chunk 列表（带预览）
4. 向量化数据列表

每层都能看到"来自哪个上一层"的信息，并能追踪回原始文档。

---

## 页面结构

```
知识库
├── 标签页切换
│   ├── 原始文档
│   ├── 标准化文档
│   ├── Chunk
│   └── 向量化数据
├── 搜索和筛选
├── 列表显示
└── 详情和追踪
```

---

## 需要做什么

### 步骤 1：创建知识库四层页面（3小时）

创建或修改 `public/knowledge.html`：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>知识库 - 四层管理</title>
  <link rel="stylesheet" href="css/knowledge.css">
</head>
<body>
  <div class="knowledge-container">
    <!-- 标签页 -->
    <div class="tabs">
      <button class="tab-btn active" data-layer="documents">原始文档</button>
      <button class="tab-btn" data-layer="standardized">标准化文档</button>
      <button class="tab-btn" data-layer="chunks">Chunk</button>
      <button class="tab-btn" data-layer="embeddings">向量化数据</button>
    </div>

    <!-- 搜索和筛选 -->
    <div class="controls">
      <input type="text" id="search" placeholder="搜索...">
      <button id="btn-new">新增</button>
    </div>

    <!-- 列表 -->
    <div id="content-area">
      <!-- 根据标签页动态加载 -->
    </div>

    <!-- 详情弹窗 -->
    <div id="detail-modal" class="modal">
      <div class="modal-content">
        <span class="close">&times;</span>
        <div id="detail-content"></div>
      </div>
    </div>
  </div>

  <script src="js/knowledge.js"></script>
</body>
</html>
```

### 步骤 2：实现 JavaScript 交互（6小时）

在 `public/js/knowledge.js` 中：

```javascript
// 标签页切换
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const layer = e.target.dataset.layer;
    loadLayer(layer);
  });
});

// 加载不同层的数据
async function loadLayer(layer) {
  const response = await fetch(`/api/knowledge/${layer}`);
  const data = await response.json();
  renderList(layer, data.items);
}

// 原始文档列表
function renderDocuments(items) {
  return items.map(doc => `
    <tr>
      <td>${doc.filename}</td>
      <td>${doc.file_type}</td>
      <td>${doc.uploader}</td>
      <td>${doc.upload_time}</td>
      <td><span class="status">${doc.review_status}</span></td>
      <td><a href="#" onclick="showDetail('doc', ${doc.id})">查看详情</a></td>
    </tr>
  `).join('');
}

// 标准化文档列表（显示来自哪个原始文档）
function renderStandardizedDocs(items) {
  return items.map(doc => `
    <tr>
      <td>${doc.id}</td>
      <td><a href="#" onclick="traceDocument(${doc.doc_id})">来自文档 ${doc.doc_id}</a></td>
      <td>${doc.category}</td>
      <td>${doc.tags.length} 个标签</td>
      <td><a href="#" onclick="showDetail('standardized', ${doc.id})">查看详情</a></td>
    </tr>
  `).join('');
}

// Chunk 列表（显示来自哪个标准化文档）
function renderChunks(items) {
  return items.map(chunk => `
    <tr>
      <td>${chunk.id}</td>
      <td><a href="#" onclick="traceChunk(${chunk.standardized_doc_id})">来自标准化文档 ${chunk.standardized_doc_id}</a></td>
      <td>${chunk.chunk_order}</td>
      <td>${chunk.chunk_content.substring(0, 100)}...</td>
      <td><a href="#" onclick="showDetail('chunk', ${chunk.id})">查看详情</a></td>
    </tr>
  `).join('');
}

// 追踪函数：从 Chunk 追踪回原始文档
async function traceChunk(chunkId) {
  const response = await fetch(`/api/knowledge/chunk/${chunkId}/trace`);
  const data = await response.json();
  showTraceModal(data);
}

// 显示详情
async function showDetail(layer, id) {
  const response = await fetch(`/api/knowledge/${layer}/${id}`);
  const data = await response.json();
  showModal(data);
}

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
  loadLayer('documents');
});
```

### 步骤 3：添加样式（2小时）

创建 `public/css/knowledge.css`：

```css
.knowledge-container {
  padding: 20px;
}

.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 2px solid #ddd;
}

.tab-btn {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  cursor: pointer;
  font-size: 16px;
}

.tab-btn.active {
  border-bottom-color: #007bff;
  color: #007bff;
}

.controls {
  margin-bottom: 20px;
  display: flex;
  gap: 10px;
}

#search {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  padding: 12px;
  border: 1px solid #ddd;
  text-align: left;
}

th {
  background: #f5f5f5;
  font-weight: bold;
}

tr:hover {
  background: #f9f9f9;
}

a {
  color: #007bff;
  cursor: pointer;
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

.modal {
  display: none;
  position: fixed;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.4);
}

.modal-content {
  background-color: #fefefe;
  margin: 5% auto;
  padding: 20px;
  border: 1px solid #888;
  width: 80%;
  border-radius: 4px;
}

.close {
  color: #aaa;
  float: right;
  font-size: 28px;
  font-weight: bold;
  cursor: pointer;
}
```

### 步骤 4：集成测试（1小时）

- [ ] 四个标签页都能正常显示
- [ ] 能看到每层数据来自哪个上一层
- [ ] 追踪功能正常（从 Chunk 追到原始文档）
- [ ] 搜索功能正常
- [ ] 所有链接都能点击

---

## 验收标准

✅ 知识库四层视图正常显示  
✅ 每层都能看到来源信息  
✅ 追踪功能正常工作  
✅ 搜索和筛选正常  
✅ UI 美观，符合系统风格  
✅ 响应式设计正常  
✅ 所有功能都能执行  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 知识库四层架构前端页面"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况

---

## 依赖关系

- ✅ 任务 6 需要先完成
- 🔄 可与任务 5、8 并行进行