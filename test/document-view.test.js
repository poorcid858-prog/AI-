/**
 * getDocumentView 纯函数测试 —— 阶段 1
 *
 * 覆盖：
 *   1. raw + 已发布 std + 1 chunk → 完整聚合视图
 *   2. raw 没有已发布 std（只有草稿）→ fallback 走 listStdByRaw[0]，视为 draft
 *   3. raw 不存在 → 返回 null
 *
 * 测试隔离：
 *   `node --test` 并行跑多个测试文件（各自独立进程），
 *   若直接读写真实 data/*.json 会互相覆盖导致随机失败。
 *   因此把 config.paths.data 临时指向本进程独占目录 ——
 *   store.filePath() 每次调用都重读 config，改指针即完全隔离。
 *
 *   **本文件所有用例必须保持同步执行。**
 *   一旦某个用例改成 async / 用 await，或给测试运行器开 concurrency，
 *   两个用例的 withTempDataDir 就会交错，后进入的那个会把 config.paths.data
 *   改到自己的目录，前一个用例剩下的断言于是读到别人的库 ——
 *   隔离静默失效，表现为随机失败或更糟的"随机通过"。
 *
 * 临时目录放在 os.tmpdir()：不能放在 test/ 下面，
 * `npm test` 的 glob 是 test/**\/*.test.js，临时目录残留会被当成测试文件扫。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const docs = require('../lib/documents');

// ============================================================
// 隔离夹具
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-dv-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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

/** 造一个原始文档 */
function makeRaw(over = {}) {
  return kl.createRaw({
    title: '退款流程',
    fileName: 'refund.md',
    content: '# 退款流程\n\n用户提交退款申请。',
    tags: ['退款'],
    uploadedBy: 'admin',
    bizLine: 'trade',
    securityLevel: 'internal',
    createdAt: '2026-08-12T00:00:00Z',
    ...over,
  });
}

/** 把草稿 std 推到 published —— 走完整合法路径 DRAFT → PENDING → APPROVED → PUBLISHED */
function publishStdFromDraft(stdId) {
  kl.setStdStatus(stdId, kl.STD_STATUS.PENDING);
  kl.setStdStatus(stdId, kl.STD_STATUS.APPROVED);
  return kl.publishStd(stdId);
}

// ============================================================
// 1. raw + 已发布 std + chunks → 完整聚合视图
// ============================================================

test('getDocumentView：raw 聚合 published std + 1 chunk，字段完整 + chunks 投影正确', () => {
  withTempDataDir(() => {
    const r1 = makeRaw();
    const s1 = kl.createStdVersion(r1.id, { content: '标准化正文' });
    // chunks 必须在 publish 之前追加 —— 已发布版本的片段被锁死（CHUNK_APPENDABLE 不含 published），
    // 这是 I6 防泄漏的硬约束：要改已发布内容只能新建版本重走审。
    kl.createChunks(s1.id, [{
      content: '退款步骤 1', heading: '第一步', keywords: ['退款', '步骤'], fingerprint: 'fp_1',
    }]);
    kl.markReady(r1.id);
    publishStdFromDraft(s1.id);

    const view = docs.getDocumentView(r1.id);

    // 元数据
    assert.strictEqual(view.id, r1.id);
    assert.strictEqual(view.title, '退款流程');
    assert.strictEqual(view.bizLine, 'trade');
    assert.strictEqual(view.securityLevel, 'internal');
    assert.strictEqual(view.tags.length, 1);
    assert.strictEqual(view.tags[0], '退款');
    assert.strictEqual(view.uploadedBy, 'admin');
    assert.strictEqual(view.createdAt, '2026-08-12T00:00:00Z');

    // 状态映射
    assert.strictEqual(view.chunkCount, 1);
    assert.strictEqual(view.status, 'approved', 'PUBLISHED 应映射到旧 3 值的 approved');
    assert.strictEqual(view.lifecycleStatus, 'published');

    // chunks 投影：保留 id / seq / heading / keywords / content
    assert.ok(view.chunks[0].id, 'chunks[0] 应有 id');
    assert.strictEqual(view.chunks[0].content, '退款步骤 1');
    assert.strictEqual(view.chunks[0].heading, '第一步');
    assert.strictEqual(view.chunks[0].keywords.length, 2);
    assert.deepStrictEqual([view.chunks[0].keywords[0], view.chunks[0].keywords[1]], ['退款', '步骤']);

    // 投影出去：chunks 上不该带权限判据字段（防泄漏到调用方）
    assert.strictEqual(view.chunks[0].bizLine, undefined, 'chunks 投影不应带 bizLine');
    assert.strictEqual(view.chunks[0].securityLevel, undefined, 'chunks 投影不应带 securityLevel');
    assert.strictEqual(view.chunks[0].status, undefined, 'chunks 投影不应带 status');
  });
});

// ============================================================
// 2. raw 没有已发布 std → 走 fallback，视为 draft
// ============================================================

test('getDocumentView：raw 有草稿 std 但未发布，fallback 走 listStdByRaw[0]，视为 draft', () => {
  withTempDataDir(() => {
    const r2 = makeRaw({ title: '草稿文档', fileName: 'draft.md' });
    // 只建一个草稿 std，不调 publishStd
    kl.createStdVersion(r2.id, { content: '还在打磨的草稿' });

    const view = docs.getDocumentView(r2.id);

    assert.strictEqual(view.id, r2.id);
    assert.strictEqual(view.status, 'pending', '无 published std 时映射到旧 3 值的 pending');
    assert.strictEqual(view.lifecycleStatus, 'draft', 'fallback 拿到的草稿 std 状态为 draft');
    assert.strictEqual(view.chunkCount, 0);
    assert.deepStrictEqual(view.chunks, []);
  });
});

// ============================================================
// 3. raw 不存在 → 返回 null
// ============================================================

test('getDocumentView：raw 不存在返回 null', () => {
  withTempDataDir(() => {
    assert.strictEqual(docs.getDocumentView('raw_不存在的id'), null);
  });
});

// ============================================================
// 4. LIFECYCLE_TO_OLD 8 状态全覆盖
// ============================================================
//
// 契约：status 字段是给前端/老 upload/review 链路用的 3 值兼容层。
// 一旦某个映射值写错，前端 UI 会拿错状态（且类型系统抓不到 — 都是字符串）。
// 所以这里逐状态锁死，不依赖 test 1/2 的间接覆盖。

/** 给一个 std 推到目标状态（走合法路径） */
function driveStdTo(stdId, target) {
  const S = kl.STD_STATUS;
  switch (target) {
    case S.DRAFT:      return; // createStdVersion 默认就是 draft
    case S.QC_FAILED:  kl.setStdStatus(stdId, S.QC_FAILED); return;
    case S.PENDING:    kl.setStdStatus(stdId, S.PENDING); return;
    case S.REJECTED:   kl.setStdStatus(stdId, S.PENDING); kl.setStdStatus(stdId, S.REJECTED); return;
    case S.APPROVED:   kl.setStdStatus(stdId, S.PENDING); kl.setStdStatus(stdId, S.APPROVED); return;
    case S.PUBLISHED:  kl.setStdStatus(stdId, S.PENDING); kl.setStdStatus(stdId, S.APPROVED); kl.publishStd(stdId); return;
    case S.NEED_REVIEW:kl.setStdStatus(stdId, S.PENDING); kl.setStdStatus(stdId, S.APPROVED); kl.publishStd(stdId); kl.markNeedReview(stdId); return;
    case S.ARCHIVED:   kl.setStdStatus(stdId, S.PENDING); kl.setStdStatus(stdId, S.REJECTED); kl.setStdStatus(stdId, S.ARCHIVED); return;
    default: throw new Error('未支持的目标状态: ' + target);
  }
}

const EXPECTED_OLD = {
  draft:       'pending',
  qc_failed:   'pending',
  pending:     'pending',
  approved:    'pending',
  published:   'approved',
  need_review: 'approved',
  rejected:    'rejected',
  archived:    'rejected',
};

for (const [lifecycle, expectedOld] of Object.entries(EXPECTED_OLD)) {
  test(`LIFECYCLE_TO_OLD：${lifecycle} → status='${expectedOld}'，lifecycleStatus='${lifecycle}'`, () => {
    withTempDataDir(() => {
      const r = makeRaw({ title: `${lifecycle} 文档` });
      const s = kl.createStdVersion(r.id, { content: '...' });
      driveStdTo(s.id, kl.STD_STATUS[lifecycle.toUpperCase()]);
      const view = docs.getDocumentView(r.id);
      assert.strictEqual(view.status, expectedOld, `${lifecycle} 应映射为 ${expectedOld}`);
      assert.strictEqual(view.lifecycleStatus, lifecycle, `lifecycleStatus 应原样透传 ${lifecycle}`);
    });
  });
}

// ============================================================
// 5. raw 已 markReady 但无任何 std → 纯草稿兜底分支
// ============================================================

test('getDocumentView：raw markReady 了但还没 createStdVersion，视为 draft', () => {
  withTempDataDir(() => {
    const r = makeRaw({ title: '纯草稿' });
    kl.markReady(r.id);
    // 不调 createStdVersion
    const view = docs.getDocumentView(r.id);
    assert.strictEqual(view.id, r.id);
    assert.strictEqual(view.status, 'pending');
    assert.strictEqual(view.lifecycleStatus, 'draft');
    assert.strictEqual(view.chunkCount, 0);
    assert.deepStrictEqual(view.chunks, []);
  });
});
