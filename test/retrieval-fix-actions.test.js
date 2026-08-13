/**
 * 检索快照引擎——修复动作执行测试（需求 6：反向修复）
 *
 * 覆盖三种修复动作的真实执行链路 + 安全设计：
 *   SX1: executeFix 未确认直接拒绝（安全设计① —— 必须先影响预览确认）
 *   SX2: delete_doc 真实删除（片段与向量连带失效）
 *   SX3: reprocess 生成草稿版本，不覆盖旧版（安全设计② —— 先出草稿再生效）
 *   SX4: rewrite_doc 用新原文生成草稿版本
 *   SX5: 未知修复动作返回错误
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');

let snapshot;

function withIsolation(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-retrieval-exec-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    delete require.cache[require.resolve('../lib/retrieval-snapshot')];
    snapshot = require('../lib/retrieval-snapshot');
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

function buildPublishedDoc() {
  const content = '退款流程：用户提交退款申请后系统进入审核环节的处理流程说明。';
  const raw = kl.createRaw({
    title: '退款流程文档',
    fileName: 'refund.md',
    fileType: 'md',
    content,
    knowledgeType: 'business_rule',
    bizLine: 'trade',
    securityLevel: 'internal',
  });
  kl.markReady(raw.id);
  const std = kl.createStdVersion(raw.id, { content });
  const chunks = kl.createChunks(std.id, [
    { content: '用户提交退款申请后系统进入审核环节的处理流程说明。', heading: '退款流程' },
    { content: '审核通过后系统自动将退款金额原路返回至用户支付账户。', heading: '退款流程' },
  ]);
  chunks.forEach((c) => {
    kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main' });
  });
  kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED);
  kl.publishStd(std.id);
  return { raw, std, chunks };
}

test('SX1: executeFix 未确认直接拒绝（安全设计①）', () => {
  withIsolation(() => {
    const { raw } = buildPublishedDoc();
    // 无论动作合法与否，confirmed !== true 一律拒绝
    const res = snapshot.executeFix('delete_doc', { rawId: raw.id }); // 未带 confirmed
    assert.strictEqual(res.ok, false, '未确认应拒绝');
    assert.ok(res.error.includes('确认'), '错误信息应提示需确认');

    const res2 = snapshot.executeFix('delete_doc', { rawId: raw.id, confirmed: false });
    assert.strictEqual(res2.ok, false, 'confirmed=false 应拒绝');
  });
});

test('SX2: delete_doc 真实删除（片段与向量连带失效）', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    // 基线：删除前共有 3 层数据
    assert.strictEqual(kl.listRaws().length, 1);
    assert.strictEqual(kl.listStds().length, 1);
    assert.strictEqual(kl.listChunks().length, 2);
    assert.strictEqual(kl.listVectors().length, 2);

    const res = snapshot.executeFix('delete_doc', { rawId: raw.id, confirmed: true });
    assert.strictEqual(res.ok, true, '应成功删除');
    assert.strictEqual(res.rawCount, 1, '应删 1 个 raw');
    assert.strictEqual(res.stdCount, 1, '应删 1 个 std');
    assert.strictEqual(res.chunkCount, 2, '应删 2 个 chunk');
    assert.strictEqual(res.vectorCount, 2, '应删 2 个 vector 连带失效');

    // 连带失效后为空库
    assert.strictEqual(kl.listRaws().length, 0);
    assert.strictEqual(kl.listStds().length, 0);
    assert.strictEqual(kl.listChunks().length, 0);
    assert.strictEqual(kl.listVectors().length, 0);
  });
});

test('SX3: reprocess 生成草稿版本，不覆盖旧版（安全设计②）', () => {
  withIsolation(() => {
    const { raw, std } = buildPublishedDoc();
    const beforeStds = kl.listRaws().length;
    const versionBefore = std.procVersion;

    const res = snapshot.executeFix('reprocess', {
      rawId: raw.id,
      params: { splitMode: 'paragraph' },
      confirmed: true,
    });
    assert.strictEqual(res.ok, true, 'reprocess 应成功');
    assert.ok(res.draftStdId, '应生成草稿版本 std');
    assert.ok(res.draftProcVersion > versionBefore, '版本号应递增（不覆盖旧版）');
    assert.ok(res.newChunkCount >= 1, '新版本应切出片段');

    // 关键：原生效版本未被覆盖（isCurrent 仍是旧的）
    const rawNow = kl.getRaw(raw.id);
    assert.strictEqual(rawNow.currentStdId, std.id, '原生效版本仍生效，新版本只是草稿');
    const oldStd = kl.getStd(std.id);
    assert.strictEqual(oldStd.status, 'published', '原版本保持 published');

    // 新草稿
    const newStd = kl.getStd(res.draftStdId);
    assert.strictEqual(newStd.status, 'draft', '新版本必须先是 draft（草稿，不生效）');
    assert.strictEqual(newStd.isCurrent, false, '草稿不生效');
  });
});

test('SX4: rewrite_doc 用新原文生成草稿版本', () => {
  withIsolation(() => {
    const { raw, std } = buildPublishedDoc();
    const res = snapshot.executeFix('rewrite_doc', {
      rawId: raw.id,
      newContent: '全新内容：退款流程改为先联系客服登记，再进行系统审核。',
      confirmed: true,
    });
    assert.strictEqual(res.ok, true, 'rewrite_doc 应成功');
    assert.ok(res.draftStdId, '应生成草稿版本');

    const newStd = kl.getStd(res.draftStdId);
    assert.strictEqual(newStd.status, 'draft', '新版本是草稿');
    assert.strictEqual(newStd.isCurrent, false, '草稿不生效');
    assert.ok(newStd.content.includes('先联系客服登记'), '草稿内容应为新原文');
    // 旧版本仍在
    assert.strictEqual(kl.getStd(std.id).status, 'published', '旧版本保留 published');
  });
});

test('SX5: 未知修复动作返回错误', () => {
  withIsolation(() => {
    const { raw } = buildPublishedDoc();
    const res = snapshot.executeFix('not_a_real_action', { rawId: raw.id, confirmed: true });
    assert.strictEqual(res.ok, false, '未知动作应报错');
    assert.ok(res.error.includes('未知修复动作'), '错误信息应提示动作未知');
  });
});