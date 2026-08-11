/**
 * /api/documents 路由
 *
 *   GET    /             列表（按权限过滤）
 *   POST   /upload       上传（仅 admin）
 *   GET    /:id          详情
 *   POST   /:id/review   审核（仅 reviewer）
 *   DELETE /:id          删除（仅 admin）
 *   GET    /:id/chunks   查看文档的所有切片（仅 admin/reviewer）
 */

const express = require('express');
const auth = require('../lib/auth');
const docs = require('../lib/documents');

const router = express.Router();

// 列表
router.get('/', auth.requireAuth, (req, res) => {
  const opts = {};
  if (req.query.status) opts.status = req.query.status;
  const list = docs.listForUser(req.user, opts).map((d) => docs.publicView(d, req.user));
  res.json({ ok: true, documents: list, total: list.length });
});

// 待审核列表（reviewer 与 admin）
router.get('/pending', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅审核员可看待审核列表' });
  }
  const list = docs.listForUser(req.user, { status: 'pending' }).map((d) => docs.publicView(d, req.user));
  res.json({ ok: true, documents: list, total: list.length });
});

// 上传
router.post('/upload', auth.requireAuth, auth.requireWrite, (req, res) => {
  try {
    const doc = docs.upload(req.user, req.body);
    res.json({ ok: true, document: docs.publicView(doc, req.user) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

// 详情
router.get('/:id', auth.requireAuth, (req, res) => {
  const store = require('../lib/store');
  const doc = store.read('documents', []).find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ ok: false, error: '文档不存在' });
  // 内部岗位只看自己业务线 + 密级
  if (req.user.role !== 'admin' && req.user.role !== 'reviewer' && !req.user.readonly) {
    if (doc.status !== 'approved') return res.status(403).json({ ok: false, error: '该文档尚未审核通过' });
    const lines = auth.accessibleBizLines(req.user);
    if (doc.bizLine !== 'all' && !lines.includes(doc.bizLine)) {
      return res.status(403).json({ ok: false, error: '无权查看其他业务线文档' });
    }
    const maxSec = auth.maxSecurityLevel(req.user);
    if (require('../config').securityLevels[doc.securityLevel] > maxSec) {
      return res.status(403).json({ ok: false, error: '文档密级超出当前角色权限' });
    }
  }
  res.json({ ok: true, document: docs.publicView(doc, req.user) });
});

// 审核
router.post('/:id/review', auth.requireAuth, auth.requireReview, (req, res) => {
  try {
    const { decision, note } = req.body || {};
    const doc = docs.review(req.user, req.params.id, decision, note);
    res.json({ ok: true, document: docs.publicView(doc, req.user) });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

// 删除
router.delete('/:id', auth.requireAuth, auth.requireWrite, (req, res) => {
  try {
    const ok = docs.remove(req.user, req.params.id);
    res.json({ ok });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

// 切片列表（仅管理员/审核员）
router.get('/:id/chunks', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
    return res.status(403).json({ ok: false, error: '仅审核员可查看切片' });
  }
  const store = require('../lib/store');
  const doc = store.read('documents', []).find((d) => d.id === req.params.id);
  if (!doc) return res.status(404).json({ ok: false, error: '文档不存在' });
  res.json({ ok: true, docId: doc.id, chunkCount: doc.chunkCount, chunks: doc.chunks || [] });
});

module.exports = router;
