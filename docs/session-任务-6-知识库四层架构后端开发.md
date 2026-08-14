# Session 任务 6：知识库四层架构后端开发

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 14 小时 |
| 难度 | 高 |
| 依赖 | 任务 1（知识库可访问）、任务 2（权限） |
| 类型 | 数据库设计 + 后端功能开发 |
| 相关文档 | `docs/任务包-E-知识库四层架构.md` |

---

## 问题描述

知识库缺少层级化设计。需要实现四层架构：
1. 第1层：原始文档（Raw Document）
2. 第2层：标准化文档（Standardized Document）
3. 第3层：Chunk（文档片段）
4. 第4层：向量化数据（Embedding）

每一层都能追踪回上一层，用于运营分析和质量修复。

本任务负责**后端**（数据库、数据清洗、追踪逻辑）。前端由任务 7 负责。

---

## 核心需求

### 四层数据流
```
用户上传文件
    ↓ (保存为原始文档)
第1层：原始文档 (documents 表)
    ↓ (清洗、规整、打标签)
第2层：标准化文档 (standardized_documents 表)
    ↓ (按策略切分)
第3层：Chunk (chunks 表)
    ↓ (向量化)
第4层：向量化数据 (embeddings 表)
```

### 追踪链路
```
Chunk_ID → Standardized_Doc_ID → Doc_ID → 原始文件
```

---

## 需要做什么

### 步骤 1：数据库设计和迁移（3小时）

创建四层表结构：

```sql
-- 第1层：原始文档
CREATE TABLE documents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  file_size INT,
  uploader INT,
  upload_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  review_status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  file_path VARCHAR(500),
  metadata JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 第2层：标准化文档
CREATE TABLE standardized_documents (
  id INT PRIMARY KEY AUTO_INCREMENT,
  doc_id INT NOT NULL,
  processed_content LONGTEXT,
  tags JSON,
  keywords JSON,
  category VARCHAR(100),
  processing_status VARCHAR(50),
  processed_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

-- 第3层：Chunk
CREATE TABLE chunks (
  id INT PRIMARY KEY AUTO_INCREMENT,
  standardized_doc_id INT NOT NULL,
  doc_id INT NOT NULL,
  chunk_content TEXT,
  position VARCHAR(100),
  chunk_order INT,
  split_strategy VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (standardized_doc_id) REFERENCES standardized_documents(id),
  FOREIGN KEY (doc_id) REFERENCES documents(id)
);

-- 第4层：向量化数据
CREATE TABLE embeddings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  chunk_id INT NOT NULL,
  embedding_vector JSON,
  embedding_model VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (chunk_id) REFERENCES chunks(id)
);
```

**步骤**：
- [ ] 分析现有知识库表结构
- [ ] 设计新的四层表结构
- [ ] 创建迁移脚本（确保现有数据不丢失）
- [ ] 执行迁移

### 步骤 2：文档处理功能（6小时）

实现文档的清洗、标准化、切分功能。创建 `lib/document-processor.js`：

```javascript
// 清洗函数：去除特殊符号、多余空格等
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')  // 多余空格
    .trim();
}

// 规整函数：修复格式、术语等
function normalizeText(text) {
  // 修复常见的格式问题
  return text;
}

// 去重函数：去除重复内容
function deduplicateText(text) {
  // 去除重复段落
  return text;
}

// 打标签函数：添加分类标签、关键词
function tagDocument(text) {
  return {
    tags: ['tag1', 'tag2'],
    keywords: ['keyword1', 'keyword2'],
    category: 'category'
  };
}

// 标准化文档
async function standardizeDocument(docId) {
  // 1. 读取原始文档内容
  // 2. 清洗
  // 3. 规整
  // 4. 去重
  // 5. 打标签
  // 6. 保存到 standardized_documents 表
}
```

### 步骤 3：Chunk 切分功能（3小时）

实现文档切分逻辑。创建 `lib/chunking.js`：

```javascript
// Chunk 切分策略
class ChunkingSplitter {
  // 按 Token 数切分
  splitByTokens(text, maxTokens = 1000, overlap = 100) {
    // 将文本分成多个 chunk
    // 每个 chunk 最多 maxTokens 个 token
    // 相邻 chunk 有 overlap 重叠
  }

  // 按副标题切分
  splitByHeaders(text, headerLevel = 3) {
    // 按标题切分文本
    // 标题级别可配置
  }
}

// 调用示例
const splitter = new ChunkingSplitter();
const chunks = splitter.splitByTokens(text, 1000, 100);

// 保存 chunk
async function saveChunks(docId, stdDocId, chunks, strategy) {
  for (let i = 0; i < chunks.length; i++) {
    // 保存到 chunks 表
  }
}
```

### 步骤 4：向量化功能（2小时）

对 Chunk 进行向量化。可以使用现有的向量化模型：

```javascript
// 调用向量化 API（OpenAI、本地模型等）
async function embedChunks(chunks) {
  for (const chunk of chunks) {
    const embedding = await getEmbedding(chunk.content);
    // 保存到 embeddings 表
  }
}

// 或使用本地模型
const embedModel = require('some-embedding-library');
async function getEmbedding(text) {
  return embedModel.embed(text);
}
```

### 步骤 5：追踪 API（2小时）

实现追踪链路的 API。在 `routes/knowledge.js` 中：

```javascript
// 通过 Chunk ID 找到原始文档
router.get('/api/knowledge/chunk/:chunkId/trace', async (req, res) => {
  const chunk = await db.chunks.findById(req.params.chunkId);
  const stdDoc = await db.standardized_documents.findById(chunk.standardized_doc_id);
  const doc = await db.documents.findById(stdDoc.doc_id);
  res.json({ chunk, stdDoc, doc });
});

// 获取四层数据
router.get('/api/knowledge/doc/:docId/layers', async (req, res) => {
  const doc = await db.documents.findById(req.params.docId);
  const stdDocs = await db.standardized_documents.find({ doc_id: req.params.docId });
  const chunks = await db.chunks.find({ doc_id: req.params.docId });
  const embeddings = await db.embeddings.find({ ... });
  res.json({ doc, stdDocs, chunks, embeddings });
});
```

### 步骤 6：文档上传流程修改（1小时）

修改现有的文档上传接口，集成四层处理：

```javascript
// 修改 POST /api/knowledge/upload
router.post('/api/knowledge/upload', async (req, res) => {
  // 1. 保存原始文档
  const doc = await saveRawDocument(file);

  // 2. 标准化
  await standardizeDocument(doc.id);

  // 3. 切分
  const chunks = await splitDocument(doc.id);

  // 4. 向量化
  await embedChunks(chunks);

  res.json({ success: true, docId: doc.id });
});
```

---

## 验收标准

✅ 四层数据库表创建成功  
✅ 数据库迁移完成，现有数据保留  
✅ 文档清洗、规整、去重功能正常  
✅ Chunk 切分功能正常  
✅ 向量化功能正常  
✅ 追踪链路完整（从 Chunk 能追到原始文档）  
✅ 文档上传流程正常工作  
✅ 所有 API 正常工作  
✅ 单元测试和集成测试通过  
✅ `npm test` 全部通过  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 知识库四层架构后端实现"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况
- [ ] 等待任务 7（前端）完成后进行集成测试

---

## 重要提示

- ⚠️ 数据库迁移很关键，一定要充分测试
- ⚠️ 现有知识库数据一定不能丢失
- ⚠️ 追踪链路的设计很重要，影响后续的运营中心（任务 8）
- ⚠️ 向量化可能耗时，要考虑异步处理

---

## 与任务 7、8 的配合

- **任务 7（前端）**需要 API 来显示四层数据
- **任务 8（运营中心）**依赖这个任务的完整追踪链路

确保 API 设计稳定，文档完整。

---

## 依赖关系

- ✅ 任务 1、2 需要先完成
- 🔄 可与任务 5 并行进行
- 🔄 可与任务 7（前端）并行进行（但后端要先完成）
- ⚠️ 任务 8（运营中心）依赖这个任务