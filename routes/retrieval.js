/**
 * 检索分析 API —— 需求 6：召回可观测与反向修复
 *
 * 两组能力：
 *   1. 观测（看得见）：
 *     GET  /api/retrieval/snapshots/latest         最近快照列表（RAG 检索分析入口）
 *     GET  /api/retrieval/snapshots/:sessionId/:turn   单条快照详情（"查看召回"按钮）
 *     GET  /api/retrieval/analyze                 RAG 检索分析仪表板（召回分布/零召回/高频引用）
 *   2. 修复（改得动）+ 安全设计：
 *     GET  /api/retrieval/impact?action=&rawId=    执行前影响预览（安全设计①）
 *     POST /api/retrieval/fix                     执行修复动作（必须带 confirmed + 先 preview）
 */

const express = require('express');
const auth = require('../lib/auth');
const snapshot = require('../lib/retrieval-snapshot');

const router = express.Router();

// ---------- 观测 1：最近快照列表（RAG 检索分析入口） ----------

router.get('/snapshots/latest', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可查看检索分析' });
  }
  const n = parseInt(req.query.limit || '50', 10);
  res.json({
    ok: true,
    snapshots: snapshot.listRecentSnapshots(n),
  });
});

// ---------- 观测 2：单条快照详情（"查看召回"按钮） ----------

router.get('/snapshots/:sessionId/:turn', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可查看检索分析' });
  }
  const turn = parseInt(req.params.turn, 10);
  const snap = snapshot.getSnapshot(req.params.sessionId, turn);
  if (!snap) {
    return res.status(404).json({ ok: false, error: `快照不存在: ${req.params.sessionId}#${turn}` });
  }
  res.json({ ok: true, snapshot: snap });
});

// ---------- 观测 3：RAG 检索分析仪表板 ----------

router.get('/analyze', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可查看检索分析' });
  }
  const sessionId = req.query.sessionId || undefined;
  res.json({
    ok: true,
    analysis: snapshot.analyzeRetrieval(sessionId),
  });
});

// ---------- 修复 1：执行前影响预览（安全设计①） ----------

router.get('/impact', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可执行修复' });
  }
  const { action, rawId } = req.query;
  if (!action || !rawId) {
    return res.status(400).json({ ok: false, error: '缺少 action 或 rawId' });
  }
  try {
    res.json(snapshot.previewImpact(action, { rawId }));
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ---------- 修复 2：执行修复动作（必须 confirmed + 先预览） ----------

router.post('/fix', auth.requireAuth, auth.requireWrite, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '仅管理员可执行修复' });
  }
  const { action, rawId, params, newContent, confirmed } = req.body || {};
  if (!action || !rawId) {
    return res.status(400).json({ ok: false, error: '缺少 action 或 rawId' });
  }
  try {
    const result = snapshot.executeFix(action, { rawId, params, newContent, confirmed });
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;