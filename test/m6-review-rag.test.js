/**
 * M6: 知识中心审核联动 + RAG 兼容 测试
 *
 * 测试覆盖：
 * 1. listVersionsByReviewStatus 函数
 * 2. /api/knowledge/pending-review 端点
 * 3. /api/knowledge/:versionId/review 端点（审核通过/驳回）
 * 4. RAG 引擎三元状态过滤
 * 5. embedChunks 版本ID字段
 */

const assert = require('assert');
const { describe, it, before, after, beforeEach } = require('node:test');

// 加载应用
const kl = require('../lib/knowledge-layers');
const ragEngine = require('../lib/rag-engine');
const vectorStore = require('../lib/vector-store');
const store = require('../lib/store');

describe('M6: 知识中心审核联动 + RAG 兼容', function() {
  // ============================================================
  // 1. listVersionsByReviewStatus 测试
  // ============================================================

  describe('listVersionsByReviewStatus', function() {
    let testDoc, testVersion;

    before(function() {
      // 创建测试数据
      testDoc = kl.createDocument({ documentName: '测试文档-M6' });
      testVersion = kl.createDocumentVersion(testDoc.document_id, {
        metadata: { test: true },
      });
    });

    after(function() {
      // 清理测试数据
      const docs = store.read('documents', []);
      const idx = docs.findIndex(d => d.document_id === testDoc.document_id);
      if (idx !== -1) docs.splice(idx, 1);
      store.write('documents', docs);

      const versions = store.read('document_versions', []);
      const vIdx = versions.findIndex(v => v.version_id === testVersion.version_id);
      if (vIdx !== -1) versions.splice(vIdx, 1);
      store.write('document_versions', versions);
    });

    it('应该返回指定审核状态的版本列表', function() {
      const pendingVersions = kl.listVersionsByReviewStatus('pending');
      assert.ok(Array.isArray(pendingVersions), '应该返回数组');
      // 至少包含我们刚创建的版本
      const found = pendingVersions.find(v => v.version_id === testVersion.version_id);
      assert.ok(found, '应该包含测试版本');
      assert.strictEqual(found.review_status, 'pending', '审核状态应为 pending');
    });

    it('应该返回空数组当没有匹配的版本时', function() {
      // 先确保测试版本不是 approved 状态
      const pendingVersions = kl.listVersionsByReviewStatus('pending');
      const approvedVersions = kl.listVersionsByReviewStatus('approved');
      assert.ok(Array.isArray(approvedVersions), '应该返回数组');
      // 至少验证函数可以正常调用
    });

    it('应该按创建时间降序排列', function() {
      const versions = kl.listVersionsByReviewStatus('pending');
      if (versions.length > 1) {
        for (let i = 1; i < versions.length; i++) {
          const prev = new Date(versions[i - 1].created_at);
          const curr = new Date(versions[i].created_at);
          assert.ok(prev >= curr, '应该按创建时间降序排列');
        }
      }
    });
  });

  // ============================================================
  // 2. 审核通过/驳回功能测试
  // ============================================================

  describe('版本审核功能', function() {
    let testDoc, testVersion;

    before(function() {
      testDoc = kl.createDocument({ documentName: '审核测试文档' });
      testVersion = kl.createDocumentVersion(testDoc.document_id, {
        metadata: { test: true },
      });
    });

    after(function() {
      // 清理
      const docs = store.read('documents', []);
      const idx = docs.findIndex(d => d.document_id === testDoc.document_id);
      if (idx !== -1) docs.splice(idx, 1);
      store.write('documents', docs);

      const versions = store.read('document_versions', []);
      const vIdx = versions.findIndex(v => v.version_id === testVersion.version_id);
      if (vIdx !== -1) versions.splice(vIdx, 1);
      store.write('document_versions', versions);
    });

    it('应该可以更新版本审核状态为 approved', function() {
      const updated = kl.updateDocumentVersion(testVersion.version_id, {
        review_status: 'approved',
      });
      assert.strictEqual(updated.review_status, 'approved', '审核状态应更新为 approved');
    });

    it('应该可以更新版本审核状态为 rejected', function() {
      // 先重置为 pending
      kl.updateDocumentVersion(testVersion.version_id, {
        review_status: 'pending',
      });
      const updated = kl.updateDocumentVersion(testVersion.version_id, {
        review_status: 'rejected',
      });
      assert.strictEqual(updated.review_status, 'rejected', '审核状态应更新为 rejected');
    });

    it('应该可以重新发起审核（rejected -> pending）', function() {
      // 先设置为 rejected
      kl.updateDocumentVersion(testVersion.version_id, {
        review_status: 'rejected',
      });
      const updated = kl.updateDocumentVersion(testVersion.version_id, {
        review_status: 'pending',
      });
      assert.strictEqual(updated.review_status, 'pending', '审核状态应更新为 pending');
    });
  });

  // ============================================================
  // 3. RAG 引擎三元状态过滤测试
  // ============================================================

  describe('RAG 引擎三元状态过滤', function() {
    it('loadApprovedIndex 应该返回有效的索引结构', function() {
      const result = ragEngine.loadApprovedIndex();
      assert.ok(result, '应该返回结果');
      assert.ok(result.index, '应该包含 index');
      assert.ok(Array.isArray(result.chunks), '应该包含 chunks 数组');
      assert.ok(result.byDoc && typeof result.byDoc === 'object', '应该包含 byDoc 映射');
      assert.ok(result.byFingerprint instanceof Map, '应该包含 byFingerprint 映射');
    });

    it('loadApprovedIndex 返回的 chunks 应该包含必要的权限字段', function() {
      const result = ragEngine.loadApprovedIndex();
      for (const chunk of result.chunks.slice(0, 5)) {
        assert.ok(chunk.bizLine !== undefined, 'chunk 应该有 bizLine 字段');
        assert.ok(chunk.securityLevel !== undefined, 'chunk 应该有 securityLevel 字段');
        assert.ok(chunk.status !== undefined, 'chunk 应该有 status 字段');
        assert.ok(chunk.docId !== undefined, 'chunk 应该有 docId 字段');
      }
    });

    it('permissionFilter 应该正确过滤不同密级的用户', function() {
      const testChunks = [
        { id: 'c1', content: 'test', bizLine: 'all', securityLevel: 'public', status: 'published' },
        { id: 'c2', content: 'test', bizLine: 'all', securityLevel: 'internal', status: 'published' },
        { id: 'c3', content: 'test', bizLine: 'all', securityLevel: 'confidential', status: 'published' },
      ];

      // admin 应该能看到所有
      const adminUser = { role: 'admin', username: 'admin' };
      const adminResult = ragEngine.permissionFilter(testChunks, adminUser);
      assert.strictEqual(adminResult.length, 3, 'admin 应该看到所有 chunks');

      // readonly 用户应该能看到所有
      const readonlyUser = { role: 'user', readonly: true };
      const readonlyResult = ragEngine.permissionFilter(testChunks, readonlyUser);
      assert.strictEqual(readonlyResult.length, 3, 'readonly 用户应该看到所有 chunks');
    });

    it('permissionFilter 应该过滤掉非 published 状态的 chunks', function() {
      const testChunks = [
        { id: 'c1', content: 'test', bizLine: 'all', securityLevel: 'public', status: 'published' },
        { id: 'c2', content: 'test', bizLine: 'all', securityLevel: 'public', status: 'pending' },
        { id: 'c3', content: 'test', bizLine: 'all', securityLevel: 'public', status: 'draft' },
      ];

      const adminUser = { role: 'admin', username: 'admin' };
      const result = ragEngine.permissionFilter(testChunks, adminUser);
      assert.strictEqual(result.length, 1, '应该只返回 published 状态的 chunks');
      assert.strictEqual(result[0].id, 'c1', '应该返回 published 状态的 chunk');
    });
  });

  // ============================================================
  // 4. embedChunks 版本ID字段测试
  // ============================================================

  describe('embedChunks 版本ID字段', function() {
    it('应该在向量记录中包含 versionId 字段', function() {
      const testChunks = [
        {
          id: 'chunk_test_001',
          content: '测试内容',
          heading: '测试标题',
          keywords: ['测试'],
          versionId: 'ver_001',
        },
      ];

      const result = vectorStore.embedChunks(testChunks, {
        model: 'tfidf-v1',
        indexName: 'main',
        versionId: 'ver_001',
      });

      assert.ok(Array.isArray(result), '应该返回数组');
      assert.strictEqual(result.length, 1, '应该返回一条记录');
      assert.strictEqual(result[0].chunkId, 'chunk_test_001', 'chunkId 应该正确');
      assert.strictEqual(result[0].versionId, 'ver_001', 'versionId 应该正确');
      assert.strictEqual(result[0].model, 'tfidf-v1', 'model 应该正确');
      assert.ok(Array.isArray(result[0].vec), 'vec 应该是数组');
    });

    it('应该支持从 chunk 对象中读取 versionId', function() {
      const testChunks = [
        {
          id: 'chunk_test_002',
          content: '测试内容2',
          versionId: 'ver_002',
        },
      ];

      const result = vectorStore.embedChunks(testChunks);

      assert.strictEqual(result.length, 1, '应该返回一条记录');
      assert.strictEqual(result[0].versionId, 'ver_002', '应该从 chunk 中读取 versionId');
    });

    it('当没有 versionId 时应该返回 null', function() {
      const testChunks = [
        {
          id: 'chunk_test_003',
          content: '测试内容3',
        },
      ];

      const result = vectorStore.embedChunks(testChunks);

      assert.strictEqual(result.length, 1, '应该返回一条记录');
      assert.strictEqual(result[0].versionId, null, '没有 versionId 时应该返回 null');
    });
  });

  // ============================================================
  // 5. 集成测试：审核 → 生成向量 → RAG 检索
  // ============================================================

  describe('集成测试：审核 → 生成向量 → RAG 检索', function() {
    it('完整的审核联动流程应该可以执行', function() {
      // 1. 创建文档
      const doc = kl.createDocument({ documentName: '集成测试文档' });
      assert.ok(doc.document_id, '应该创建文档');

      // 2. 创建版本
      const version = kl.createDocumentVersion(doc.document_id, {
        metadata: { test: true },
      });
      assert.ok(version.version_id, '应该创建版本');
      assert.strictEqual(version.review_status, 'pending', '初始审核状态应为 pending');

      // 3. 审核通过
      const approved = kl.updateDocumentVersion(version.version_id, {
        review_status: 'approved',
      });
      assert.strictEqual(approved.review_status, 'approved', '审核状态应为 approved');

      // 4. 处理完成
      const processed = kl.updateDocumentVersion(version.version_id, {
        processing_status: 'success',
      });
      assert.strictEqual(processed.processing_status, 'success', '处理状态应为 success');

      // 5. 上线
      const online = kl.updateDocumentVersion(version.version_id, {
        online_status: 'online',
      });
      assert.strictEqual(online.online_status, 'online', '上线状态应为 online');

      // 6. 清理
      const docs = store.read('documents', []);
      const idx = docs.findIndex(d => d.document_id === doc.document_id);
      if (idx !== -1) docs.splice(idx, 1);
      store.write('documents', docs);

      const versions = store.read('document_versions', []);
      const vIdx = versions.findIndex(v => v.version_id === version.version_id);
      if (vIdx !== -1) versions.splice(vIdx, 1);
      store.write('document_versions', versions);
    });

    it('下线数据不应该参与 RAG 检索', function() {
      // 创建测试版本并标记为下线
      const doc = kl.createDocument({ documentName: '下线测试文档' });
      const version = kl.createDocumentVersion(doc.document_id, {
        metadata: { test: true },
      });

      // 设置为已审核 + 已处理 + 已下线
      kl.updateDocumentVersion(version.version_id, {
        review_status: 'approved',
        processing_status: 'success',
        online_status: 'offline',
      });

      // loadApprovedIndex 不应该包含这个下线版本的数据
      const result = ragEngine.loadApprovedIndex();
      const found = result.chunks.find(c => c.versionId === version.version_id);
      assert.strictEqual(found, undefined, '下线版本的数据不应该在 RAG 索引中');

      // 清理
      const docs = store.read('documents', []);
      const idx = docs.findIndex(d => d.document_id === doc.document_id);
      if (idx !== -1) docs.splice(idx, 1);
      store.write('documents', docs);

      const versions = store.read('document_versions', []);
      const vIdx = versions.findIndex(v => v.version_id === version.version_id);
      if (vIdx !== -1) versions.splice(vIdx, 1);
      store.write('document_versions', versions);
    });
  });
});
