/**
 * RAG 引擎 loadApprovedIndex 数据源切换测试 —— 阶段 7a
 *
 * 背景：第 7 步的 RAG 引擎原本从 data/documents.json 加载 approved 文档。
 * 阶段 7 完成了四层模型（raw / std / chunk / vector），loadApprovedIndex
 * 必须改为从四层表读数据，索引项的 status 语义从旧'approved'改为新'published'。
 *
 * 数据源决策（计划决策 6）：RAG 只入 PUBLISHED，不收 NEED_REVIEW —— 保持
 * 旧"approved"严格语义，APPROVED 状态绝不入索引。
 *
 * 与阶段 7b 的耦合：本文件的 6 个新测试只关心"索引里有几条"与"形状字段"，
 * 不直接调 permissionFilter（permissionFilter 仍判 'approved'，新测试用的
 * fixture 直接绕开它）。阶段 7b 改 permissionFilter 那一行后，permissionFilter
 * 测试会跟着改 fixture，但本文件不需要动。
 *
 * 测试隔离：本文件的所有用例**必须保持同步执行**。withFourLayer 改的是
 * 进程内全局 config.paths.data，async/await 混进来就破。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const rag = require('../lib/rag-engine');

// ============================================================
// 隔离夹具
// ============================================================

function withFourLayer(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-rag-load-${process.pid}`);
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

/**
 * 造一条 raw → std → chunks → vectors 的四层链
 * @param {Object} opts
 * @param {string} [opts.bizLine='trade']
 * @param {string} [opts.securityLevel='internal']
 * @param {string} [opts.content='默认内容：用户提交退款申请后系统进入审核环节的处理流程说明。']
 * @param {string} [opts.finalStatus='published']  DRAFT / PENDING / APPROVED / PUBLISHED
 * @param {Array<{content, heading?, keywords?}>} [opts.chunkInputs]
 */
function buildFourLayer(opts = {}) {
  const o = Object.assign({
    bizLine: 'trade',
    securityLevel: 'internal',
    content: '默认内容：用户提交退款申请后系统进入审核环节的处理流程说明。',
    finalStatus: 'published',
    chunkInputs: [
      { content: '片段一：用户提交退款申请后系统进入审核环节的处理流程说明。', heading: '退款' },
    ],
  }, opts);

  const raw = kl.createRaw({
    title: `doc-${o.bizLine}`,
    fileName: 'doc.md',
    fileType: 'md',
    fileSize: 100,
    content: o.content,
    knowledgeType: 'business_rule',
    bizLine: o.bizLine,
    securityLevel: o.securityLevel,
  });
  kl.markReady(raw.id);

  const std = kl.createStdVersion(raw.id, { content: o.content });
  const chunks = kl.createChunks(std.id, o.chunkInputs);
  // 每个 chunk 建一个 isCurrent 的 vector（listRetrievableVectors 只看 isCurrent）
  chunks.forEach((c) => {
    kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main' });
  });

  // 推到目标状态
  if (o.finalStatus === 'draft') {
    // 保持 DRAFT
  } else if (o.finalStatus === 'pending') {
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
  } else if (o.finalStatus === 'approved') {
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED);
  } else if (o.finalStatus === 'published') {
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED);
    kl.publishStd(std.id);
  } else {
    throw new Error(`未知的 finalStatus: ${o.finalStatus}`);
  }

  return { raw, std, chunks };
}

// ============================================================
// 6 个 TDD 用例 —— 阶段 7a 数据源切换
// ============================================================

test('t1: 完整流程（raw → ready → std → chunks → vectors → pending → approved → published）索引含 1 条', () => {
  withFourLayer(() => {
    const { chunks } = buildFourLayer({ finalStatus: 'published' });
    const { index, chunks: indexedChunks, byDoc, byFingerprint } = rag.loadApprovedIndex();
    assert.ok(index, '应返回 index');
    assert.ok(Array.isArray(indexedChunks), '应返回 chunks 数组');
    assert.strictEqual(indexedChunks.length, 1, '只入 PUBLISHED 的 1 条 chunk');
    assert.strictEqual(indexedChunks[0].id, chunks[0].id);
    assert.ok(byDoc && typeof byDoc === 'object', 'byDoc 应存在');
    assert.ok(byFingerprint && byFingerprint.size >= 1, 'byFingerprint 应能查到指纹');
  });
});

test('t2: DRAFT 状态不发布 → 索引含 0 条', () => {
  withFourLayer(() => {
    buildFourLayer({ finalStatus: 'draft' });
    const { index, chunks } = rag.loadApprovedIndex();
    assert.ok(index, 'index 仍要返回（合法空索引）');
    assert.strictEqual(chunks.length, 0, '草稿不入 RAG 库');
  });
});

test('t3: PENDING 状态不通过审核 → 索引含 0 条', () => {
  withFourLayer(() => {
    buildFourLayer({ finalStatus: 'pending' });
    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 0, '待审核不入 RAG 库');
  });
});

test('t4: APPROVED 状态不发布 → 索引含 0 条（决策 6：APPROVED 不入索引）', () => {
  withFourLayer(() => {
    buildFourLayer({ finalStatus: 'approved' });
    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 0, 'APPROVED 不入 RAG 库 —— 必须 publishStd 才行');
  });
});

test('t5: 3 个 raw（PUBLISHED / DRAFT / PENDING）→ 索引仅含 PUBLISHED 那 1 条', () => {
  withFourLayer(() => {
    const { chunks: pubChunks } = buildFourLayer({
      bizLine: 'trade', finalStatus: 'published',
    });
    buildFourLayer({ bizLine: 'membership', finalStatus: 'draft' });
    buildFourLayer({ bizLine: 'all', finalStatus: 'pending' });

    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 1, '只有 PUBLISHED 的 1 条入索引');
    assert.strictEqual(chunks[0].id, pubChunks[0].id);
  });
});

test('t6: 索引项形状含 id / content / bizLine / securityLevel / status / docId —— 与旧形状兼容', () => {
  withFourLayer(() => {
    const { raw } = buildFourLayer({
      bizLine: 'membership',
      securityLevel: 'secret',
      finalStatus: 'published',
    });
    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 1);
    const item = chunks[0];
    assert.ok(item.id, 'id 字段必须存在');
    assert.ok(item.content, 'content 字段必须存在');
    assert.strictEqual(item.bizLine, 'membership', 'bizLine 必须从 std 继承');
    assert.strictEqual(item.securityLevel, 'secret', 'securityLevel 必须从 std 继承');
    assert.strictEqual(item.status, 'published', 'status 必须是 published（PUBLISHED 状态）');
    // 关键兼容契约：docId 映射旧 doc.id（即 raw.id），按"原始文档"归组
    assert.strictEqual(item.docId, raw.id, 'docId 必须等于 rawId（与旧 doc.id 语义对齐）');
  });
});
