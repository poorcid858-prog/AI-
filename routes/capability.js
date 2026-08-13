/**
 * /api/capabilities 路由 —— AI 能力中心可编辑（Task 2）
 *
 * 全量 CRUD + 草稿管理 + 版本管理 + 试跑 + 审计
 *
 * 接口：
 *   GET    /             列表（listCapabilitySummaries）
 *   GET    /:id          详情（getCapability）
 *   POST   /:id/draft    编辑草稿（editDraft）
 *   GET    /:id/draft    获取草稿（getDraft）
 *   DELETE /:id/draft    弃稿（discardDraft）
 *   POST   /:id/publish  发布（publishDraft）
 *   POST   /:id/rollback 回滚（rollbackToVersion）
 *   GET    /:id/versions 版本历史（getVersionHistory）
 *   GET    /audit        审计日志（getAuditLog）
 *   POST   /:id/trial    试跑（trialRun）
 *   POST   /diff         文本差异（diffTexts）
 *   GET    /:id/published 获取生效版（getPublished）
 */

const express = require('express');
const auth = require('../lib/auth');
const cap = require('../lib/capability-engine');

const router = express.Router();

// ---------- 统一错误处理 ----------

function sendError(res, e) {
  const code = Number.isInteger(e.status) ? e.status : 500;
  const msg = code === 500 ? '服务器内部错误' : e.message;
  if (code === 500) console.error('[capabilities] 意外异常:', e);
  res.status(code).json({ ok: false, error: msg });
}

// 写操作需要认证 + 写入权限
const requireWrite = [auth.requireAuth, auth.requireWrite];

// ============================================================
// 列表
// ============================================================

router.get('/', auth.requireAuth, (req, res) => {
  try {
    const summaries = cap.listCapabilitySummaries();
    res.json({ ok: true, capabilities: summaries, total: summaries.length });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 审计日志（必须注册在 /:id 之前，否则 audit 会被当 :id 匹配）
// ============================================================

router.get('/audit', auth.requireAuth, (req, res) => {
  try {
    const { capId, limit } = req.query;
    const logs = cap.getAuditLog({ capId, limit: limit ? Number(limit) : undefined });
    res.json({ ok: true, logs, total: logs.length });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 详情
// ============================================================

router.get('/:id', auth.requireAuth, (req, res) => {
  try {
    const c = cap.getCapability(req.params.id);
    if (!c) return res.status(404).json({ ok: false, error: '能力不存在' });
    res.json({ ok: true, capability: c });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 生效版
// ============================================================

router.get('/:id/published', auth.requireAuth, (req, res) => {
  try {
    const published = cap.getPublished(req.params.id);
    res.json({ ok: true, published });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 编辑草稿
// ============================================================

router.post('/:id/draft', requireWrite, (req, res) => {
  try {
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ ok: false, error: '缺少 content' });
    const result = cap.editDraft(req.params.id, content, req.user.username);
    res.json({ ok: true, capability: result });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 获取草稿
// ============================================================

router.get('/:id/draft', auth.requireAuth, (req, res) => {
  try {
    const draft = cap.getDraft(req.params.id);
    res.json({ ok: true, draft });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 弃稿
// ============================================================

router.delete('/:id/draft', requireWrite, (req, res) => {
  try {
    const result = cap.discardDraft(req.params.id, req.user.username);
    res.json({ ok: true, capability: result });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 发布
// ============================================================

router.post('/:id/publish', requireWrite, (req, res) => {
  try {
    const result = cap.publishDraft(req.params.id, req.user.username);
    res.json({ ok: true, capability: result });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 回滚
// ============================================================

router.post('/:id/rollback', requireWrite, (req, res) => {
  try {
    const { version } = req.body || {};
    if (version == null) return res.status(400).json({ ok: false, error: '缺少 version' });
    const result = cap.rollbackToVersion(req.params.id, Number(version), req.user.username);
    res.json({ ok: true, capability: result });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 版本历史
// ============================================================

router.get('/:id/versions', auth.requireAuth, (req, res) => {
  try {
    const versions = cap.getVersionHistory(req.params.id);
    res.json({ ok: true, versions });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 试跑
// ============================================================

router.post('/:id/trial', auth.requireAuth, (req, res) => {
  try {
    const { testQuestion, role, bizLine } = req.body || {};
    if (!testQuestion) return res.status(400).json({ ok: false, error: '缺少 testQuestion' });
    const result = cap.trialRun(req.params.id, testQuestion, role || 'product', bizLine || 'trade');
    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// 文本差异
// ============================================================

router.post('/diff', auth.requireAuth, (req, res) => {
  try {
    const { a, b } = req.body || {};
    const diff = cap.diffTexts(a, b);
    res.json({ ok: true, diff });
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;