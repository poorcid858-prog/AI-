/**
 * M3: 知识中心后端数据模型重构测试
 *
 * 覆盖新模型：
 *   1. Document 实体创建与查询
 *   2. DocumentVersion 实体创建与版本管理
 *   3. 三元状态模型（review_status / processing_status / online_status）
 *   4. 版本号规则（向量化完成前不显示版本号）
 *   5. 元数据继承链（raw → std → chunk）
 *   6. document_id / version_id 字段在四层中传播
 *   7. 现有功能不崩溃（upload / review / publish / RAG）
 *
 * 测试隔离：同 knowledge-layers.test.js，临时改 config.paths.data。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');

// ============================================================
// 隔离夹具（同步执行！见 knowledge-layers.test.js 的警告）
// ============================================================

function withLayers(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-m3-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 快速创建一条完整文档链：Document → DocumentVersion → raw → std → chunks → vectors */
function seedFullChain(over = {}) {
  const doc = kl.createDocument({
    documentName: over.documentName || '测试文档',
    ...over.doc,
  });
  const version = kl.createDocumentVersion(doc.document_id, {
    sourceFileId: over.sourceFileId || 'raw_001',
    metadata: { knowledgeType: 'other', bizDomain: 'trade', securityLevel: 'internal', validUntil: '2027-12-31' },
    ...over.version,
  });
  const raw = kl.createRaw({
    title: '测试文档',
    fileName: 'test.md',
    content: over.content || '# 测试\n\n这是一段足够长的内容用于验证四层链路的完整流程。'.repeat(10),
    bizLine: 'trade',
    securityLevel: 'internal',
    documentId: doc.document_id,
    versionId: version.version_id,
    ...over.raw,
  });
  const std = kl.createStdVersion(raw.id, {
    content: '标准化后的文档内容',
    documentId: doc.document_id,
    versionId: version.version_id,
    ...over.std,
  });
  const chunks = kl.createChunks(std.id, over.chunks || [
    { content: '片段一：用户提交退款申请后系统进入审核环节。', heading: '退款' },
    { content: '片段二：审核时效为四十八小时内给出结论。', heading: '时效' },
  ]);
  const vectors = chunks.map((c) => kl.createVector(c.id, {
    model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main',
  }));
  return { doc, version, raw, std, chunks, vectors };
}

// ============================================================
// 1. Document 实体
// ============================================================

test('M3-1: createDocument 创建文档，返回 document_id 和初始字段', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '公司PRD规范' });
    assert.ok(doc.document_id, '应有 document_id');
    assert.ok(/^doc_\d+$/.test(doc.document_id), `document_id 格式不对: ${doc.document_id}`);
    assert.strictEqual(doc.document_name, '公司PRD规范');
    assert.strictEqual(doc.current_version_id, null, '初始无生效版本');
    assert.ok(doc.created_at, '应有 created_at');
    assert.ok(doc.updated_at, '应有 updated_at');
  });
});

test('M3-2: getDocument 按 document_id 查找文档', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const found = kl.getDocument(doc.document_id);
    assert.ok(found);
    assert.strictEqual(found.document_id, doc.document_id);
    assert.strictEqual(found.document_name, '测试');
    assert.strictEqual(kl.getDocument('doc_nonexistent'), null);
  });
});

test('M3-3: listDocuments 返回所有文档', () => {
  withLayers(() => {
    kl.createDocument({ documentName: 'A' });
    kl.createDocument({ documentName: 'B' });
    const list = kl.listDocuments();
    assert.strictEqual(list.length, 2);
  });
});

// ============================================================
// 2. DocumentVersion 实体
// ============================================================

test('M3-4: createDocumentVersion 创建版本，version_number 从 0 开始（未完成向量化）', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const v = kl.createDocumentVersion(doc.document_id, {
      sourceFileId: 'raw_001',
      metadata: { knowledgeType: 'other' },
    });
    assert.ok(v.version_id, '应有 version_id');
    assert.ok(/^ver_\d+$/.test(v.version_id), `version_id 格式不对: ${v.version_id}`);
    assert.strictEqual(v.document_id, doc.document_id);
    assert.strictEqual(v.version_number, 0, '未完成向量化时 version_number 应为 0');
    assert.strictEqual(v.source_file_id, 'raw_001');
    assert.strictEqual(v.review_status, 'pending');
    assert.strictEqual(v.processing_status, 'not_processed');
    assert.strictEqual(v.online_status, 'not_online');
    assert.ok(v.metadata, '应有 metadata');
    assert.ok(v.created_at);
    assert.ok(v.updated_at);
  });
});

test('M3-5: 版本号规则 —— 完成向量化后 version_number 变为 V1', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const v = kl.createDocumentVersion(doc.document_id, {
      sourceFileId: 'raw_001',
      metadata: { knowledgeType: 'other' },
    });
    assert.strictEqual(v.version_number, 0, '创建时 version_number 为 0');

    // 标记处理完成
    const updated = kl.markVersionProcessingComplete(v.version_id);
    assert.strictEqual(updated.version_number, 1, '完成处理后 version_number 应为 1');

    // 再创建第二个版本，version_number 也应从 0 开始
    const v2 = kl.createDocumentVersion(doc.document_id, {
      sourceFileId: 'raw_002',
      metadata: { knowledgeType: 'other' },
    });
    assert.strictEqual(v2.version_number, 0, '新版本未完成向量化时也为 0');

    // 完成第二个版本
    const updated2 = kl.markVersionProcessingComplete(v2.version_id);
    assert.strictEqual(updated2.version_number, 2, '第二个版本完成后应为 V2');
  });
});

test('M3-6: getDocumentVersion 按 version_id 查找', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const v = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r1', metadata: {} });
    const found = kl.getDocumentVersion(v.version_id);
    assert.ok(found);
    assert.strictEqual(found.version_id, v.version_id);
    assert.strictEqual(kl.getDocumentVersion('ver_nonexistent'), null);
  });
});

test('M3-7: listVersionsByDocument 返回同一个文档的所有版本', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const v1 = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r1', metadata: {} });
    const v2 = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r2', metadata: {} });
    const versions = kl.listVersionsByDocument(doc.document_id);
    assert.strictEqual(versions.length, 2);
    // 按创建时间降序
    assert.strictEqual(versions[0].version_id, v2.version_id);
    assert.strictEqual(versions[1].version_id, v1.version_id);
  });
});

test('M3-8: updateDocumentVersion 更新版本字段', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const v = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r1', metadata: {} });
    const updated = kl.updateDocumentVersion(v.version_id, { review_status: 'approved' });
    assert.strictEqual(updated.review_status, 'approved');
    // 未修改的字段保留原值
    assert.strictEqual(updated.document_id, doc.document_id);
    assert.strictEqual(updated.source_file_id, 'r1');
  });
});

test('M3-9: updateDocumentVersion 不存在的版本返回 null', () => {
  withLayers(() => {
    const result = kl.updateDocumentVersion('ver_nonexistent', { review_status: 'approved' });
    assert.strictEqual(result, null);
  });
});

// ============================================================
// 3. 三元状态模型
// ============================================================

test('M3-10: 三元状态独立管理 —— 审核/处理/生效互不影响', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    let v = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r1', metadata: {} });

    // 审核通过
    v = kl.updateDocumentVersion(v.version_id, { review_status: 'approved' });
    assert.strictEqual(v.review_status, 'approved');
    assert.strictEqual(v.processing_status, 'not_processed', '审核不影响处理状态');
    assert.strictEqual(v.online_status, 'not_online', '审核不影响生效状态');

    // 处理中
    v = kl.updateDocumentVersion(v.version_id, { processing_status: 'processing' });
    assert.strictEqual(v.review_status, 'approved', '处理不影响审核状态');
    assert.strictEqual(v.processing_status, 'processing');
    assert.strictEqual(v.online_status, 'not_online', '处理不影响生效状态');

    // 上线
    v = kl.updateDocumentVersion(v.version_id, { online_status: 'online' });
    assert.strictEqual(v.review_status, 'approved', '上线不影响审核状态');
    assert.strictEqual(v.processing_status, 'processing', '上线不影响处理状态');
    assert.strictEqual(v.online_status, 'online');
  });
});

test('M3-11: 三元状态枚举值', () => {
  withLayers(() => {
    assert.strictEqual(kl.REVIEW_STATUS.PENDING, 'pending');
    assert.strictEqual(kl.REVIEW_STATUS.APPROVED, 'approved');
    assert.strictEqual(kl.REVIEW_STATUS.REJECTED, 'rejected');
    assert.strictEqual(kl.PROCESSING_STATUS.NOT_PROCESSED, 'not_processed');
    assert.strictEqual(kl.PROCESSING_STATUS.PROCESSING, 'processing');
    assert.strictEqual(kl.PROCESSING_STATUS.SUCCESS, 'success');
    assert.strictEqual(kl.PROCESSING_STATUS.FAILED, 'failed');
    assert.strictEqual(kl.ONLINE_STATUS.NOT_ONLINE, 'not_online');
    assert.strictEqual(kl.ONLINE_STATUS.ONLINE, 'online');
    assert.strictEqual(kl.ONLINE_STATUS.OFFLINE, 'offline');
  });
});

// ============================================================
// 4. 元数据继承链
// ============================================================

test('M3-12: 元数据继承链 —— raw 的 metadata 传播到 std 和 chunk', () => {
  withLayers(() => {
    const doc = kl.createDocument({ documentName: '测试' });
    const version = kl.createDocumentVersion(doc.document_id, {
      sourceFileId: 'raw_001',
      metadata: { knowledgeType: 'business_rule', bizDomain: 'CRM', securityLevel: 'internal', validUntil: '2027-12-31' },
    });
    const raw = kl.createRaw({
      title: '测试文档',
      fileName: 'test.md',
      content: '# 测试\n\n正文内容。',
      bizLine: 'trade',
      securityLevel: 'internal',
      documentId: doc.document_id,
      versionId: version.version_id,
      knowledgeType: 'business_rule',
      metadata: { bizDomain: 'CRM', validUntil: '2027-12-31' },
    });

    // std 创建时继承 raw 的 metadata
    const std = kl.createStdVersion(raw.id, {
      content: '标准化内容',
      documentId: doc.document_id,
      versionId: version.version_id,
    });
    assert.strictEqual(std.metadata?.knowledgeType, 'business_rule', 'std 应继承 knowledgeType');
    assert.strictEqual(std.metadata?.bizDomain, 'CRM', 'std 应继承 bizDomain');
    assert.strictEqual(std.metadata?.securityLevel, 'internal', 'std 应继承 securityLevel');
    assert.strictEqual(std.metadata?.validUntil, '2027-12-31', 'std 应继承 validUntil');

    // chunk 创建时继承 std 的 metadata
    const [chunk] = kl.createChunks(std.id, [
      { content: '片段正文内容足够长以便入库使用。', heading: '第一章' },
    ]);
    assert.strictEqual(chunk.metadata?.knowledgeType, 'business_rule', 'chunk 应继承 knowledgeType');
    assert.strictEqual(chunk.metadata?.bizDomain, 'CRM', 'chunk 应继承 bizDomain');
    assert.strictEqual(chunk.metadata?.securityLevel, 'internal', 'chunk 应继承 securityLevel');
    assert.strictEqual(chunk.metadata?.validUntil, '2027-12-31', 'chunk 应继承 validUntil');
  });
});

// ============================================================
// 5. document_id / version_id 字段在四层中传播
// ============================================================

test('M3-13: document_id 和 version_id 在四层中正确传播', () => {
  withLayers(() => {
    const { doc, version, raw, std, chunks, vectors } = seedFullChain();

    // raw 层
    assert.strictEqual(raw.documentId, doc.document_id);
    assert.strictEqual(raw.versionId, version.version_id);

    // std 层
    assert.strictEqual(std.documentId, doc.document_id);
    assert.strictEqual(std.versionId, version.version_id);

    // chunk 层
    for (const c of chunks) {
      assert.strictEqual(c.documentId, doc.document_id, `chunk ${c.id} 缺少 documentId`);
      assert.strictEqual(c.versionId, version.version_id, `chunk ${c.id} 缺少 versionId`);
    }

    // vector 层
    for (const v of vectors) {
      assert.strictEqual(v.documentId, doc.document_id, `vector ${v.id} 缺少 documentId`);
      assert.strictEqual(v.versionId, version.version_id, `vector ${v.id} 缺少 versionId`);
    }
  });
});

test('M3-14: 四层血缘链完整 —— vector 可追溯到 document', () => {
  withLayers(() => {
    const { doc, version, raw, std, chunks, vectors } = seedFullChain();
    const vec = vectors[0];
    const chunk = chunks.find((c) => c.id === vec.chunkId);
    assert.ok(chunk, 'vector 应指向 chunk');

    // 每一层都能通过父级 ID 追溯
    assert.strictEqual(vec.documentId, doc.document_id);
    assert.strictEqual(vec.versionId, version.version_id);
    assert.strictEqual(chunk.documentId, doc.document_id);
    assert.strictEqual(chunk.versionId, version.version_id);
  });
});

// ============================================================
// 6. 现有功能兼容性 —— 基本操作不崩溃
// ============================================================

test('M3-15: upload 流程兼容新模型（不报错）', () => {
  withLayers(() => {
    const docs = require('../lib/documents');
    const user = { username: 'admin', role: 'admin' };
    const result = docs.upload(user, {
      title: '兼容性测试',
      fileName: 'compat.md',
      content: '# 兼容性测试\n\n这是一段足够长的内容用于验证兼容性。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['测试'],
    });
    assert.ok(result, 'upload 应返回结果');
    assert.match(result.id, /^raw_/, '返回 id 应为 raw_ 前缀');
    assert.strictEqual(result.status, 'pending');
  });
});

test('M3-16: RAG 引擎 loadApprovedIndex 不崩溃', () => {
  withLayers(() => {
    const rag = require('../lib/rag-engine');
    const { index } = rag.loadApprovedIndex();
    assert.ok(index, 'RAG 索引应正常加载');
    assert.ok(Array.isArray(index.vectors));
  });
});

test('M3-17: 现有 listRetrievableVectors 不崩溃', () => {
  withLayers(() => {
    const vecs = kl.listRetrievableVectors();
    assert.ok(Array.isArray(vecs));
  });
});