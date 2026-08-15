/**
 * 认证与权限路由
 */

const express = require('express');
const auth = require('../lib/auth');
const config = require('../config');

const router = express.Router();

/** 登录（支持双口令模式） */
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '请输入账号和密码' });
  }

  // 双口令模式：用口令登录，不走账号密码
  if (config.dualPassword.enabled) {
    const trimmed = String(password).trim();
    const guestMode = trimmed === config.dualPassword.guest;
    const debugMode = trimmed === config.dualPassword.debug;

    if (!guestMode && !debugMode) {
      return res.status(401).json({ ok: false, error: '口令错误' });
    }

    // 找匹配的账号（按 username 找，忽略密码）
    // 访客口令 → 用 guest 身份（readonly=true）
    // 调试口令 → 用 admin 身份（readonly=false）
    const targetUser = auth.loadUsers().find((u) => u.username === (guestMode ? 'guest' : 'admin'));
    if (!targetUser) {
      return res.status(500).json({ ok: false, error: '系统配置错误，无法登录' });
    }

    const result = auth.login(targetUser.username, targetUser.password);
    if (!result.ok) return res.status(401).json(result);

    return res.json({
      ok: true,
      token: result.token,
      user: result.user,
      permissions: {
        canWrite: auth.canWrite(auth.userByToken(result.token)),
        canReview: auth.canReview(auth.userByToken(result.token)),
        accessibleBizLines: auth.accessibleBizLines(auth.userByToken(result.token)),
        maxSecurityLevel: auth.maxSecurityLevel(auth.userByToken(result.token)),
      },
      dualPasswordMode: true,
      mode: guestMode ? 'guest' : 'debug',
    });
  }

  // 常规账号密码登录
  const result = auth.login(String(username).trim(), String(password));
  if (!result.ok) return res.status(401).json(result);

  res.json({
    ok: true,
    token: result.token,
    user: result.user,
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

/** 双口令演示登录（简化：通过环境变量口令直接获取 token，不验证账号密码） */
router.post('/demo-login', (req, res) => {
  const { mode } = req.query; // 'guest' | 'debug'
  if (!config.dualPassword.enabled) {
    return res.status(400).json({ ok: false, error: '双口令模式未启用' });
  }
  if (mode !== 'guest' && mode !== 'debug') {
    return res.status(400).json({ ok: false, error: '无效的登录模式' });
  }

  const targetUser = auth.loadUsers().find((u) => u.username === (mode === 'guest' ? 'guest' : 'admin'));
  if (!targetUser) {
    return res.status(500).json({ ok: false, error: '系统配置错误' });
  }

  const result = auth.login(targetUser.username, targetUser.password);
  if (!result.ok) return res.status(401).json(result);

  res.json({
    ok: true,
    token: result.token,
    user: result.user,
    permissions: {
      canWrite: auth.canWrite(auth.userByToken(result.token)),
      canReview: auth.canReview(auth.userByToken(result.token)),
      accessibleBizLines: auth.accessibleBizLines(auth.userByToken(result.token)),
      maxSecurityLevel: auth.maxSecurityLevel(auth.userByToken(result.token)),
    },
    dualPasswordMode: true,
    mode,
  });
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
