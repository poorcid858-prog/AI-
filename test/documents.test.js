/**
 * 文档管理回归测试 —— 阶段 9 整体重写
 *
 * 29 个用例，0 skip，全在 withTempDataDir 内隔离到 os.tmpdir()。
 * 覆盖：
 *   A. publicView 脱敏（3）：admin/reviewer 完整 / 内部岗位剥 / user null 剥
 *   B. publicView 边缘（2）：guest 剥 / 空文档 null
 *   C. upload 切四层（8）：成功 / content 空 / bizLine 白名单 / securityLevel 白名单 / readonly 403 / tags 数量 / 单 tag 长度 / tags 非数组
 *   D. review 切四层（6）：通过 / 驳回 / readonly / 404 / 409 / note 长
 *   E. upload 四层状态（1）：raw.ready + std pending + chunks 继承
 *   F. listForUser（6）：admin / reviewer / readonly / product-trade / 业务线隔离 / opts.status
 *   G. remove（2）：admin 级联 / readonly 403
 *   H. view 形状（1）：返回元素是 view 形状，chunks 投影不带权限判据
 *
 * withTempDataDir 必须保持同步执行（finally 块改 config.paths.data）——
 * 改 async/await 会让 finally 在 promise resolve 前跑，隔离静默失效。
 * 同步夹具的代价：本文件所有用例串行，~6 秒 vs 并行 ~2 秒，**隔离正确性 > 速度**。
 *
 * 阶段 9 审查补回：content 空 / bizLine 白名单 / securityLevel 白名单 这 3 个 400 边界
 * 是上传链路的权限安全防线（跨线越权 + 机密泄漏），被实施子代理误砍——审查子代理
 * 阅 lib/documents.js line 159-179 确认无等价覆盖，已补回（C2 / C3 / C4）。
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
// 隔离夹具（同步执行！见文件头警告）
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
// 夹具工厂（造 raw/std/chunks 的合法链路样本）
// ============================================================

/** 造一个 raw 并发布（DRAFT → PENDING → APPROVED → PUBLISHED） */
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

/** 造一个 raw 卡在 PENDING（送审态） */
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

/** 造一个 raw 只建 std 草稿（不送审） */
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

/** 造一个 raw 已审未发布（DRAFT → PENDING → APPROVED，关键边界态） */
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

/** 造一个 raw 走到 REJECTED */
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

/** 造一个 raw + std + chunks + 发布，返回 view（专给 publicView 测试用） */
function makeViewWithChunks() {
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

// ============================================================
// A. publicView 脱敏（3）
// ============================================================

test('publicView：admin/reviewer 看到完整 view（含 chunks 与 chunks.content），chunks 投影不带权限判据', () => {
  withTempDataDir(() => {
    const view = makeViewWithChunks();

    const adminView = docs.publicView(view, { role: 'admin' });
    assert.ok(Array.isArray(adminView.chunks), 'admin 应保留 chunks');
    assert.ok(adminView.chunks.length > 0);
    assert.strictEqual(typeof adminView.chunks[0].content, 'string', 'admin 应保留 chunks[].content');
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

    // 关键安全契约：chunks 投影不带权限判据字段
    assert.strictEqual(adminView.chunks[0].bizLine, undefined, 'chunks 投影不应带 bizLine');
    assert.strictEqual(adminView.chunks[0].securityLevel, undefined, 'chunks 投影不应带 securityLevel');
    assert.strictEqual(adminView.chunks[0].status, undefined, 'chunks 投影不应带 status');
  });
});

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
// B. publicView 边缘（2）
// ============================================================

test('publicView：guest 不可见 content 与 chunks', () => {
  withTempDataDir(() => {
    // 即便 view 携带顶层 content + chunks，guest 也要被剥
    const view = makeViewWithChunks();
    const polluted = { ...view, content: '顶层 content 演示剥离', chunks: [{ content: 'hijack' }] };
    const result = docs.publicView(polluted, { role: 'guest', readonly: true });
    assert.strictEqual(result.content, undefined);
    assert.strictEqual(result.chunks, undefined);
  });
});

test('publicView：空文档返回 null', () => {
  withTempDataDir(() => {
    assert.strictEqual(docs.publicView(null, { role: 'admin' }), null);
  });
});

// ============================================================
// C. upload 切四层（8）
// ============================================================

test('upload：admin 完整字段上传，返回 view.id 是 raw_ 前缀 + 字段完整', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin', canWrite: true };
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

test('upload：content 为空字符串抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    // 唯一测 if (!input.content) 这一行；C1 走 happy path 不进 400 分支，
    // C6 readonly 在 400 之前 return。未来若有人把 line 164 改成 if (!input)
    // 只挡 null/undefined，空字符串会绕过——这条边界必须显式锁住
    assert.throws(
      () => docs.upload(user, {
        content: '',
        bizLine: 'trade',
        securityLevel: 'internal',
      }),
      (e) => e.status === 400 && /请提供文档内容/.test(e.message)
    );
  });
});

test('upload：bizLine 不在白名单抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    // 唯一测 if (!VALID_BIZLINE.includes(input.bizLine))；白名单失效 = 跨线越权
    assert.throws(
      () => docs.upload(user, {
        content: '一段足够长的内容用于测试 bizLine 白名单。'.repeat(20),
        bizLine: 'hacker',
        securityLevel: 'internal',
      }),
      (e) => e.status === 400 && /业务线非法/.test(e.message)
    );
  });
});

test('upload：securityLevel 不在白名单抛 400', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    // 唯一测 if (!VALID_SECURITY.includes(input.securityLevel))；白名单失效 = 机密泄漏
    assert.throws(
      () => docs.upload(user, {
        content: '一段足够长的内容用于测试 securityLevel 白名单。'.repeat(20),
        bizLine: 'trade',
        securityLevel: 'topsecret',
      }),
      (e) => e.status === 400 && /安全分级非法/.test(e.message)
    );
  });
});

test('upload：readonly guest 上传抛 403', () => {
  withTempDataDir(() => {
    const user = { username: 'guest', role: 'guest', readonly: true };
    const input = {
      title: '尝试上传',
      content: '一段足够长的内容用于测试权限拒绝路径。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    };
    assert.throws(() => docs.upload(user, input), (e) => e.status === 403);
  });
});

test('upload：tags 数量超过 20 被拒绝', () => {
  withTempDataDir(() => {
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
});

test('upload：单个 tag 超过 30 字符被拒绝', () => {
  withTempDataDir(() => {
    const user = { role: 'admin', username: 'admin' };
    const input = {
      content: '正文内容长度足够。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['a'.repeat(31)],
    };
    assert.throws(() => docs.upload(user, input), (e) => e.status === 400);
  });
});

test('upload：tags 必须是数组', () => {
  withTempDataDir(() => {
    const user = { role: 'admin', username: 'admin' };
    const input = {
      content: '正文内容长度足够。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: '退款,售后', // 字符串而非数组
    };
    assert.throws(() => docs.upload(user, input), (e) => e.status === 400);
  });
});

// ============================================================
// D. review 切四层（6）
// ============================================================

test('review：通过——std.status=approved + reviewedBy/At/Note 写好 + isCurrent 仍 false', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '测试上传', fileName: 'test.md',
      content: '这是一段足够长的内容用于验证四层链路的状态机流转和字段继承关系。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: [],
    });

    docs.review(reviewer, view.id, 'approved', '这是审核意见');

    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds.length, 1, '应该只有 1 个 std 版本');
    assert.strictEqual(stds[0].status, 'approved', 'std.status 必须切到 approved');
    assert.strictEqual(stds[0].reviewedBy, 'reviewer', 'reviewedBy 必须是审核人');
    assert.ok(typeof stds[0].reviewedAt === 'string' && stds[0].reviewedAt.length > 0,
      'reviewedAt 必须是非空 ISO 字符串');
    assert.strictEqual(stds[0].reviewNote, '这是审核意见', 'reviewNote 必须写好');
    assert.strictEqual(stds[0].isCurrent, false, '本阶段不调 publishStd，isCurrent 必须仍为 false');
  });
});

test('review：驳回——std.status=rejected + chunks.status 同步为 rejected', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '驳回测试', fileName: 'reject.md',
      content: '这是一段足够长的内容用于验证审核驳回后下游 chunks 状态同步。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: [],
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

test('review：readonly guest 抛 403', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const view = docs.upload(admin, {
      title: '权限测试', fileName: 'perm.md',
      content: '这是一段足够长的内容用于验证 readonly guest 没有审核权限。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: [],
    });

    const guest = { username: 'guest', role: 'guest', readonly: true };
    assert.throws(() => docs.review(guest, view.id, 'approved', 'note'), (e) => e.status === 403);
  });
});

test('review：rawId 不存在抛 404', () => {
  withTempDataDir(() => {
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    assert.throws(
      () => docs.review(reviewer, 'raw_不存在的id', 'approved', 'note'),
      (e) => e.status === 404
    );
  });
});

test('review：已 approved 的 std 再次审抛 409', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '重复审测试', fileName: 'dup.md',
      content: '这是一段足够长的内容用于验证已 approved 的 std 不能再审。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: [],
    });

    docs.review(reviewer, view.id, 'approved', '第一次通过');
    // 第二次通过：TRANSITIONS 里 approved → approved 不在白名单，setStdStatus 会抛 409
    assert.throws(() => docs.review(reviewer, view.id, 'approved', '第二次'), (e) => e.status === 409);
  });
});

test('review：note 超过 500 字符抛 400', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const view = docs.upload(admin, {
      title: '备注过长测试', fileName: 'note.md',
      content: '这是一段足够长的内容用于验证审核备注超过 500 字符被拒绝。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: [],
    });

    assert.throws(
      () => docs.review(reviewer, view.id, 'approved', 'a'.repeat(501)),
      (e) => e.status === 400 && /备注/.test(e.message)
    );
  });
});

// ============================================================
// E. upload 四层状态（1）
// ============================================================

test('upload：四层状态正确（raw.ready, std pending, chunks pending, 权限判据从 std 继承）', () => {
  withTempDataDir(() => {
    const user = { username: 'admin', role: 'admin' };
    const input = {
      title: '四层链路测试', fileName: 'layer.md',
      content: '# 四层链路测试\n\n这是一段足够长的内容用于验证四层链路的状态机流转和字段继承关系。'.repeat(20),
      bizLine: 'trade', securityLevel: 'internal', tags: ['链路'],
    };
    const view = docs.upload(user, input);

    // 第一层：raw 已 markReady
    const raw = kl.getRaw(view.id);
    assert.ok(raw, 'raw 应存在');
    assert.strictEqual(raw.status, 'ready', 'upload 后 raw.status 必须是 ready');

    // 第二层：1 个 std 版本、status=pending、isCurrent=false、权限字段继承 raw
    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds.length, 1, '应该只有 1 个 std 版本');
    assert.strictEqual(stds[0].procVersion, 1);
    assert.strictEqual(stds[0].status, 'pending', 'std.status 必须是 pending');
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
// F. listForUser（6）
// ============================================================

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
// G. remove（2）
// ============================================================

test('remove：admin 删除 raw → 级联清掉 std/chunks（其他层 0 落点）', () => {
  withTempDataDir(() => {
    // 造一个有 std + chunks 的 raw
    const r = kl.createRaw({
      title: '待删除文档', fileName: 'del.md',
      content: '这是待删除文档的正文内容足够长以触发切片生成。'.repeat(10),
      bizLine: 'trade', securityLevel: 'internal', uploadedBy: 'admin',
    });
    kl.markReady(r.id);
    const s = kl.createStdVersion(r.id, { content: '标准化正文' });
    kl.createChunks(s.id, [{
      content: '片段内容足够长通过 minChunkLength 检查',
      heading: '第一章', keywords: ['关键词'], fingerprint: 'fp_1',
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

test('remove：readonly guest 删 → 403（关键安全回归，不能只靠前端隐藏）', () => {
  withTempDataDir(() => {
    const r = kl.createRaw({
      title: '尝试删除', fileName: 'try.md',
      content: '这是尝试删除的文档正文内容足够长。'.repeat(10),
      bizLine: 'trade', securityLevel: 'internal', uploadedBy: 'admin',
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
// H. view 形状（1）
// ============================================================

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
      // 关键安全契约：chunks 投影不带权限判据
      assert.strictEqual(v.chunks[0].bizLine, undefined, 'chunks 不带 bizLine');
      assert.strictEqual(v.chunks[0].securityLevel, undefined, 'chunks 不带 securityLevel');
      assert.strictEqual(v.chunks[0].status, undefined, 'chunks 不带 status');
    }
    // 与 getDocumentView 同源
    assert.strictEqual(v.id, rPub.id);
  });
});

// ============================================================
// I. publishDocument（发布——审核通过后生成向量、转 published）
// ============================================================

test('publishDocument：正常发布——approved→published，向量生成，isCurrent=true，下游同步', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };

    // 走完整流程：upload → review(approved) → publish
    const view = docs.upload(admin, {
      title: '可发布文档',
      fileName: 'pub.md',
      content: '这是一段足够长的内容用于验证 publish 链路的完整流程。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['发布', '测试'],
    });

    // 审核通过
    docs.review(reviewer, view.id, 'approved', '审核通过，准备发布');

    // 发布
    const published = docs.publishDocument(reviewer, view.id);

    // 验证返回的 view
    assert.ok(published, 'publishDocument 应返回 view');
    assert.strictEqual(published.id, view.id, 'id 不变');
    assert.strictEqual(published.lifecycleStatus, 'published', 'std 状态应为 published');

    // 验证 std 状态
    const stds = kl.listStdByRaw(view.id);
    assert.strictEqual(stds.length, 1, '应只有 1 个 std 版本');
    assert.strictEqual(stds[0].status, 'published', 'std.status 必须为 published');
    assert.strictEqual(stds[0].isCurrent, true, 'publishStd 后 isCurrent 必须为 true');

    // 验证 raw.currentStdId 更新（不变量 I7）
    const raw = kl.getRaw(view.id);
    assert.strictEqual(raw.currentStdId, stds[0].id, 'raw.currentStdId 必须指向新发布的 std（I7）');

    // 验证 chunks 状态同步（I4）
    const chunks = kl.listChunksByStd(stds[0].id);
    assert.ok(chunks.length > 0, '至少应有 1 个 chunk');
    for (const chunk of chunks) {
      assert.strictEqual(chunk.status, 'published', 'chunk.status 必须跟随 std 同步为 published（I4）');
      assert.strictEqual(chunk.embeddingStatus, 'done', 'chunk.embeddingStatus 必须为 done');
    }

    // 验证向量生成（每个 chunk 恰好一条 isCurrent 向量）
    const vectors = kl.listVectorsByChunk(chunks[0].id);
    assert.ok(vectors.length > 0, 'chunk 至少应有 1 条向量记录');
    const currentVectors = vectors.filter(v => v.isCurrent);
    assert.strictEqual(currentVectors.length, 1, '每个 chunk 恰好一条 isCurrent 向量（I2）');
    assert.strictEqual(currentVectors[0].model, 'tfidf-v1', '向量模型应为 tfidf-v1');
    assert.ok(currentVectors[0].dim > 0, '向量维度应大于 0');
    assert.ok(Array.isArray(currentVectors[0].vec), '向量值数组应存在');

    // 验证向量状态同步（I4）
    for (const v of vectors) {
      assert.strictEqual(v.status, 'published', 'vector.status 必须跟随 std 同步为 published（I4）');
    }
  });
});

test('publishDocument：未审核通过的文档尝试发布抛 409', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };

    // 只上传，不审核
    const view = docs.upload(admin, {
      title: '未审文档',
      fileName: 'pending.md',
      content: '这是一段足够长的内容用于验证未审核文档无法发布。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });

    // 状态是 pending（尚未审核）
    assert.throws(
      () => docs.publishDocument(reviewer, view.id),
      (e) => e.status === 409 && /approved/.test(e.message)
    );
  });
});

test('publishDocument：guest 调用抛 403', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const guest = { username: 'guest', role: 'guest', readonly: true };

    const view = docs.upload(admin, {
      title: '权限测试',
      fileName: 'perm.md',
      content: '这是一段足够长的内容用于验证无权限用户无法发布。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });

    assert.throws(
      () => docs.publishDocument(guest, view.id),
      (e) => e.status === 403
    );
  });
});

test('publishDocument：raw 不存在抛 404', () => {
  withTempDataDir(() => {
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    assert.throws(
      () => docs.publishDocument(reviewer, 'raw_不存在的id'),
      (e) => e.status === 404
    );
  });
});

test('publishDocument：已发布的文档再次发布抛 409', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };

    const view = docs.upload(admin, {
      title: '重复发布测试',
      fileName: 'dup.md',
      content: '这是一段足够长的内容用于验证重复发布。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });

    docs.review(reviewer, view.id, 'approved', '第一次通过');
    docs.publishDocument(reviewer, view.id); // 第一次发布成功

    // 第二次发布：published → published 不在白名单，setStdStatus 会抛 409
    assert.throws(
      () => docs.publishDocument(reviewer, view.id),
      (e) => e.status === 409
    );
  });
});

// ============================================================
// J. 端到端回归：upload → review → publish → RAG 检索
// ============================================================

test('端到端回归：上传→审核通过→发布→RAG 引擎能检索到内容', () => {
  withTempDataDir(() => {
    const admin = { username: 'admin', role: 'admin' };
    const reviewer = { username: 'reviewer', role: 'reviewer' };
    const user = { username: 'product', role: 'product', bizLine: 'trade' };

    // 1. 上传一个包含特定关键词的文档
    const view = docs.upload(admin, {
      title: '退款政策',
      fileName: 'refund.md',
      content: '退款流程：用户在购买商品后14天内可以申请退款，退款将在7个工作日内原路返回。',
      bizLine: 'trade',
      securityLevel: 'internal',
      tags: ['退款', '售后'],
    });

    // 2. 审核通过
    docs.review(reviewer, view.id, 'approved', '内容合规，通过');

    // 3. 发布
    docs.publishDocument(reviewer, view.id);

    // 4. 加载 RAG 索引
    const rag = require('../lib/rag-engine');
    const { index } = rag.loadApprovedIndex();
    assert.ok(index, 'RAG 索引应加载成功');
    assert.ok(index.vectors.length > 0, 'RAG 索引应有向量');

    // 5. 检索：普通用户搜索"退款"应能命中
    const results = rag.retrieve(user, '退款', index, 5);
    assert.ok(Array.isArray(results), '检索结果应为数组');
    const hasRefund = results.some(r =>
      r.content && r.content.includes('退款')
    );
    assert.ok(hasRefund, 'RAG 检索结果应包含刚发布的退款内容');

    // 6. 检索：不相关查询返回的分数应该很低（单文档语料中可能仍有召回，但分数应远低于相关查询）
    const unrelated = rag.retrieve(user, '航天飞机', index, 5);
    if (unrelated.length > 0) {
      // 不相关查询分数应显著低于相关查询的分数
      assert.ok(unrelated[0].score < results[0].score, '不相关查询的分数应显著低于相关查询');
    }
  });
});
