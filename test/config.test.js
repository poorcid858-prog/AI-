const { test } = require('node:test');
const assert = require('node:assert');
const config = require('../config');

test('默认运行在模拟模式，无需 API Key', () => {
  assert.strictEqual(config.llm.mode, 'mock');
});

test('默认关闭只读模式（本地开发）', () => {
  assert.strictEqual(config.readonlyMode, false);
});

test('安全等级数值递增，public 最低', () => {
  const { securityLevels: s } = config;
  assert.ok(s.public < s.internal);
  assert.ok(s.internal < s.confidential);
  assert.ok(s.confidential < s.secret);
  assert.strictEqual(s.public, 0);
});

test('七个角色均已定义且标注了权限位', () => {
  const expected = ['admin', 'reviewer', 'product', 'test', 'frontend', 'cs', 'guest'];
  for (const role of expected) {
    assert.ok(config.roles[role], `缺少角色定义: ${role}`);
    assert.strictEqual(typeof config.roles[role].canWrite, 'boolean');
  }
});

test('只有 admin 拥有写权限，只有 reviewer 拥有审核权限', () => {
  const writers = Object.keys(config.roles).filter((r) => config.roles[r].canWrite);
  const reviewers = Object.keys(config.roles).filter((r) => config.roles[r].canReview);
  assert.deepStrictEqual(writers, ['admin']);
  assert.deepStrictEqual(reviewers, ['admin', 'reviewer']);
});

test('guest 无写权限、无审核权限，但可以使用系统', () => {
  assert.strictEqual(config.roles.guest.canWrite, false);
  assert.strictEqual(config.roles.guest.canReview, false);
  assert.strictEqual(config.roles.guest.canUse, true);
});

test('RAG 重排序后的条数不超过召回条数', () => {
  assert.ok(config.rag.rerankTopK <= config.rag.recallTopK);
});
