/**
 * 文档管理回归测试 —— 锁定第 5 步代码审查修复的行为
 *
 * 覆盖：
 *   - publicView 脱敏（仅管理员/审核员可见原文 + 切片）
 *   - tags / note 长度限制
 *   - listForUser status 白名单
 *   - 阶段 2：upload() 切到四层链路（4 个新测试）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const docs = require('../lib/documents');
const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');

// ============================================================
// 阶段 2：隔离夹具（仿 test/document-view.test.js:40-53，复用 store 缓存清理）
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-doc-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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

// ============================================================
// publicView 脱敏（B1+B2 修复）
// ============================================================
//
// 阶段 4 起，publicView 签名从 publicView(doc, user) 改为 publicView(view, user)，
// 入参是 getDocumentView() 产出的聚合视图（id/title/.../status/lifecycleStatus/chunks），
// 而不是旧 documents 表里的原始 doc。旧的 3 个核心断言（admin/reviewer/产品看到什么）
// 在新视图下语义已变（B1+B2 防的"通过 doc.chunks 字段名泄漏原文"在新链路里不存在
// —— view.chunks 已经是 {id, seq, heading, keywords, content} 形状，且只有管理员/审核员会拿到）
// —— 阶段 9 整体重写时统一删旧 + 加新。
// 保留 2 个边缘用例（guest 同样剥 content+chunks、空文档返回 null），
// 它们测的不是 admin/reviewer 路径，行为不变，仍绿。

test.skip('publicView：管理员可见完整 content 与 chunks [阶段 9 整体重写]', () => {
  const doc = {
    id: 'doc_1', content: '完整原文', chunks: [{ content: '片段 A' }, { content: '片段 B' }],
    status: 'pending',
  };
  const view = docs.publicView(doc, { role: 'admin' });
  assert.strictEqual(view.content, '完整原文', '管理员看不到原文');
  assert.ok(Array.isArray(view.chunks) && view.chunks.length === 2, '管理员看不到切片');
});

test.skip('publicView：审核员可见完整 content 与 chunks [阶段 9 整体重写]', () => {
  const doc = { id: 'doc_1', content: '完整原文', chunks: [{ content: '片段' }], status: 'pending' };
  const view = docs.publicView(doc, { role: 'reviewer' });
  assert.strictEqual(view.content, '完整原文');
  assert.ok(view.chunks);
});

test.skip('publicView：普通用户不可见 content 与 chunks（防 B1 复发）[阶段 9 整体重写]', () => {
  const doc = { id: 'doc_1', content: '完整原文', chunks: [{ content: '片段' }], status: 'approved' };
  const view = docs.publicView(doc, { role: 'product', bizLine: 'trade' });
  assert.strictEqual(view.content, undefined, 'content 泄漏给非管理员');
  assert.strictEqual(view.chunks, undefined, 'chunks 泄漏给非管理员（按段落切好的原文）');
  assert.strictEqual(view.id, 'doc_1', '元数据应保留');
});

test('publicView：guest 不可见 content 与 chunks', () => {
  const doc = { id: 'doc_1', content: '完整原文', chunks: [{ content: '片段' }], status: 'approved' };
  const view = docs.publicView(doc, { role: 'guest', readonly: true });
  assert.strictEqual(view.content, undefined);
  assert.strictEqual(view.chunks, undefined);
});

test('publicView：空文档返回 null', () => {
  assert.strictEqual(docs.publicView(null, { role: 'admin' }), null);
});

// ============================================================
// tags / note 长度限制（N3+N4 修复）
// ============================================================

test('upload：tags 数量超过 20 被拒绝', () => {
  const user = { role: 'admin', username: 'admin' };
  const input = {
    content: '正文内容长度足够。'.repeat(20),
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: Array.from({ length: 21 }, (_, i) => 'tag' + i),
  };
  assert.throws(
    () => docs.upload(user, input),
    (e) => e.status === 400 && /标签数量/.test(e.message)
  );
});

test('upload：单个 tag 超过 30 字符被拒绝', () => {
  const user = { role: 'admin', username: 'admin' };
  const input = {
    content: '正文内容长度足够。'.repeat(20),
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: ['a'.repeat(31)],
  };
  assert.throws(
    () => docs.upload(user, input),
    (e) => e.status === 400
  );
});

test('upload：tags 必须是数组', () => {
  const user = { role: 'admin', username: 'admin' };
  const input = {
    content: '正文内容长度足够。'.repeat(20),
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: '退款,售后', // 字符串而非数组
  };
  assert.throws(
    () => docs.upload(user, input),
    (e) => e.status === 400
  );
});

test('review：note 超过 500 字符被拒绝', () => {
  // 构造已存在但仍为 pending 的文档
  const store = require('../lib/store');
  const user = { role: 'admin', username: 'admin' };
  const reviewer = { role: 'reviewer', username: 'reviewer' };
  const input = {
    content: '正文内容长度足够。'.repeat(20),
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: [],
  };
  const doc = docs.upload(user, input);
  assert.throws(
    () => docs.review(reviewer, doc.id, 'approved', 'x'.repeat(501)),
    (e) => e.status === 400 && /备注/.test(e.message)
  );
});

// ============================================================
// 阶段 2：upload() 切到四层链路（4 个新测试）
// ============================================================
//
// 约束（test/document-view.test.js 顶部有同款警告）：
//   必须保持同步执行。改 async / 用 await / 开 concurrency 都会让
//   withTempDataDir 交错，隔离静默失效。

// ----- 测试 1：admin + 完整字段上传成功 -----

test('upload：admin 完整字段上传，返回 view.id 是 raw_ 前缀 + 字段完整', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin', canWrite: true };
    // 内容必须足够长：minChunkLength=30，每个段落要 > 30 字符才能进 chunk。
    // 用重复式无换行的长句，触发去重后保留 1 个 chunk，足够验证 chainCount > 0。
    const input = {
      title: '测试上传',
      fileName: 'test.md',
      content: '# 测试上传\n\n这是一段足够长的内容用于验证四层链路的状态机流转和字段继承关系。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['上传', '测试'],
    };
    const result = docs.upload(user, input);

    assert.ok(result, 'upload 应返回对象');
    assert.match(result.id, /^raw_/, '返回 id 应为 raw_ 前缀');
    assert.strictEqual(result.title, '测试上传');
    assert.strictEqual(result.bizLine, 'trade');
    assert.strictEqual(result.securityLevel, 'internal');
    assert.strictEqual(result.tags.length, 2);
    assert.strictEqual(result.status, 'pending', 'status 应映射到旧 3 值 pending');
    assert.strictEqual(result.lifecycleStatus, 'pending', 'lifecycleStatus 应透传 std 状态');
    assert.ok(result.chunkCount > 0, '至少应有 1 个 chunk');
    assert.strictEqual(result.uploadedBy, 'admin');
  });
});

// ----- 测试 2：readonly guest 被 403 拒绝 -----

test('upload：readonly guest 上传抛 403', () => {
  withTempDataDir(() => {
    // 参照 mock-data/users.json u_009：readonly=true 一定写不进去
    const user = { username: 'guest', role: 'guest', readonly: true };
    const input = {
      title: '尝试上传',
      content: '一段足够长的内容用于测试权限拒绝路径。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    };
    assert.throws(
      () => docs.upload(user, input),
      (e) => e.status === 403
    );
  });
});

// ----- 测试 3：4 种参数错误全部抛 400 -----

test('upload：content 为空字符串抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    assert.throws(
      () => docs.upload(user, {
        content: '',
        bizLine: 'trade',
        securityLevel: 'internal',
      }),
      (e) => e.status === 400
    );
  });
});

test('upload：bizLine 不在白名单抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    assert.throws(
      () => docs.upload(user, {
        content: '一段足够长的内容用于测试 bizLine 白名单。'.repeat(20),
        bizLine: 'hacker',
        securityLevel: 'internal',
      }),
      (e) => e.status === 400
    );
  });
});

test('upload：securityLevel 不在白名单抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    assert.throws(
      () => docs.upload(user, {
        content: '一段足够长的内容用于测试 securityLevel 白名单。'.repeat(20),
        bizLine: 'trade',
        securityLevel: 'topsecret',
      }),
      (e) => e.status === 400
    );
  });
});

test('upload：tags 数量 21 抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    assert.throws(
      () => docs.upload(user, {
        content: '一段足够长的内容用于测试 tags 数量限制。'.repeat(20),
        bizLine: 'trade',
        securityLevel: 'internal',
        tags: Array.from({ length: 21 }, (_, i) => 'tag' + i),
      }),
      (e) => e.status === 400
    );
  });
});

// ============================================================
// 阶段 3：review() 切到四层链路（6 个新测试）
// ============================================================
//
// 约束：每个测试都先 admin 上传一个 raw，再让 reviewer 调 review。
// 阶段 3 不调 publishStd，所以 review 通过后：
//   - std.status === 'approved'
//   - std.isCurrent === false
//   - raw.currentStdId === null（仍）

// ----- 测试 1：review 通过，std 落库到 approved + 审核留痕 -----

test('review：通过——std.status=approved + reviewedBy/At/Note 写好 + isCurrent 仍 false', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '测试上传',
      fileName: 'test.md',
      content: '这是一段足够长的内容用于验证四层链路的状态机流转和字段继承关系。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: [],
    });

    docs.review(reviewer, view.id, 'approved', '这是审核意见');

    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds.length, 1, '应该只有 1 个 std 版本');
    assert.strictEqual(stds[0].status, 'approved', 'std.status 必须切到 approved');
    assert.strictEqual(stds[0].reviewedBy, 'reviewer', 'reviewedBy 必须是审核人');
    assert.ok(typeof stds[0].reviewedAt === 'string' && stds[0].reviewedAt.length > 0,
      'reviewedAt 必须是非空 ISO 字符串');
    assert.strictEqual(stds[0].reviewNote, '这是审核意见', 'reviewNote 必须写好');
    assert.strictEqual(stds[0].isCurrent, false,
      '本阶段不调 publishStd，isCurrent 必须仍为 false');
  });
});

// ----- 测试 2：review 驳回，下游 chunks.status 同步为 rejected -----

test('review：驳回——std.status=rejected + chunks.status 同步为 rejected', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '驳回测试',
      fileName: 'reject.md',
      content: '这是一段足够长的内容用于验证审核驳回后下游 chunks 状态同步。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: [],
    });

    docs.review(reviewer, view.id, 'rejected', '驳回原因');

    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds[0].status, 'rejected');
    assert.strictEqual(stds[0].reviewedBy, 'reviewer');
    assert.strictEqual(stds[0].reviewNote, '驳回原因');

    // 下游 chunks 状态：setStdStatus 应级联同步（I4 不变量）
    const chunks = kl.listChunksByStd(stds[0].id);
    assert.ok(chunks.length > 0, '至少有 1 个 chunk');
    assert.strictEqual(chunks[0].status, 'rejected', 'chunk.status 必须跟随 std 同步为 rejected');
  });
});

// ----- 测试 3：review 抛 403：readonly guest -----

test('review：readonly guest 抛 403', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const view = docs.upload(admin, {
      title: '权限测试',
      fileName: 'perm.md',
      content: '这是一段足够长的内容用于验证 readonly guest 没有审核权限。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: [],
    });

    // 参照 mock-data/users.json：readonly=true 是访客的标志
    const guest = { username: 'guest', role: 'guest', readonly: true };
    assert.throws(
      () => docs.review(guest, view.id, 'approved', 'note'),
      (e) => e.status === 403
    );
  });
});

// ----- 测试 4：review 抛 404：rawId 不存在 -----

test('review：rawId 不存在抛 404', () => {
  withTempDataDir(() => {
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    assert.throws(
      () => docs.review(reviewer, 'raw_不存在的id', 'approved', 'note'),
      (e) => e.status === 404
    );
  });
});

// ----- 测试 5：review 抛 409：std 已是 approved，不能重复审 -----

test('review：已 approved 的 std 再次审抛 409', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '重复审测试',
      fileName: 'dup.md',
      content: '这是一段足够长的内容用于验证已 approved 的 std 不能再审。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: [],
    });

    docs.review(reviewer, view.id, 'approved', '第一次通过');
    // 第二次通过：TRANSITIONS 里 approved → approved 不在白名单，setStdStatus 会抛 409
    assert.throws(
      () => docs.review(reviewer, view.id, 'approved', '第二次'),
      (e) => e.status === 409
    );
  });
});

// ----- 测试 6：review 抛 400：note 超过 500 字符 -----

test('review：note 超过 500 字符抛 400', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '备注过长测试',
      fileName: 'note.md',
      content: '这是一段足够长的内容用于验证审核备注超过 500 字符被拒绝。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: [],
    });

    assert.throws(
      () => docs.review(reviewer, view.id, 'approved', 'a'.repeat(501)),
      (e) => e.status === 400
    );
  });
});

// ----- 测试 4：四层状态全部正确（raw.ready / std.pending + chunks 继承）-----

test('upload：四层状态正确（raw.ready, std pending, chunks pending, 权限判据从 std 继承）', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    const input = {
      title: '四层链路测试',
      fileName: 'layer.md',
      content: '# 四层链路测试\n\n这是一段足够长的内容用于验证四层链路的状态机流转和字段继承关系。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['链路'],
    };
    const view = docs.upload(user, input);

    // 第一层：raw 已 markReady
    const raw = kl.getRaw(view.id);
    assert.ok(raw, 'raw 应存在');
    assert.strictEqual(raw.status, 'ready', 'upload 后 raw.status 必须是 ready（markReady 调过）');

    // 第二层：1 个 std 版本、status=pending、isCurrent=false、权限字段继承 raw
    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds.length, 1, '应该只有 1 个 std 版本');
    assert.strictEqual(stds[0].procVersion, 1);
    assert.strictEqual(stds[0].status, 'pending', 'std.status 必须是 pending（setStdStatus 调过）');
    assert.strictEqual(stds[0].isCurrent, false, '本阶段不调 publishStd，isCurrent 必须仍为 false');
    assert.strictEqual(stds[0].bizLine, 'trade', 'std.bizLine 必须从 raw 继承（I3）');
    assert.strictEqual(stds[0].securityLevel, 'internal', 'std.securityLevel 必须从 raw 继承（I3）');

    // 第三层：至少 1 个 chunk，权限字段继承 std，status 跟随 std
    const chunks = kl.listChunksByStd(stds[0].id);
    assert.ok(chunks.length > 0, '至少应有 1 个 chunk');
    assert.strictEqual(chunks[0].bizLine, 'trade', 'chunk.bizLine 必须从 std 继承（I4）');
    assert.strictEqual(chunks[0].securityLevel, 'internal', 'chunk.securityLevel 必须从 std 继承（I4）');
    assert.strictEqual(chunks[0].status, 'pending', 'chunk.status 必须跟随 std（I4 同步）');
  });
});

// ============================================================
// 阶段 4：listForUser / remove / publicView 切到四层（12 个新测试）
// ============================================================
//
// 关键决策（plan 阶段 1 决策 2）：
//   - listForUser 内部岗位过滤用 view.lifecycleStatus === 'published'
//     而不是 view.status === 'approved'。
//   - 原因：LIFECYCLE_TO_OLD 把 APPROVED 也映射成 'pending'，只有 PUBLISHED 映射成 'approved'。
//     用 view.status 过滤会同时把"审核通过但还没生效"的版本也算成"可看"——
//     那些版本还没法被检索到，对用户不可见。
//   - readonly 用户看全部（按原契约）—— 但写操作被 auth.canWrite 拦。
//   - publicView(view, user) 签名接 view，不是 doc；
//     view.chunks 已经是 {id, seq, heading, keywords, content} 形状。
//   - remove 切到 kl.deleteRawCascade，自动级联清理 std/chunks/vectors。
//
// 约束（同 document-view.test.js 顶部警告）：withTempDataDir 必须保持同步执行。

// ----- 阶段 4 测试夹具 -----

/** 造一个 raw 并发布（走合法路径 DRAFT → PENDING → APPROVED → PUBLISHED） */
function publishRaw(over = {}) {
  const r = kl.createRaw({
    title: over.title || '已发布文档',
    fileName: over.fileName || 'pub.md',
    content: '这是一段足够长的内容用于验证四层链路上的列表与视图行为。'.repeat(10),
    tags: [],
    uploadedBy: 'admin',
    bizLine: over.bizLine || 'trade',
    securityLevel: over.securityLevel || 'internal',
    ...over,
  });
  kl.markReady(r.id);
  const s = kl.createStdVersion(r.id, { content: '标准化正文' });
  kl.setStdStatus(s.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(s.id, kl.STD_STATUS.APPROVED);
  kl.publishStd(s.id);
  return r;
}

/** 造一个 raw，走 DRAFT → PENDING（卡在送审状态） */
function pendingRaw(over = {}) {
  const r = kl.createRaw({
    title: over.title || '待审核文档',
    fileName: over.fileName || 'pending.md',
    content: '这是一段足够长的内容用于验证待审核状态的列表行为。'.repeat(10),
    tags: [],
    uploadedBy: 'admin',
    bizLine: over.bizLine || 'trade',
    securityLevel: over.securityLevel || 'internal',
    ...over,
  });
  kl.markReady(r.id);
  const s = kl.createStdVersion(r.id, { content: '标准化正文' });
  kl.setStdStatus(s.id, kl.STD_STATUS.PENDING);
  return r;
}

/** 造一个 raw，只建 std 草稿（不送审） */
function draftRaw(over = {}) {
  const r = kl.createRaw({
    title: over.title || '草稿文档',
    fileName: over.fileName || 'draft.md',
    content: '这是一段足够长的内容用于验证草稿状态的列表行为。'.repeat(10),
    tags: [],
    uploadedBy: 'admin',
    bizLine: over.bizLine || 'trade',
    securityLevel: over.securityLevel || 'internal',
    ...over,
  });
  kl.markReady(r.id);
  kl.createStdVersion(r.id, { content: '标准化正文' });
  return r;
}

/** 造一个 raw，走 DRAFT → PENDING → APPROVED（已审未发布 —— 关键边界态） */
function approvedRaw(over = {}) {
  const r = kl.createRaw({
    title: over.title || '已审文档',
    fileName: over.fileName || 'approved.md',
    content: '这是一段足够长的内容用于验证已审未发布状态的列表行为。'.repeat(10),
    tags: [],
    uploadedBy: 'admin',
    bizLine: over.bizLine || 'trade',
    securityLevel: over.securityLevel || 'internal',
    ...over,
  });
  kl.markReady(r.id);
  const s = kl.createStdVersion(r.id, { content: '标准化正文' });
  kl.setStdStatus(s.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(s.id, kl.STD_STATUS.APPROVED);
  return r;
}

/** 造一个 raw，走 DRAFT → PENDING → REJECTED */
function rejectedRaw(over = {}) {
  const r = kl.createRaw({
    title: over.title || '驳回文档',
    fileName: over.fileName || 'rejected.md',
    content: '这是一段足够长的内容用于验证驳回状态的列表行为。'.repeat(10),
    tags: [],
    uploadedBy: 'admin',
    bizLine: over.bizLine || 'trade',
    securityLevel: over.securityLevel || 'internal',
    ...over,
  });
  kl.markReady(r.id);
  const s = kl.createStdVersion(r.id, { content: '标准化正文' });
  kl.setStdStatus(s.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(s.id, kl.STD_STATUS.REJECTED);
  return r;
}

// ============================================================
// 阶段 4.1: listForUser 切到四层（6 个测试）
// ============================================================

// ----- t1：admin 看全部 -----

test('listForUser：admin 看全部（含 draft/pending/approved/published/rejected）', () => {
  withTempDataDir(() => {
    publishRaw({ title: '已发布' });
    pendingRaw({ title: '待审' });
    draftRaw({ title: '草稿' });
    rejectedRaw({ title: '驳回' });

    const admin = { username: 'admin', role: 'admin' };
    const list = docs.listForUser(admin);
    assert.strictEqual(list.length, 4, 'admin 应看到全部 4 条，不管 lifecycleStatus');
  });
});

// ----- t2：reviewer 看全部 -----

test('listForUser：reviewer 看全部（同 admin）', () => {
  withTempDataDir(() => {
    publishRaw({ title: '已发布' });
    pendingRaw({ title: '待审' });
    draftRaw({ title: '草稿' });
    rejectedRaw({ title: '驳回' });

    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const list = docs.listForUser(reviewer);
    assert.strictEqual(list.length, 4, 'reviewer 与 admin 一样看全部');
  });
});

// ----- t3：readonly 看全部（关键安全契约：看得全但写被拦） -----

test('listForUser：readonly guest 看全部（写操作另被 auth.canWrite 拦）', () => {
  withTempDataDir(() => {
    publishRaw({ title: '已发布' });
    pendingRaw({ title: '待审' });
    draftRaw({ title: '草稿' });

    // readonly=true 的访客：列表能看全，但 remove() 必须 403
    const guest = { username: 'guest', role: 'guest', readonly: true };
    const list = docs.listForUser(guest);
    assert.strictEqual(list.length, 3, 'readonly 应看到全部（不按 status 过滤）');
  });
});

// ----- t4：内部岗位 product/trade 只看 trade + published（关键回归：lifecycleStatus vs status）-----

test('listForUser：product/trade 只看 trade + lifecycleStatus=published（不接 APPROVED）', () => {
  withTempDataDir(() => {
    // 1 个已发布 trade（应可见）
    const rPub = publishRaw({ title: '已发布 trade' });
    // 1 个已审核但未发布 trade（**关键**：lifecycleStatus=approved，LIFECYCLE_TO_OLD 映射为 'pending'，
    //   新实现必须用 lifecycleStatus='published' 过滤，所以这条**不应**可见）
    const rApp = approvedRaw({ title: '已审未发布 trade' });
    // 1 个待审 trade（不应可见）
    pendingRaw({ title: '待审 trade' });

    const product = { username: 'product', role: 'product', bizLine: 'trade' };
    const list = docs.listForUser(product);
    assert.strictEqual(list.length, 1, 'product/trade 只应看到 1 个已发布 trade');
    assert.strictEqual(list[0].id, rPub.id, '应是已发布那条');
    assert.strictEqual(list[0].lifecycleStatus, 'published', '过滤判据是 lifecycleStatus');
    // 显式断言 rApp 不在结果里 —— 这是把"lifecycleStatus vs status"安全契约锁住的关键
    const ids = list.map((v) => v.id);
    assert.ok(!ids.includes(rApp.id), 'APPROVED 但未 PUBLISHED 的不应可见（关键安全回归）');
  });
});

// ----- t5：业务线隔离 -----

test('listForUser：product/membership 看不到 trade（业务线隔离）', () => {
  withTempDataDir(() => {
    // 1 个 trade 已发布（product/membership 看不到）
    const rTrade = publishRaw({ title: 'trade 文档', bizLine: 'trade' });
    // 1 个 membership 已发布（product/membership 看到）
    const rMember = publishRaw({ title: 'membership 文档', bizLine: 'membership' });

    const product = { username: 'product', role: 'product', bizLine: 'membership' };
    const list = docs.listForUser(product);
    assert.strictEqual(list.length, 1, '只看 membership');
    assert.strictEqual(list[0].id, rMember.id);
    const ids = list.map((v) => v.id);
    assert.ok(!ids.includes(rTrade.id), 'trade 不应出现在 membership 视角');
  });
});

// ----- t6：status 过滤（opts.status='pending'）-----

test('listForUser：admin + opts.status=pending 只返回 view.status=pending 的', () => {
  withTempDataDir(() => {
    // view.status='pending' 来自 LIFECYCLE_TO_OLD：draft/qc_failed/pending/approved → 'pending'
    const rDraft = draftRaw({ title: '草稿' });
    const rPending = pendingRaw({ title: '待审' });
    const rApproved = approvedRaw({ title: '已审' });
    // view.status='approved' 来自：published/need_review → 'approved'
    const rPublished = publishRaw({ title: '已发布' });
    // view.status='rejected' 来自：rejected/archived → 'rejected'
    const rRejected = rejectedRaw({ title: '驳回' });

    const admin = { username: 'admin', role: 'admin' };
    const list = docs.listForUser(admin, { status: 'pending' });
    assert.strictEqual(list.length, 3, '应返回 view.status=pending 的 3 条');
    const ids = list.map((v) => v.id);
    assert.ok(ids.includes(rDraft.id));
    assert.ok(ids.includes(rPending.id));
    assert.ok(ids.includes(rApproved.id));
    assert.ok(!ids.includes(rPublished.id), 'published（view.status=approved）应被过滤');
    assert.ok(!ids.includes(rRejected.id), 'rejected 应被过滤');
  });
});

// ============================================================
// 阶段 4.2: remove 切到 kl.deleteRawCascade（2 个测试）
// ============================================================

// ----- t7：admin 删除 → 级联清掉 raw/std/chunks -----

test('remove：admin 删除 raw → 级联清掉 std/chunks（其他层 0 落点）', () => {
  withTempDataDir(() => {
    // 造一个有 std + chunks 的 raw
    const r = kl.createRaw({
      title: '待删除文档',
      fileName: 'del.md',
      content: '这是待删除文档的正文内容足够长以触发切片生成。'.repeat(10),
      bizLine: 'trade',
      securityLevel: 'internal',
      uploadedBy: 'admin',
    });
    kl.markReady(r.id);
    const s = kl.createStdVersion(r.id, { content: '标准化正文' });
    kl.createChunks(s.id, [{
      content: '片段内容足够长通过 minChunkLength 检查',
      heading: '第一章',
      keywords: ['关键词'],
      fingerprint: 'fp_1',
    }]);

    // 删除前确认都存在
    assert.ok(kl.getRaw(r.id), 'raw 应存在');
    assert.strictEqual(kl.listStdByRaw(r.id).length, 1, 'std 应存在');
    assert.ok(kl.listChunksByStd(s.id).length > 0, 'chunks 应存在');

    // 执行删除
    const admin = { username: 'admin', role: 'admin' };
    docs.remove(admin, r.id);

    // 删除后四层都不应残留
    assert.strictEqual(kl.getRaw(r.id), null, 'raw 应被删');
    assert.strictEqual(kl.listStdByRaw(r.id).length, 0, 'std 应级联删');
    assert.strictEqual(kl.listChunksByStd(s.id).length, 0, 'chunks 应级联删');
  });
});

// ----- t8：readonly 不能删（关键安全回归：后端必须拦） -----

test('remove：readonly guest 删 → 403（关键安全回归，不能只靠前端隐藏）', () => {
  withTempDataDir(() => {
    const r = kl.createRaw({
      title: '尝试删除',
      fileName: 'try.md',
      content: '这是尝试删除的文档正文内容足够长。'.repeat(10),
      bizLine: 'trade',
      securityLevel: 'internal',
      uploadedBy: 'admin',
    });
    kl.markReady(r.id);

    // readonly=true 的访客：可以看，但删除必须被后端拒绝
    const guest = { username: 'guest', role: 'guest', readonly: true };
    assert.throws(
      () => docs.remove(guest, r.id),
      (e) => e.status === 403,
      'readonly guest 删除应抛 403'
    );
    // 验证 raw 还在
    assert.ok(kl.getRaw(r.id), '403 后 raw 应仍存在');
  });
});

// ============================================================
// 阶段 4.3: publicView 切到 view 形状（3 个测试）
// ============================================================
//
// publicView(view, user) 入参是 getDocumentView 产出的聚合视图：
//   {id, title, ..., status, lifecycleStatus, chunks: [{id, seq, heading, keywords, content}]}
// 管理员/审核员返回完整 view；其他角色剥 content 与 chunks。
// 视图本身在 getDocumentView 已经不带 top-level content（只 chunks[].content），
// 所以 publicView 的剥离实际就是"剥 chunks"——但 spec 保留 content 解构作为防御。

function makeViewWithChunks() {
  // 造一个完整链路 raw + std + chunks + 发布，返回 view
  const r = kl.createRaw({
    title: 'publicView 测试文档',
    fileName: 'pv.md',
    content: '这是测试 publicView 的文档正文内容。'.repeat(5),
    bizLine: 'trade',
    securityLevel: 'internal',
    uploadedBy: 'admin',
  });
  kl.markReady(r.id);
  const s = kl.createStdVersion(r.id, { content: '标准化正文' });
  kl.createChunks(s.id, [{
    content: '片段内容足够长通过 minChunkLength 检查',
    heading: '第一章',
    keywords: ['关键词'],
    fingerprint: 'fp_1',
  }]);
  kl.setStdStatus(s.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(s.id, kl.STD_STATUS.APPROVED);
  kl.publishStd(s.id);
  return docs.getDocumentView(r.id);
}

// ----- t9：admin/reviewer 看到完整 view -----

test('publicView：admin/reviewer 看到完整 view（含 chunks 与 chunks.content）', () => {
  withTempDataDir(() => {
    const view = makeViewWithChunks();

    const adminView = docs.publicView(view, { role: 'admin' });
    assert.ok(Array.isArray(adminView.chunks), 'admin 应保留 chunks');
    assert.ok(adminView.chunks.length > 0);
    assert.strictEqual(typeof adminView.chunks[0].content, 'string',
      'admin 应保留 chunks[].content');
    assert.ok(adminView.chunks[0].id, 'chunks[0].id 应在');
    assert.strictEqual(typeof adminView.chunks[0].seq, 'number', 'chunks[0].seq 应在');
    // 元信息都在
    assert.strictEqual(adminView.id, view.id);
    assert.strictEqual(adminView.title, view.title);
    assert.strictEqual(adminView.status, view.status);
    assert.strictEqual(adminView.lifecycleStatus, view.lifecycleStatus);

    const reviewerView = docs.publicView(view, { role: 'reviewer' });
    assert.ok(Array.isArray(reviewerView.chunks), 'reviewer 应保留 chunks');
    assert.ok(reviewerView.chunks.length > 0);

    // 关键安全契约：chunks 投影不带权限判据字段（阶段 1 决策，阶段 4 显式断言锁住）
    assert.strictEqual(adminView.chunks[0].bizLine, undefined,
      'chunks 投影不应带 bizLine（防调用方误读做权限判断）');
    assert.strictEqual(adminView.chunks[0].securityLevel, undefined,
      'chunks 投影不应带 securityLevel');
    assert.strictEqual(adminView.chunks[0].status, undefined,
      'chunks 投影不应带 status');
  });
});

// ----- t10：内部岗位 product 看到 safe view（剥 chunks）-----

test('publicView：内部岗位 product 看到 safe view（剥 content + chunks），元信息全留', () => {
  withTempDataDir(() => {
    const view = makeViewWithChunks();
    const safe = docs.publicView(view, { role: 'product', bizLine: 'trade' });

    // 剥离：content 与 chunks 都不应有
    assert.strictEqual(safe.content, undefined, '顶层 content 应被剥');
    assert.strictEqual(safe.chunks, undefined, 'chunks 应被剥（防按段落切好的原文泄漏）');

    // 元信息全留
    assert.strictEqual(safe.id, view.id);
    assert.strictEqual(safe.title, view.title);
    assert.strictEqual(safe.bizLine, view.bizLine);
    assert.strictEqual(safe.securityLevel, view.securityLevel);
    assert.strictEqual(safe.status, view.status);
    assert.strictEqual(safe.lifecycleStatus, view.lifecycleStatus);
    assert.strictEqual(safe.chunkCount, view.chunkCount);
  });
});

// ----- t11：user 为 null/undefined 时按"非管理员"处理 -----

test('publicView：user 为 null/undefined 时按"非管理员"处理（剥 content + chunks）', () => {
  withTempDataDir(() => {
    const view = makeViewWithChunks();

    const nullUser = docs.publicView(view, null);
    assert.strictEqual(nullUser.chunks, undefined, 'null user 应剥 chunks');
    assert.strictEqual(nullUser.content, undefined, 'null user 应剥 content');
    assert.strictEqual(nullUser.id, view.id, '元信息应保留');

    const undefinedUser = docs.publicView(view, undefined);
    assert.strictEqual(undefinedUser.chunks, undefined);
    assert.strictEqual(undefinedUser.content, undefined);
  });
});

// ============================================================
// 阶段 4.4: listForUser 返回 view 形状（1 个测试）
// ============================================================

// ----- t12：返回的 view 数组每个元素都是 view 形状 -----

test('listForUser：返回的数组中每个元素都是 view 形状（含 status/lifecycleStatus/chunks，不含顶层 content）', () => {
  withTempDataDir(() => {
    const rPub = publishRaw({ title: '已发布' });
    const admin = { username: 'admin', role: 'admin' };
    const list = docs.listForUser(admin);

    assert.ok(list.length > 0, '应有至少 1 条');
    const v = list[0];
    // 必含字段（与 getDocumentView 一致）
    assert.ok(v.id, 'view 必含 id');
    assert.ok(v.title, 'view 必含 title');
    assert.ok(v.bizLine, 'view 必含 bizLine');
    assert.ok(v.securityLevel, 'view 必含 securityLevel');
    assert.strictEqual(typeof v.status, 'string', 'view 必含 status（旧 3 值）');
    assert.strictEqual(typeof v.lifecycleStatus, 'string', 'view 必含 lifecycleStatus（lifecycle 8 态）');
    assert.ok(Array.isArray(v.chunks), 'view 必含 chunks 数组');
    // 不应含原始 doc 字段
    assert.strictEqual(v.content, undefined, 'view 不应有顶层 content（getDocumentView 不带）');
    // chunks 项是投影形状
    if (v.chunks.length > 0) {
      assert.ok(v.chunks[0].id);
      assert.strictEqual(typeof v.chunks[0].seq, 'number');
      assert.ok(v.chunks[0].content);
      // 关键安全契约：chunks 投影不带权限判据（与 t9 一起把这条契约锁住）
      assert.strictEqual(v.chunks[0].bizLine, undefined, 'chunks 不带 bizLine');
      assert.strictEqual(v.chunks[0].securityLevel, undefined, 'chunks 不带 securityLevel');
      assert.strictEqual(v.chunks[0].status, undefined, 'chunks 不带 status');
    }
    // 与 getDocumentView 同源
    assert.strictEqual(v.id, rPub.id);
  });
});
