// /api/admin 管理后台
const express = require('express');
const auth = require('../lib/auth');
const kl = require('../lib/knowledge-layers');
const docs = require('../lib/documents');
const qa = require('../lib/qa-store');
const promptTemplates = require('../lib/prompt-templates');
const adminConfig = require('../lib/admin-config');
const config = require('../config');
const router = express.Router();

router.get('/users', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const users = auth.loadUsers().map((u) => auth.publicView(u));
  res.json({ ok: true, users });
});

/**
 * 管理后台统计 —— 阶段 6 切到四层聚合
 *
 * 旧实现：直接 store.read('documents', []) 拉旧扁平表，
 *   字段 users / documents / documentsPending / documentsApproved /
 *   documentsRejected / totalChunks 全部从旧表统计。
 *   问题：旧表里只有 pending / approved / rejected 3 值，没有 lifecycleStatus 的 8 态语义。
 *
 * 新实现：kl.listRaws() 拿全部 raw → docs.getDocumentView(rawId) 拿聚合视图 →
 *   在 view 基础上做投影聚合：
 *     - 状态分布：按 view.lifecycleStatus 8 态聚合（不是 view.status 3 值）
 *     - 业务线 / 安全等级 / 上传者：按 view 对应字段聚合
 *     - 最近 N 条：取 view.createdAt 最新 N 条
 *
 * **关键决策**：
 *   1. 状态聚合按 view.lifecycleStatus 而非 view.status —
 *      view.status 是 3 值兼容层（前端用），view.lifecycleStatus 是 8 态（精确）。
 *      把 lifecycleStatus 投影出来，前端 admin.html 就能看到"草稿 / 待审 / 已发 / 复审中"的真实分布。
 *   2. 保留旧字段（users / documents / documentsPending / documentsApproved /
 *      documentsRejected / totalChunks）按 view.status 聚合 ——
 *      现有 admin.html 仍读这些字段（s.users / s.documents / s.documentsPending / s.totalChunks），
 *      改字段名会破前端，所以**保持字段名一致**，新字段另起（byStatus / byBizLine / ...）。
 *   3. 空库防御：kl.listRaws() 返空数组时聚合全 0，不 500。
 *
 * **性能**：N 个 raw 调 N 次 getDocumentView —— 每个 getDocumentView 内部
 *   listStdByRaw + listChunksByStd 一次。N 大时会慢，本阶段接受 N 次扫描
 *   （admin 后台接口，N 不会很大），阶段 9 重写时考虑加缓存。
 */
const RECENT_LIMIT = 10;

router.get('/stats', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  // 1. 走四层链路：listRaws + getDocumentView 投影
  const raws = kl.listRaws();
  const views = raws
    .map((raw) => docs.getDocumentView(raw.id))
    .filter((v) => v != null);

  // 2. 现有 admin.html 字段（保持不变，按 view.status 3 值聚合）
  let documentsPending = 0;
  let documentsApproved = 0;
  let documentsRejected = 0;
  let totalChunks = 0;

  // 3. 新聚合字段（按 lifecycleStatus 8 态 + 业务线 / 密级 / 上传者）
  const byStatus = {
    draft: 0, qc_failed: 0, pending: 0, approved: 0,
    published: 0, need_review: 0, rejected: 0, archived: 0,
  };
  const byBizLine = { trade: 0, membership: 0, all: 0 };
  const bySecurityLevel = { public: 0, internal: 0, confidential: 0, secret: 0 };
  const byUploader = {};

  // 4. 最近 N 条（按 createdAt 降序）
  const recent = views
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, RECENT_LIMIT)
    .map((v) => ({
      id: v.id,
      title: v.title,
      bizLine: v.bizLine,
      securityLevel: v.securityLevel,
      uploadedBy: v.uploadedBy,
      status: v.status,
      lifecycleStatus: v.lifecycleStatus,
      chunkCount: v.chunkCount,
      createdAt: v.createdAt,
    }));

  // 5. 一次循环把所有聚合算完
  for (const v of views) {
    // 旧字段（view.status 3 值）
    if (v.status === 'pending') documentsPending += 1;
    else if (v.status === 'approved') documentsApproved += 1;
    else if (v.status === 'rejected') documentsRejected += 1;
    totalChunks += v.chunkCount || 0;

    // 新字段：lifecycleStatus 8 态
    if (byStatus[v.lifecycleStatus] != null) byStatus[v.lifecycleStatus] += 1;
    // 业务线（防御：未知 bizLine 归到 __other__）
    if (byBizLine[v.bizLine] != null) byBizLine[v.bizLine] += 1;
    else byBizLine.__other__ = (byBizLine.__other__ || 0) + 1;
    // 安全等级
    if (bySecurityLevel[v.securityLevel] != null) bySecurityLevel[v.securityLevel] += 1;
    else bySecurityLevel.__other__ = (bySecurityLevel.__other__ || 0) + 1;
    // 上传者（任意用户名都允许，统计时按实际值分组）
    const uploader = v.uploadedBy || '__unknown__';
    byUploader[uploader] = (byUploader[uploader] || 0) + 1;
  }

  res.json({
    ok: true,
    stats: {
      // 旧字段（保持不变 —— 现有 admin.html 仍读这些）
      users: auth.loadUsers().length,
      documents: views.length,
      documentsPending,
      documentsApproved,
      documentsRejected,
      totalChunks,
      // 新增聚合（阶段 6：四层聚合）
      byStatus,
      byBizLine,
      bySecurityLevel,
      byUploader,
      recent,
    },
  });
});

// ---------- GET /api/admin/qa-history 问答历史列表 ----------

router.get('/qa-history', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);

  const sessions = qa.listSessions(limit + offset);
  const sliced = sessions.slice(offset, offset + limit);

  // 为每条 session 补充 userName / role / bizLine（从首条 user record 取）
  const enriched = sliced.map((s) => {
    const records = qa.listBySession(s.sessionId);
    const firstUserRecord = records.find((r) => r.type === 'user');
    return {
      sessionId: s.sessionId,
      lastTimestamp: s.lastTimestamp,
      recordCount: s.recordCount,
      summary: s.summary,
      userName: firstUserRecord?.userName || '未知',
      role: firstUserRecord?.role || '',
      bizLine: firstUserRecord?.bizLine || '',
    };
  });

  res.json({
    ok: true,
    sessions: enriched,
    total: sessions.length,
  });
});

// ---------- GET /api/admin/qa-history/:sessionId Session 详情 ----------

router.get('/qa-history/:sessionId', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  const { sessionId } = req.params;
  const records = qa.listBySession(sessionId);

  if (records.length === 0) {
    return res.status(404).json({ ok: false, error: `session 不存在: ${sessionId}` });
  }

  res.json({
    ok: true,
    session: {
      sessionId,
      records,
    },
  });
});

// ========== 提问模板 CRUD（任务包 K2）==========

// 角色白名单：全部 / 产品 / 测试 / 前端 / 客服
const PROMPT_TEMPLATE_ROLES = ['all', 'product', 'test', 'frontend', 'cs'];
const MAX_PROMPT_TEMPLATES = 10;

/** 校验 role 是否合法 */
function validPromptRole(role) {
  return PROMPT_TEMPLATE_ROLES.includes(role);
}

// GET /api/admin/prompt-templates 获取提问模板（admin 传 ?all=1 时含禁用项，供管理界面用）
router.get('/prompt-templates', auth.requireAuth, (req, res) => {
  if (req.query.all === '1') {
    if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看全部模板' });
    const templates = promptTemplates.list() || [];
    res.json({ ok: true, templates });
    return;
  }
  const role = req.query.role || 'all';
  const templates = promptTemplates.listEnabled(role);
  res.json({ ok: true, templates });
});

// POST /api/admin/prompt-templates 新增提问模板（仅 admin）
router.post('/prompt-templates', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可创建提问模板' });

  const { name, content, role = 'all', priority = 1, enabled = true } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ ok: false, error: '模板名称不能为空' });
  if (!content || !content.trim()) return res.status(400).json({ ok: false, error: '模板内容不能为空' });
  if (!validPromptRole(role)) {
    return res.status(400).json({ ok: false, error: `适用角色非法，可选: ${PROMPT_TEMPLATE_ROLES.join(', ')}` });
  }

  const existing = promptTemplates.list() || [];
  if (existing.length >= MAX_PROMPT_TEMPLATES) {
    return res.status(400).json({ ok: false, error: `最多只能配置 ${MAX_PROMPT_TEMPLATES} 条提问模板` });
  }

  const template = promptTemplates.create({
    name: name.trim(),
    content: content.trim(),
    role,
    priority: Number(priority) || 1,
    enabled: enabled !== false,
  });
  res.status(201).json({ ok: true, template });
});

// PUT /api/admin/prompt-templates/:id 更新提问模板（仅 admin）
router.put('/prompt-templates/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改提问模板' });

  const id = req.params.id;
  const { name, content, role, priority, enabled } = req.body || {};

  if (name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ ok: false, error: '模板名称不能为空' });
  }
  if (content !== undefined && (!content || !content.trim())) {
    return res.status(400).json({ ok: false, error: '模板内容不能为空' });
  }
  if (role !== undefined && !validPromptRole(role)) {
    return res.status(400).json({ ok: false, error: `适用角色非法，可选: ${PROMPT_TEMPLATE_ROLES.join(', ')}` });
  }

  const patch = {};
  if (name !== undefined) patch.name = name.trim();
  if (content !== undefined) patch.content = content.trim();
  if (role !== undefined) patch.role = role;
  if (priority !== undefined) patch.priority = Number(priority) || 1;
  if (enabled !== undefined) patch.enabled = !!enabled;

  const template = promptTemplates.update(id, patch);
  if (!template) return res.status(404).json({ ok: false, error: '提问模板不存在' });

  res.json({ ok: true, template });
});

// DELETE /api/admin/prompt-templates/:id 删除提问模板（仅 admin）
router.delete('/prompt-templates/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除提问模板' });

  const id = req.params.id;
  const success = promptTemplates.remove(id);
  if (!success) return res.status(404).json({ ok: false, error: '提问模板不存在' });

  res.json({ ok: true });
});

// ========== 密码配置 API ==========

router.get('/password-config', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const config = adminConfig.getPasswordConfig();
  res.json({ ok: true, config });
});

router.put('/password-config', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const { enabled, default_expire_minutes, max_expire_minutes, complexity } = req.body;
  const config = adminConfig.updatePasswordConfig({
    enabled,
    default_expire_minutes,
    max_expire_minutes,
    complexity,
  });
  res.json({ ok: true, config });
});

router.get('/temp-passwords', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const tempPasswords = adminConfig.listTempPasswords();
  res.json({ ok: true, tempPasswords });
});

router.post('/temp-passwords', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可生成' });
  const { password, expiryMinutes } = req.body;
  const tempPassword = adminConfig.generateTempPassword(password, expiryMinutes || 120);
  res.json({ ok: true, tempPassword });
});

// ========== Chunk 切分配置 API ==========

router.get('/chunking-config', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const config = adminConfig.getChunkingConfig();
  res.json({ ok: true, config });
});

router.put('/chunking-config', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const { strategy, max_tokens, overlap_tokens, header_level } = req.body;
  const config = adminConfig.updateChunkingConfig({
    strategy,
    max_tokens,
    overlap_tokens,
    header_level,
  });
  res.json({ ok: true, config });
});

// ========== 分层 Prompt 配置 API ==========

router.get('/prompt-layers', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const layers = adminConfig.listPromptLayers();
  res.json({ ok: true, layers });
});

router.post('/prompt-layers', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可创建' });
  const { level, role_name, business_line, prompt_text } = req.body;
  const layer = adminConfig.createPromptLayer({
    level,
    role_name,
    business_line,
    prompt_text,
  });
  res.json({ ok: true, layer });
});

router.put('/prompt-layers/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const { id } = req.params;
  const { level, role_name, business_line, prompt_text } = req.body;
  const layer = adminConfig.updatePromptLayer(parseInt(id, 10), {
    level,
    role_name,
    business_line,
    prompt_text,
  });
  if (!layer) return res.status(404).json({ ok: false, error: 'Prompt 配置不存在' });
  res.json({ ok: true, layer });
});

router.delete('/prompt-layers/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除' });
  const { id } = req.params;
  const success = adminConfig.deletePromptLayer(parseInt(id, 10));
  if (!success) return res.status(404).json({ ok: false, error: 'Prompt 配置不存在' });
  res.json({ ok: true });
});

// ========== 系统参数配置 API ==========

router.get('/system-config', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const configs = adminConfig.getAllSystemConfig();
  res.json({ ok: true, configs });
});

router.put('/system-config/:key', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const { key } = req.params;
  const { value } = req.body;
  const config = adminConfig.updateSystemConfig(key, value);
  res.json({ ok: true, config });
});

router.delete('/system-config/:key', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除' });
  const { key } = req.params;
  const success = adminConfig.deleteSystemConfig(key);
  if (!success) return res.status(404).json({ ok: false, error: '配置项不存在' });
  res.json({ ok: true });
});

// ========== 模型配置 API ==========

router.get('/models', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const models = adminConfig.listModels();
  res.json({ ok: true, models });
});

router.get('/models/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const model = adminConfig.getModel(req.params.id);
  if (!model) return res.status(404).json({ ok: false, error: '模型不存在' });
  res.json({ ok: true, model });
});

router.post('/models', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可创建' });
  const { name, type, apiUrl, apiKey, temperature, maxTokens, enabled } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: '模型名称不能为空' });
  const model = adminConfig.createModel({ name, type, apiUrl, apiKey, temperature, maxTokens, enabled });
  res.status(201).json({ ok: true, model });
});

router.put('/models/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const model = adminConfig.updateModel(req.params.id, req.body);
  if (!model) return res.status(404).json({ ok: false, error: '模型不存在' });
  res.json({ ok: true, model });
});

router.delete('/models/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除' });
  const success = adminConfig.deleteModel(req.params.id);
  if (!success) return res.status(404).json({ ok: false, error: '模型不存在' });
  res.json({ ok: true });
});

// ========== AI 日志 API ==========

router.get('/ai-logs', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const logs = adminConfig.listAiLogs(limit, offset);
  res.json({ ok: true, logs, total: adminConfig.getAllAiLogs().length });
});

router.get('/ai-logs/stats', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const stats = adminConfig.getAiLogStats();
  res.json({ ok: true, stats });
});

// ========== 用户管理 API ==========

router.post('/users', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可创建' });
  const { username, password, name, role, bizLine, department } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ ok: false, error: '用户名、密码、姓名、角色为必填项' });
  }
  const validRoles = Object.keys(config.roles);
  if (!validRoles.includes(role)) {
    return res.status(400).json({ ok: false, error: `角色非法，可选: ${validRoles.join(', ')}` });
  }
  const users = auth.loadUsers();
  if (users.find(u => u.username === username)) {
    return res.status(409).json({ ok: false, error: '用户名已存在' });
  }
  const maxId = users.reduce((m, u) => Math.max(m, parseInt((u.id || 'u_000').replace('u_', '')) || 0), 0);
  const newId = `u_${String(maxId + 1).padStart(3, '0')}`;
  const newUser = {
    id: newId,
    username,
    password,
    name,
    role,
    bizLine: bizLine || 'all',
    department: department || '',
    avatar: name[0] || 'U',
    readonly: false,
  };
  users.push(newUser);
  try {
    const fs = require('fs');
    fs.writeFileSync(config.paths.users, JSON.stringify(users, null, 2), 'utf8');
    auth.clearUsersCache();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写入用户文件失败: ' + e.message });
  }
  res.status(201).json({ ok: true, user: auth.publicView(newUser) });
});

router.put('/users/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可修改' });
  const users = auth.loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: '用户不存在' });
  const { name, role, bizLine, department, password } = req.body;
  if (name !== undefined) users[idx].name = name;
  if (role !== undefined) {
    const validRoles = Object.keys(config.roles);
    if (!validRoles.includes(role)) return res.status(400).json({ ok: false, error: `角色非法` });
    users[idx].role = role;
  }
  if (bizLine !== undefined) users[idx].bizLine = bizLine;
  if (department !== undefined) users[idx].department = department;
  if (password !== undefined) users[idx].password = password;
  try {
    const fs = require('fs');
    fs.writeFileSync(config.paths.users, JSON.stringify(users, null, 2), 'utf8');
    auth.clearUsersCache();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写入用户文件失败: ' + e.message });
  }
  res.json({ ok: true, user: auth.publicView(users[idx]) });
});

router.delete('/users/:id', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可删除' });
  const users = auth.loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: '用户不存在' });
  const deleted = users.splice(idx, 1);
  try {
    const fs = require('fs');
    fs.writeFileSync(config.paths.users, JSON.stringify(users, null, 2), 'utf8');
    auth.clearUsersCache();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '写入用户文件失败: ' + e.message });
  }
  res.json({ ok: true, deleted: auth.publicView(deleted[0]) });
});

module.exports = router;
