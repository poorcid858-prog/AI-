/**
 * 认证与权限路由
 */

const express = require('express');
const auth = require('../lib/auth');
const config = require('../config');

const router = express.Router();

/** 登录 */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '请输入账号和密码' });
  }
  const result = auth.login(String(username).trim(), String(password));
  if (!result.ok) return res.status(401).json(result);

  res.json({
    ok: true,
    token: result.token,
    user: result.user,
    // 前端据此决定渲染哪些入口（后端仍会独立校验，前端隐藏只是体验）
    permissions: {
      canWrite: auth.canWrite(auth.userByToken(result.token)),
      canReview: auth.canReview(auth.userByToken(result.token)),
      accessibleBizLines: auth.accessibleBizLines(auth.userByToken(result.token)),
      maxSecurityLevel: auth.maxSecurityLevel(auth.userByToken(result.token)),
    },
  });
});

/** 当前登录用户 */
router.get('/me', auth.requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: auth.publicView(req.user),
    permissions: {
      canWrite: auth.canWrite(req.user),
      canReview: auth.canReview(req.user),
      accessibleBizLines: auth.accessibleBizLines(req.user),
      maxSecurityLevel: auth.maxSecurityLevel(req.user),
    },
    system: {
      llmMode: config.llm.mode,
      readonlyMode: config.readonlyMode,
    },
  });
});

/** 登出 */
router.post('/logout', auth.requireAuth, (req, res) => {
  auth.logout(auth.readToken(req));
  res.json({ ok: true });
});

/**
 * 演示用：列出所有可登录账号（不含密码）
 * 让你和传阅链接的人不必记账号，登录页可直接点选。
 */
router.get('/demo-accounts', (req, res) => {
  const accounts = auth.loadUsers().map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    roleLabel: (config.roles[u.role] || {}).label || u.role,
    bizLine: u.bizLine,
    bizLineLabel: config.bizLines[u.bizLine] || u.bizLine,
    department: u.department,
    avatar: u.avatar,
    readonly: Boolean(u.readonly),
  }));
  res.json({ ok: true, accounts, hint: '演示环境统一密码 123456' });
});

module.exports = router;
