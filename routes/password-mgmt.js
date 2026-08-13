/**
 * 密码管理 API 路由（需求文档第十章）
 *
 * 职责：
 * - 获取口令状态
 * - 修改访问口令（需要管理员口令）
 * - 重置口令
 * - 生成安全口令建议
 */

const express = require('express');
const passwordMgmt = require('../lib/password-mgmt');

const router = express.Router();

/**
 * GET /api/password-mgmt/status
 * 获取口令设置状态
 */
router.get('/status', (req, res) => {
  try {
    const status = passwordMgmt.getPasswordStatus();
    res.json({
      ok: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/password-mgmt/change
 * 修改访问口令（需要管理员口令）
 */
router.post('/change', (req, res) => {
  const { adminPassword, newAdminPassword, newAccessPassword } = req.body;

  if (!adminPassword || !newAdminPassword || !newAccessPassword) {
    return res.status(400).json({
      ok: false,
      error: 'adminPassword、newAdminPassword、newAccessPassword 必填',
    });
  }

  try {
    const result = passwordMgmt.changePassword(
      adminPassword,
      newAdminPassword,
      newAccessPassword
    );

    if (!result.ok) {
      return res.status(403).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      message: result.message,
      changedAt: result.changedAt,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/password-mgmt/reset
 * 重置为默认口令（需要管理员口令）
 */
router.post('/reset', (req, res) => {
  const { adminPassword } = req.body;

  if (!adminPassword) {
    return res.status(400).json({
      ok: false,
      error: 'adminPassword 必填',
    });
  }

  try {
    const result = passwordMgmt.resetPassword(adminPassword);

    if (!result.ok) {
      return res.status(403).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      message: result.message,
      defaultPassword: result.defaultPassword,
      resetAt: result.resetAt,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/password-mgmt/suggest
 * 获取安全口令建议（不需要身份验证）
 */
router.get('/suggest', (req, res) => {
  try {
    const suggestedPassword = passwordMgmt.generateSecurePassword();

    res.json({
      ok: true,
      suggestedPassword,
      format: '包含大小写字母、数字、特殊字符',
      length: suggestedPassword.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

module.exports = router;
