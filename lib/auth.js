/**
 * 认证与权限
 *
 * 三层能力，对应产品方案里的"权限过滤"环节：
 *   1. 身份认证 —— 账号密码登录，签发 token
 *   2. 角色权限 —— 谁能上传、谁能审核、谁只能使用
 *   3. 业务线隔离 —— 决定一个用户能检索到哪些知识（RAG 检索前的过滤条件）
 *
 * 安全说明：token 用内存 Map 保存、密码明文比对，是演示项目的刻意简化。
 * 生产环境应改为 JWT + bcrypt —— 这一点在项目说明文档里作为"已知取舍"记录。
 */

const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');

/** token -> user 的会话表（进程内，重启即失效） */
const sessions = new Map();

let usersCache = null;

function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = JSON.parse(fs.readFileSync(config.paths.users, 'utf8'));
  } catch (err) {
    console.error('[auth] users.json 读取失败:', err.message);
    usersCache = [];
  }
  return usersCache;
}

function clearUsersCache() {
  usersCache = null;
}

/** 剔除密码字段后的用户视图 —— 任何返回给前端的用户对象都必须走这里 */
function publicView(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return {
    ...safe,
    roleLabel: (config.roles[user.role] || {}).label || user.role,
    bizLineLabel: config.bizLines[user.bizLine] || user.bizLine,
  };
}

/**
 * 登录
 * @returns {{ok: boolean, token?: string, user?: object, error?: string}}
 */
function login(username, password) {
  const user = loadUsers().find((u) => u.username === username);
  if (!user || user.password !== password) {
    // 不区分"用户不存在"和"密码错误"，避免账号枚举
    return { ok: false, error: '账号或密码错误' };
  }
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { userId: user.id, loginAt: Date.now() });
  return { ok: true, token, user: publicView(user) };
}

function logout(token) {
  return sessions.delete(token);
}

/** 由 token 取出完整用户对象（含 password，内部使用） */
function userByToken(token) {
  const session = sessions.get(token);
  if (!session) return null;
  return loadUsers().find((u) => u.id === session.userId) || null;
}

// ---------- 权限判定 ----------

function can(user, action) {
  if (!user) return false;
  const role = config.roles[user.role];
  if (!role) return false;
  // 只读模式下，标记了 readonly 的账号（guest）一律不得写入
  if (config.readonlyMode && user.readonly && action === 'write') return false;
  if (user.readonly && action === 'write') return false;
  if (user.readonly && action === 'review') return false;
  return Boolean(role[`can${action[0].toUpperCase()}${action.slice(1)}`]);
}

const canWrite = (user) => can(user, 'write');
const canReview = (user) => can(user, 'review');
const canUse = (user) => can(user, 'use');

/**
 * 用户可访问的业务线列表
 * bizLine=all 的账号可跨线检索；否则只能访问本业务线
 */
function accessibleBizLines(user) {
  if (!user) return [];
  if (user.bizLine === 'all') return ['trade', 'membership'];
  return [user.bizLine];
}

/**
 * 用户可访问的最高安全等级（数值）
 *
 * 这是整个权限模型最关键的一处设计：
 * 客服（cs）与访客（guest）只能读 public，因为客服面向外部客户，
 * 一旦能读到 internal 就等于内部业务规则可被外部套话套出来。
 */
function maxSecurityLevel(user) {
  if (!user) return -1;
  const S = config.securityLevels;
  switch (user.role) {
    case 'admin':
    case 'reviewer':
      return S.secret;
    case 'product':
    case 'test':
    case 'frontend':
      return S.confidential;
    case 'cs':
    case 'guest':
      return S.public;
    default:
      return S.public;
  }
}

// ---------- Express 中间件 ----------

function readToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return req.headers['x-token'] || req.query.token || '';
}

/** 要求已登录，通过后 req.user 可用 */
function requireAuth(req, res, next) {
  const user = userByToken(readToken(req));
  if (!user) {
    return res.status(401).json({ ok: false, error: '未登录或登录已过期' });
  }
  req.user = user;
  next();
}

/**
 * 拦截写操作 —— 上云安全的核心
 *
 * 拦截点必须在后端。前端隐藏按钮只是体验优化，
 * 任何人打开控制台直接调接口就能绕过前端。
 */
function requireWrite(req, res, next) {
  if (!canWrite(req.user)) {
    return res.status(403).json({
      ok: false,
      error: req.user && req.user.readonly
        ? '演示账号为只读模式，无法执行写操作'
        : '当前角色无写入权限（仅系统管理员可操作）',
    });
  }
  next();
}

function requireReview(req, res, next) {
  if (!canReview(req.user)) {
    return res.status(403).json({
      ok: false,
      error: req.user && req.user.readonly
        ? '演示账号为只读模式，无法执行审核操作'
        : '当前角色无审核权限（仅审核专员可操作）',
    });
  }
  next();
}

module.exports = {
  login,
  logout,
  userByToken,
  publicView,
  loadUsers,
  clearUsersCache,
  canWrite,
  canReview,
  canUse,
  accessibleBizLines,
  maxSecurityLevel,
  requireAuth,
  requireWrite,
  requireReview,
  readToken,
};
