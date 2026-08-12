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

test('publicView：管理员可见完整 content 与 chunks', () => {
  const doc = {
    id: 'doc_1', content: '完整原文', chunks: [{ content: '片段 A' }, { content: '片段 B' }],
    status: 'pending',
  };
  const view = docs.publicView(doc, { role: 'admin' });
  assert.strictEqual(view.content, '完整原文', '管理员看不到原文');
  assert.ok(Array.isArray(view.chunks) && view.chunks.length === 2, '管理员看不到切片');
});

test('publicView：审核员可见完整 content 与 chunks', () => {
  const doc = { id: 'doc_1', content: '完整原文', chunks: [{ content: '片段' }], status: 'pending' };
  const view = docs.publicView(doc, { role: 'reviewer' });
  assert.strictEqual(view.content, '完整原文');
  assert.ok(view.chunks);
});

test('publicView：普通用户不可见 content 与 chunks（防 B1 复发）', () => {
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
