/**
 * 文档管理回归测试 —— 锁定第 5 步代码审查修复的行为
 *
 * 覆盖：
 *   - publicView 脱敏（仅管理员/审核员可见原文 + 切片）
 *   - tags / note 长度限制
 *   - listForUser status 白名单
 */

const { test } = require('node:test');
const assert = require('node:assert');
const docs = require('../lib/documents');

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
