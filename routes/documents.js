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

// 状态枚举白名单（防御非法探测）
const VALID_STATUS = ['pending', 'approved', 'rejected'];

// 统一错误响应：业务异常用 e.status（400/403/404/409），意外异常 500
function sendError(res, e) {
  const code = Number.isInteger(e.status) ? e.status : 500;
  const msg = code === 500 ? '服务器内部错误' : e.message;
  if (code === 500) console.error('[documents] 意外异常:', e);
  res.status(code).json({ ok: false, error: msg });
}

// 列表
router.get('/', auth.requireAuth, (req, res) => {
  const opts = {};
  if (req.query.status) {
    if (!VALID_STATUS.includes(req.query.status)) {
      return res.status(400).json({ ok: false, error: `status 非法: ${req.query.status}` });
    }
    opts.status = req.query.status;
  }
  const list = docs.listForUser(req.user, opts).map((d) => docs.publicView(d, req.user));
  res.json({ ok: true, documents: list, total: list.length });
});

// 待审核列表（reviewer 与 admin）
router.get('/pending', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'reviewer' && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅审核员可看待审核列表' });
  }

  // 查询参数处理
  const search = (req.query.search || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.max(10, Math.min(100, parseInt(req.query.pageSize) || 20));

  // 获取待审核文档列表
  let list = docs.listForUser(req.user, { status: 'pending' });

  // 搜索过滤：按文件名或 ID 搜索
  if (search) {
    list = list.filter((d) =>
      d.title.toLowerCase().includes(search.toLowerCase()) ||
      d.id.toLowerCase().includes(search.toLowerCase())
    );
  }

  // 排序：按上传时间倒序
  list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // 分页
  const total = list.length;
  const startIdx = (page - 1) * pageSize;
  const endIdx = startIdx + pageSize;
  const paginated = list.slice(startIdx, endIdx);

  const documents = paginated.map((d) => docs.publicView(d, req.user));
  res.json({
    ok: true,
    documents,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize)
  });
});

// 上传
router.post('/upload', auth.requireAuth, auth.requireWrite, (req, res) => {
  try {
    const doc = docs.upload(req.user, req.body);
    res.json({ ok: true, document: docs.publicView(doc, req.user) });
  } catch (e) {
    sendError(res, e);
  }
});

// 详情 —— 阶段 5 切到四层：docs.getDocumentView(rawId) 找视图，找不到返 404
//   publicView(view, user) 负责 content/chunks 的脱敏（admin/reviewer 看完整，其他角色只留元信息）
router.get('/:id', auth.requireAuth, (req, res) => {
  const view = docs.getDocumentView(req.params.id);
  if (!view) return res.status(404).json({ ok: false, error: '文档不存在' });
  res.json({ ok: true, document: docs.publicView(view, req.user) });
});

// 审核
router.post('/:id/review', auth.requireAuth, auth.requireReview, (req, res) => {
  try {
    const { decision, note } = req.body || {};
    const doc = docs.review(req.user, req.params.id, decision, note);
    res.json({ ok: true, document: docs.publicView(doc, req.user) });
  } catch (e) {
    sendError(res, e);
  }
});

// 发布 —— 审核通过后生成向量、正式进入 RAG 可检索状态
router.post('/:id/publish', auth.requireAuth, auth.requireReview, (req, res) => {
  try {
    const doc = docs.publishDocument(req.user, req.params.id);
    res.json({ ok: true, document: docs.publicView(doc, req.user) });
  } catch (e) {
    sendError(res, e);
  }
});

// 删除
router.delete('/:id', auth.requireAuth, auth.requireWrite, (req, res) => {
  try {
    const ok = docs.remove(req.user, req.params.id);
    res.json({ ok });
  } catch (e) {
    sendError(res, e);
  }
});

// 切片列表（仅管理员/审核员）—— 阶段 5 切到四层：走 docs.getDocumentView 取 chunks
//   view.chunks 已经是 {id, seq, heading, keywords, content} 形状（不带 bizLine/securityLevel/status）
router.get('/:id/chunks', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
    return res.status(403).json({ ok: false, error: '仅审核员可查看切片' });
  }
  const view = docs.getDocumentView(req.params.id);
  if (!view) return res.status(404).json({ ok: false, error: '文档不存在' });
  res.json({ ok: true, docId: view.id, chunkCount: view.chunkCount, chunks: view.chunks || [] });
});

module.exports = router;
