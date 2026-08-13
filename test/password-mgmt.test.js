/**
 * 密码管理功能测试（需求文档第十章）
 *
 * 功能：
 * 1. 获取当前访问口令状态
 * 2. 修改访问口令（使用管理员口令保护）
 * 3. 验证访问口令
 */

const test = require('node:test');
const assert = require('node:assert');
const passwordMgmt = require('../lib/password-mgmt');

// ============ 口令验证 ============

test('P1: verifyPassword 验证正确的口令', () => {
  const isValid = passwordMgmt.verifyPassword('demo123', 'demo123');
  assert.strictEqual(isValid, true, '正确的口令应返回 true');
});

test('P1b: verifyPassword 验证错误的口令', () => {
  const isValid = passwordMgmt.verifyPassword('demo123', 'wrong123');
  assert.strictEqual(isValid, false, '错误的口令应返回 false');
});

test('P1c: verifyPassword 空口令', () => {
  const isValid = passwordMgmt.verifyPassword('demo123', '');
  assert.strictEqual(isValid, false, '空口令应返回 false');
});

// ============ 口令修改 ============

test('P2: changePassword 使用管理员口令修改访问口令', () => {
  const result = passwordMgmt.changePassword(
    'admin-pwd',       // 当前管理员口令（默认值）
    'new-admin-pwd',   // 新管理员口令
    'new-access-pwd'   // 新访问口令
  );

  assert(result.ok, '修改应成功');
  assert(result.newAccessPassword !== undefined, '应返回新口令');
});

test('P2b: changePassword 管理员口令错误拒绝修改', () => {
  const result = passwordMgmt.changePassword(
    'wrong-admin-pwd',
    'new-admin-pwd',
    'new-access-pwd'
  );

  assert.strictEqual(result.ok, false, '管理员口令错误应拒绝');
});

test('P2c: changePassword 必填字段验证', () => {
  const result = passwordMgmt.changePassword('', 'new', 'new');
  assert.strictEqual(result.ok, false, '管理员口令为空应拒绝');
});

// ============ 口令状态 ============

test('P3: getPasswordStatus 返回口令设置状态', () => {
  const status = passwordMgmt.getPasswordStatus();

  assert(status !== undefined, '应返回状态对象');
  assert(status.hasAccessPassword !== undefined, '应包含 hasAccessPassword');
  assert(status.hasAdminPassword !== undefined, '应包含 hasAdminPassword');
  assert(status.lastChanged !== undefined, '应包含 lastChanged');
});

// ============ 口令重置 ============

test('P4: resetPassword 使用管理员口令重置访问口令为默认值', () => {
  // 使用 P2 中修改后的管理员口令
  const result = passwordMgmt.resetPassword('new-admin-pwd');

  assert(result.ok, '重置应成功');
  assert(result.defaultPassword !== undefined, '应返回默认口令');
});

test('P4b: resetPassword 管理员口令错误拒绝重置', () => {
  const result = passwordMgmt.resetPassword('wrong-pwd');

  assert.strictEqual(result.ok, false, '管理员口令错误应拒绝');
});

// ============ 口令建议 ============

test('P5: generateSecurePassword 生成安全口令建议', () => {
  const pwd = passwordMgmt.generateSecurePassword();

  assert(typeof pwd === 'string', '应返回字符串');
  assert(pwd.length >= 12, '口令长度应至少 12 字符');
  assert(/[a-z]/.test(pwd), '应包含小写字母');
  assert(/[A-Z]/.test(pwd), '应包含大写字母');
  assert(/[0-9]/.test(pwd), '应包含数字');
});
