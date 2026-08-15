/**
 * 客服管理后台路由
 *
 * 需求 3：AI 客服独立子系统
 * 职责：话术库、同义词表、未命中池的 CRUD 操作 + 效果指标看板
 * 数据层：lib/service-store.js（JSON 文件持久化）
 */

const express = require('express');
const auth = require('../lib/auth');
const serviceStore = require('../lib/service-store');

const router = express.Router();

// 所有管理接口都需要登录
router.use(auth.requireAuth);

/**
 * GET /api/service-admin/phrases
 * 获取话术库列表
 */
router.get('/phrases', (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const phrases = serviceStore.listPhrases();
  const start = (Number(page) - 1) * Number(limit);
  const end = start + Number(limit);
  res.json({
    ok: true,
    data: phrases.slice(start, end),
    total: phrases.length,
    page: Number(page),
    limit: Number(limit),
  });
});

/**
 * POST /api/service-admin/phrases
 * 新增话术
 */
router.post('/phrases', (req, res) => {
  const { keyword, reply, priority = 1 } = req.body;
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ ok: false, error: 'keyword 不能为空' });
  }
  if (!reply || !reply.trim()) {
    return res.status(400).json({ ok: false, error: 'reply 不能为空' });
  }
  const phrase = serviceStore.addPhrase({
    keyword,
    reply,
    priority: parseInt(priority),
  });
  res.status(201).json({ ok: true, data: phrase });
});

/**
 * PUT /api/service-admin/phrases/:id
 * 编辑话术
 */
router.put('/phrases/:id', (req, res) => {
  const { keyword, reply, priority } = req.body;
  const phrase = serviceStore.updatePhrase(req.params.id, {
    keyword,
    reply,
    priority: priority !== undefined ? parseInt(priority) : undefined,
  });
  if (!phrase) return res.status(404).json({ ok: false, error: '话术不存在' });
  res.json({ ok: true, data: phrase });
});

/**
 * DELETE /api/service-admin/phrases/:id
 * 删除话术
 */
router.delete('/phrases/:id', (req, res) => {
  const deleted = serviceStore.deletePhrase(req.params.id);
  if (!deleted) return res.status(404).json({ ok: false, error: '话术不存在' });
  res.json({ ok: true, deleted: true });
});

/**
 * GET /api/service-admin/synonyms
 * 获取同义词表
 */
router.get('/synonyms', (req, res) => {
  const synonyms = serviceStore.listSynonyms();
  res.json({ ok: true, data: synonyms, total: synonyms.length });
});

/**
 * POST /api/service-admin/synonyms
 * 新增同义词
 */
router.post('/synonyms', (req, res) => {
  const { keyword, variants } = req.body;
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ ok: false, error: 'keyword 不能为空' });
  }
  if (!Array.isArray(variants)) {
    return res.status(400).json({ ok: false, error: 'variants 必须是数组' });
  }
  const synonym = serviceStore.addSynonym({ keyword, variants });
  res.status(201).json({ ok: true, data: synonym });
});

/**
 * PUT /api/service-admin/synonyms/:id
 * 编辑同义词
 */
router.put('/synonyms/:id', (req, res) => {
  const { keyword, variants } = req.body;
  const synonym = serviceStore.updateSynonym(req.params.id, {
    keyword,
    variants: Array.isArray(variants) ? variants : undefined,
  });
  if (!synonym) return res.status(404).json({ ok: false, error: '同义词不存在' });
  res.json({ ok: true, data: synonym });
});

/**
 * DELETE /api/service-admin/synonyms/:keyword
 * 删除同义词
 */
router.delete('/synonyms/:keyword', (req, res) => {
  const deleted = serviceStore.deleteSynonym(req.params.keyword);
  if (!deleted) return res.status(404).json({ ok: false, error: '同义词不存在' });
  res.json({ ok: true, deleted: true });
});

/**
 * GET /api/service-admin/unmatched
 * 获取未命中问题池
 */
router.get('/unmatched', (req, res) => {
  const unmatched = serviceStore.listUnmatched();
  res.json({ ok: true, data: unmatched, total: unmatched.length });
});

/**
 * DELETE /api/service-admin/unmatched/:id
 * 删除未命中问题
 */
router.delete('/unmatched/:id', (req, res) => {
  const deleted = serviceStore.deleteUnmatched(req.params.id);
  if (!deleted) return res.status(404).json({ ok: false, error: '未命中记录不存在' });
  res.json({ ok: true, deleted: true });
});

/**
 * DELETE /api/service-admin/unmatched
 * 清空未命中问题池
 */
router.delete('/unmatched', (req, res) => {
  serviceStore.clearUnmatched();
  res.json({ ok: true, deleted: true });
});

/**
 * GET /api/service-admin/metrics
 * 客服效果指标看板
 */
router.get('/metrics', (req, res) => {
  const metrics = serviceStore.calculateMetrics();
  res.json({ ok: true, data: metrics });
});

module.exports = router;
