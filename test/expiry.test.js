/**
 * 需求 9：文档过期管理与自动归档测试
 *
 * 覆盖：
 *   1. 上传时设置有效时间
 *   2. 到期自动触发复审（published → need_review）
 *   3. 逾期未复审降级为 need_review（published → need_review）
 *   4. 手动下架（published → archived）
 *   5. 批量替换：新文档替换旧文档，旧文档自动归档
 *   6. 日报告包含到期文档列表
 *   7. 过期检查扫描函数
 *   8. 待复审文档仍可检索，但标注可能过期
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const expiry = require('../lib/expiry');

// ============================================================
// 隔离夹具（与 knowledge-layers.test.js 一致）
// ============================================================

function withLayers(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-expiry-${process.pid}`);
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

/** 造一个原始文档（带 validUntil） */
function seedRaw(over = {}) {
  return kl.createRaw({
    title: '退款流程规范',
    fileName: 'refund.md',
    fileType: 'md',
    fileSize: 1234,
    content: '# 退款流程\n\n用户提交退款申请后进入审核环节。',
    knowledgeType: 'business_rule',
    version: 'v1.2',
    tags: ['退款'],
    owner: 'pm_zhang',
    uploadedBy: 'admin',
    bizLine: 'trade',
    securityLevel: 'confidential',
    ...over,
  });
}

/** 造一条完整四层链到 published 状态 */
function seedPublishedTree(over = {}) {
  const raw = seedRaw(over.raw);
  const std = kl.createStdVersion(raw.id, { content: '标准化后的退款流程全文', ...over.std });
  const chunks = kl.createChunks(std.id, over.chunks || [
    { content: '片段一：用户提交退款申请后系统进入审核环节。', heading: '退款' },
    { content: '片段二：审核时效为四十八小时内给出结论。', heading: '时效' },
  ]);
  chunks.forEach((c) => kl.createVector(c.id, {
    model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main',
  }));
  // 推到 published
  kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED, { reviewedBy: 'reviewer_li' });
  kl.publishStd(std.id);
  return { raw, std, chunks };
}

/** 推动 std 到指定状态（沿合法路径） */
function driveStdTo(stdId, target) {
  const S = kl.STD_STATUS;
  switch (target) {
    case S.DRAFT: return kl.getStd(stdId);
    case S.ARCHIVED:
      kl.setStdStatus(stdId, S.PENDING);
      kl.setStdStatus(stdId, S.APPROVED);
      kl.publishStd(stdId);
      return kl.archiveStd(stdId);
    case S.PUBLISHED:
      kl.setStdStatus(stdId, S.PENDING);
      kl.setStdStatus(stdId, S.APPROVED);
      return kl.publishStd(stdId);
    default:
      throw new Error(`未知目标状态: ${target}`);
  }
}

// ============================================================
// 1. 有效期管理
// ============================================================

test('有效期管理：createRaw 支持 validUntil 字段', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ validUntil: future });
    assert.strictEqual(raw.validUntil, future, 'validUntil 应被写入');
  });
});

test('有效期管理：不传 validUntil 时默认为 null', () => {
  withLayers(() => {
    const raw = seedRaw();
    assert.strictEqual(raw.validUntil, null, '不传 validUntil 应为 null');
  });
});

test('有效期管理：getStd 继承 raw 的 validUntil', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ validUntil: future });
    const std = kl.createStdVersion(raw.id, { content: '测试内容' });
    // 四层模型中 validUntil 存在 raw 层，std 通过 rawId 关联
    // 有效期检查函数通过 raw 查找 validUntil
    const rawFromStd = kl.getRaw(std.rawId);
    assert.strictEqual(rawFromStd.validUntil, future);
  });
});

// ============================================================
// 2. 过期检查扫描
// ============================================================

test('有效期检查：scanExpiringDocs 返回即将过期的文档列表', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(); // 2天后
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const raw1 = seedRaw({ fileName: 'expiring.md', validUntil: future });
    const raw2 = seedRaw({ fileName: 'safe.md', validUntil: farFuture });
    // 都发布
    const std1 = kl.createStdVersion(raw1.id, { content: 'x' });
    driveStdTo(std1.id, kl.STD_STATUS.PUBLISHED);
    const std2 = kl.createStdVersion(raw2.id, { content: 'y' });
    driveStdTo(std2.id, kl.STD_STATUS.PUBLISHED);

    // 扫描未来 7 天内的到期文档
    const expiring = expiry.scanExpiringDocs(7);
    const ids = expiring.map((d) => d.rawId);
    assert.ok(ids.includes(raw1.id), '2天后到期的应出现在即将到期列表');
    assert.ok(!ids.includes(raw2.id), '365天后到期的不应出现在未来7天列表');
  });
});

test('有效期检查：scanExpiringDocs 返回空数组当无即将到期文档', () => {
  withLayers(() => {
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'safe.md', validUntil: farFuture });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const expiring = expiry.scanExpiringDocs(7);
    assert.deepStrictEqual(expiring, []);
  });
});

test('有效期检查：scanExpiringDocs 忽略未发布的文档', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'draft.md', validUntil: future });
    // 不发布，只在 draft 状态
    const std = kl.createStdVersion(raw.id, { content: 'x' });

    const expiring = expiry.scanExpiringDocs(7);
    assert.ok(!expiring.some((d) => d.rawId === raw.id), '未发布的文档不应出现在到期列表');
  });
});

test('有效期检查：scanExpiringDocs 忽略已归档的文档', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'archived.md', validUntil: future });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    kl.archiveStd(std.id); // 已归档

    const expiring = expiry.scanExpiringDocs(7);
    assert.ok(!expiring.some((d) => d.rawId === raw.id), '已归档的文档不应出现在到期列表');
  });
});

// ============================================================
// 3. 过期文档自动转为 need_review
// ============================================================

test('过期处理：processExpired 将已过期的 published 文档转为 need_review', () => {
  withLayers(() => {
    // 设置 validUntil 为昨天（已过期）
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'expired.md', validUntil: yesterday });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    const chunks = kl.createChunks(std.id, [{ content: '需要审核的片段正文内容足够长以便入库。' }]);
    chunks.forEach((c) => kl.createVector(c.id, { model: 'tfidf-v1', vec: [0.1, 0.9] }));
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const result = expiry.processExpired();
    assert.ok(result > 0, '应至少处理 1 个过期文档');

    const after = kl.getStd(std.id);
    assert.strictEqual(after.status, kl.STD_STATUS.NEED_REVIEW, '过期文档应转为 need_review');
    // 下游同步
    const chunksAfter = kl.listChunksByStd(std.id);
    assert.ok(chunksAfter.length > 0);
    assert.strictEqual(chunksAfter[0].status, kl.STD_STATUS.NEED_REVIEW, '下游片段应同步');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('过期处理：processExpired 跳过未过期的文档', () => {
  withLayers(() => {
    const farFuture = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'safe.md', validUntil: farFuture });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const result = expiry.processExpired();
    assert.strictEqual(result, 0, '未过期文档不应被处理');

    const after = kl.getStd(std.id);
    assert.strictEqual(after.status, kl.STD_STATUS.PUBLISHED, '未过期文档状态不变');
  });
});

test('过期处理：processExpired 跳过没有 validUntil 的文档', () => {
  withLayers(() => {
    const raw = seedRaw({ validUntil: undefined });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const result = expiry.processExpired();
    assert.strictEqual(result, 0, '无有效期的文档不受影响');
  });
});

test('过期处理：processExpired 跳过已归档的文档', () => {
  withLayers(() => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'archived-expired.md', validUntil: yesterday });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.ARCHIVED); // 已归档

    // 即使已过期，已归档的不应再被处理
    const result = expiry.processExpired();
    assert.strictEqual(result, 0, '已归档的过期文档不应被处理');

    const after = kl.getStd(std.id);
    assert.strictEqual(after.status, kl.STD_STATUS.ARCHIVED);
  });
});

test('过期处理：processExpired 跳过已经是 need_review 的文档', () => {
  withLayers(() => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'already-need-review.md', validUntil: yesterday });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    // 手动转为 need_review
    kl.markNeedReview(std.id);

    const result = expiry.processExpired();
    assert.strictEqual(result, 0, '已在 need_review 的文档不应重复处理');
  });
});

// ============================================================
// 4. 手动下架
// ============================================================

test('手动下架：手动下架后文档不进检索但保留原文', () => {
  withLayers(() => {
    const { raw, std, chunks } = seedPublishedTree();

    // 手动下架
    const archived = kl.archiveStd(std.id);
    assert.strictEqual(archived.status, kl.STD_STATUS.ARCHIVED, '下架后应为 archived');
    assert.strictEqual(archived.isCurrent, false, '下架后不应是生效版本');

    // 原文保留
    const rawAgain = kl.getRaw(raw.id);
    assert.ok(rawAgain, '原始文档应保留');
    assert.ok(rawAgain.content.includes('退款'), '原文内容应保留');

    // 不进检索
    const retrievable = kl.listRetrievableVectors().filter((v) => v.stdId === std.id);
    assert.strictEqual(retrievable.length, 0, '下架文档的向量不应参与检索');

    // 下游同步
    assert.strictEqual(kl.getChunk(chunks[0].id).status, kl.STD_STATUS.ARCHIVED);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('手动下架：已归档文档再次下架被拒（archived 是终态）', () => {
  withLayers(() => {
    const { std } = seedPublishedTree();
    kl.archiveStd(std.id);
    assert.throws(() => kl.archiveStd(std.id), (e) => e.status === 409, '二次归档应抛 409');
  });
});

// ============================================================
// 5. 批量替换
// ============================================================

test('批量替换：新文档发布时旧文档自动归档', () => {
  withLayers(() => {
    // 这个功能已经在 knowledge-layers 的 publishStd 中实现了
    // 发布新版本时，同 raw 下旧版本自动归档
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, { content: 'v1' });
    kl.createChunks(v1.id, [{ content: 'v1 的片段正文内容足够长以便入库。' }]);
    driveStdTo(v1.id, kl.STD_STATUS.PUBLISHED);
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.PUBLISHED);

    // 发布 v2
    const v2 = kl.createStdVersion(raw.id, { content: 'v2' });
    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);

    // v1 自动归档
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.ARCHIVED, '旧版本应自动归档');
    assert.strictEqual(kl.getStd(v2.id).status, kl.STD_STATUS.PUBLISHED, '新版本生效');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 6. 复审通知 - 日报告集成
// ============================================================

test('复审通知：getExpiringDocs 返回即将到期文档列表', () => {
  withLayers(() => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'soon.md', validUntil: future });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const list = expiry.getExpiringDocs(7);
    assert.ok(Array.isArray(list), '应返回数组');
    assert.ok(list.some((d) => d.rawId === raw.id), '应包含即将到期的文档');
  });
});

test('复审通知：getExpiredDocs 返回已过期文档列表', () => {
  withLayers(() => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'overdue.md', validUntil: yesterday });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    // 模拟过期处理
    expiry.processExpired();

    const list = expiry.getExpiredDocs();
    assert.ok(Array.isArray(list), '应返回数组');
    assert.ok(list.some((d) => d.rawId === raw.id || d.stdId === std.id), '应包含已过期的文档');
  });
});

test('复审通知：getExpiringDocs 返回空数组当无到期文档', () => {
  withLayers(() => {
    const list = expiry.getExpiringDocs(7);
    assert.deepStrictEqual(list, []);
  });
});

test('复审通知：getExpiredDocs 返回空数组当无过期文档', () => {
  withLayers(() => {
    const list = expiry.getExpiredDocs();
    assert.deepStrictEqual(list, []);
  });
});

// ============================================================
// 7. 待复审文档仍可检索，但标注可能过期
// ============================================================

test('need_review 文档仍可检索', () => {
  withLayers(() => {
    // 已发布
    const { raw, std, chunks } = seedPublishedTree();
    // 手动转为 need_review
    kl.markNeedReview(std.id);

    // 仍可检索
    const retrievable = kl.listRetrievableVectors().filter((v) => v.stdId === std.id);
    assert.ok(retrievable.length > 0, 'need_review 文档的向量仍应参与检索');

    // 检查 invariants
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('need_review 状态在答案中可通过 isExpired 标记判断', () => {
  withLayers(() => {
    const { std } = seedPublishedTree();
    kl.markNeedReview(std.id);

    // 检查 expiry 模块的 isExpired 判断
    const result = expiry.isStdExpired(std.id);
    assert.strictEqual(result, true, 'need_review 状态的文档应被标记为过期');
  });
});

test('published 状态文档不应标记为过期', () => {
  withLayers(() => {
    const { std } = seedPublishedTree();
    const result = expiry.isStdExpired(std.id);
    assert.strictEqual(result, false, 'published 状态的文档不应标记为过期');
  });
});

// ============================================================
// 8. 过期扫描与自动处理集成
// ============================================================

test('自动归档：新版本发布时旧版自动归档（已由 publishStd 保障）', () => {
  withLayers(() => {
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, { content: 'v1' });
    const v2 = kl.createStdVersion(raw.id, { content: 'v2' });
    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);

    // v1 仍为 draft（未发布，所以不受影响）
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.DRAFT);

    // 发布 v1
    driveStdTo(v1.id, kl.STD_STATUS.PUBLISHED);
    // v2 自动归档
    assert.strictEqual(kl.getStd(v2.id).status, kl.STD_STATUS.ARCHIVED, '同 raw 下的旧版本自动归档');
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.PUBLISHED, '新版本生效');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 9. 有效性检查 - 批处理不重复
// ============================================================

test('过期处理：processExpired 幂等性——重复调用只处理一次', () => {
  withLayers(() => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const raw = seedRaw({ fileName: 'expired.md', validUntil: yesterday });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    const first = expiry.processExpired();
    assert.strictEqual(first, 1, '第一次应处理 1 个');

    const second = expiry.processExpired();
    assert.strictEqual(second, 0, '第二次不应再处理（已在 need_review）');
  });
});