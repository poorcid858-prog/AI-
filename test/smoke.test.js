const { test } = require('node:test');
const assert = require('node:assert');

// 工程基建自检：确认 node:test 测试框架可用、项目结构就位。
// 后续每个 [TDD] 步骤会在 test/ 下新增各自的测试文件。
test('测试框架可用', () => {
  assert.strictEqual(1 + 1, 2);
});

test('package.json 配置正确', () => {
  const pkg = require('../package.json');
  assert.strictEqual(pkg.name, 'ai-assistant');
  assert.strictEqual(pkg.main, 'server.js');
  assert.ok(pkg.scripts.test.includes('node --test'), 'test 脚本应使用 node 内置测试运行器');
});
