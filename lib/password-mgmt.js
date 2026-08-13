/**
 * 密码管理库（需求文档第十章）
 *
 * 职责：
 * 1. 访问口令验证
 * 2. 口令修改（通过管理员口令保护）
 * 3. 口令状态管理
 */

// 模拟存储（实际应存于配置文件或环境变量）
let passwordStore = {
  accessPassword: 'demo123',      // 访客访问口令
  adminPassword: 'admin-pwd',     // 管理员口令（用于修改访问口令）
  lastChanged: new Date('2026-08-12'),
};

/**
 * 验证口令
 */
function verifyPassword(expected, actual) {
  if (!expected || !actual) {
    return false;
  }
  return expected === actual;
}

/**
 * 修改口令（需要管理员口令）
 */
function changePassword(currentAdminPwd, newAdminPwd, newAccessPwd) {
  if (!currentAdminPwd || !newAdminPwd || !newAccessPwd) {
    return { ok: false, error: '必填字段不能为空' };
  }

  // 验证管理员口令
  if (currentAdminPwd !== passwordStore.adminPassword) {
    return { ok: false, error: '管理员口令错误' };
  }

  // 更新口令
  passwordStore.adminPassword = newAdminPwd;
  passwordStore.accessPassword = newAccessPwd;
  passwordStore.lastChanged = new Date();

  return {
    ok: true,
    message: '口令已更新',
    newAccessPassword: newAccessPwd,
    changedAt: passwordStore.lastChanged,
  };
}

/**
 * 获取口令状态
 */
function getPasswordStatus() {
  return {
    hasAccessPassword: !!passwordStore.accessPassword,
    hasAdminPassword: !!passwordStore.adminPassword,
    lastChanged: passwordStore.lastChanged,
    accessPasswordLength: passwordStore.accessPassword?.length,
  };
}

/**
 * 重置访问口令为默认值（需要管理员口令）
 */
function resetPassword(adminPwd) {
  if (!adminPwd) {
    return { ok: false, error: '管理员口令不能为空' };
  }

  if (adminPwd !== passwordStore.adminPassword) {
    return { ok: false, error: '管理员口令错误' };
  }

  const defaultPassword = 'demo123';
  passwordStore.accessPassword = defaultPassword;
  passwordStore.lastChanged = new Date();

  return {
    ok: true,
    message: '已重置为默认口令',
    defaultPassword,
    resetAt: passwordStore.lastChanged,
  };
}

/**
 * 生成安全口令建议
 */
function generateSecurePassword() {
  const chars = {
    lower: 'abcdefghijklmnopqrstuvwxyz',
    upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    special: '!@#$%^&*',
  };

  const allChars = Object.values(chars).join('');

  let password = '';
  // 确保包含各类字符
  password += chars.lower[Math.floor(Math.random() * chars.lower.length)];
  password += chars.upper[Math.floor(Math.random() * chars.upper.length)];
  password += chars.digits[Math.floor(Math.random() * chars.digits.length)];
  password += chars.special[Math.floor(Math.random() * chars.special.length)];

  // 填充到 16 个字符
  while (password.length < 16) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // 随机打乱
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * 获取当前访问口令（仅内部使用）
 */
function getCurrentAccessPassword() {
  return passwordStore.accessPassword;
}

/**
 * 设置初始口令（启动时调用）
 */
function initializePasswords(config) {
  if (config?.accessPassword) {
    passwordStore.accessPassword = config.accessPassword;
  }
  if (config?.adminPassword) {
    passwordStore.adminPassword = config.adminPassword;
  }
}

module.exports = {
  verifyPassword,
  changePassword,
  getPasswordStatus,
  resetPassword,
  generateSecurePassword,
  getCurrentAccessPassword,
  initializePasswords,
};
