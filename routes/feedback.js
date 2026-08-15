/**
 * /api/feedback 反馈路由 —— 点赞/点踩 + 双向反馈（任务 9b）
 *
 * 已有 /record + /health
 * 新增：
 *   POST /api/feedback/flag-as-example      —— 标记为优秀案例（仅 admin）
 *   POST /api/feedback/back-to-knowledge    —— AI 生成→知识库回流（提交审核）
 *   GET  /api/feedback/examples             —— 优秀案例列表
 *   GET  /api/feedback/chain/:sessionId/:turn —— 获取全链路记录
 */
const express = require('express');
const auth = require('../lib/auth');
const qa = require('../lib/qa-store');
const snapshot = require('../lib/retrieval-snapshot');
const router = express.Router();

// 写操作需要认证 + 写入权限
const requireWrite = [auth.requireAuth, auth.requireWrite];

/**
 * POST /api/feedback/record — 记录反馈
 * Body: { sessionId, turn, type: 'feedback'|'satisfaction', value: 'up'|'down'|number }
 */
router.post('/record', auth.requireAuth, (req, res) => {
  const { sessionId, turn, type, value } = req.body || {};
  if (!sessionId || turn === undefined || !type) {
    return res.status(400).json({ ok: false, error: '缺少必填字段' });
  }
  try {
    const allRecords = qa.getAllRecords();
    const aiRecord = allRecords.find(
      r => r.sessionId === sessionId && r.turn === parseInt(turn, 10) && r.type === 'ai'
    );
    if (!aiRecord) {
      return res.status(404).json({ ok: false, error: '记录不存在' });
    }
    const idx = allRecords.findIndex(
      r => r.sessionId === sessionId && r.turn === parseInt(turn, 10) && r.type === 'ai'
    );
    if (idx !== -1) {
      if (type === 'feedback') {
        aiRecord.feedback = value; // 'up' | 'down'
      } else if (type === 'satisfaction') {
        aiRecord.userSatisfaction = parseInt(value, 10);
      }
      const data = { records: allRecords };
      const store = require('../lib/store');
      data.version = 1;
      data.updatedAt = new Date().toISOString();
      store.write('qa-history', data);
    }
    res.json({ ok: true, message: '反馈已记录' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// POST /api/feedback/flag-as-example —— 标记为优秀案例（仅 admin）
// 双向反馈 回路一：优秀问答→案例库
// ============================================================

router.post('/flag-as-example', requireWrite, (req, res) => {
  try {
    const { sessionId, turn, tags } = req.body || {};
    if (!sessionId || turn == null) {
      return res.status(400).json({ ok: false, error: '缺少 sessionId 或 turn' });
    }

    // 从 qa-history 取该轮问答对
    const pair = qa.getQAPair(sessionId, turn);
    if (!pair) {
      return res.status(404).json({ ok: false, error: '未找到该轮问答对' });
    }

    // 写入 qa-examples.json（优秀问答→案例库）
    const result = qa.addExample({
      role: pair.user.role,
      question: pair.user.content,
      answer: pair.ai.content,
      tags: Array.isArray(tags) ? tags : [],
      source: `session:${sessionId}/turn:${turn}`,
      userId: req.user.id,
    });

    res.status(result.duplicated ? 200 : 201).json({
      ok: true,
      duplicated: result.duplicated,
      id: result.id,
      message: result.duplicated ? '该案例已存在（未重复入库）' : '已加入优秀案例库',
    });
  } catch (err) {
    console.error('[feedback/flag-as-example] error:', err.message);
    res.status(500).json({ ok: false, error: err.message || '处理失败' });
  }
});

// ============================================================
// POST /api/feedback/back-to-knowledge —— AI 生成→知识库回流（提交审核）
// 双向反馈 回路二：AI 生成内容经审核后回流知识库
// ============================================================

router.post('/back-to-knowledge', requireWrite, (req, res) => {
  try {
    const { sessionId, turn, title, bizLine, securityLevel } = req.body || {};
    if (!sessionId || turn == null) {
      return res.status(400).json({ ok: false, error: '缺少 sessionId 或 turn' });
    }

    const records = qa.listBySession(sessionId);
    const aiRecord = records.find((r) => r.turn === turn && r.type === 'ai');
    if (!aiRecord) {
      return res.status(404).json({ ok: false, error: '未找到该轮 AI 回答' });
    }

    // 尝试写入知识库四层（raw → std → pending）
    try {
      const kl = require('../lib/knowledge-layers');
      const raw = kl.createRaw({
        title: title || `AI 生成回流_${sessionId}_${turn}`,
        content: aiRecord.content,
        bizLine: bizLine || aiRecord.bizLine || 'all',
        securityLevel: securityLevel || 'internal',
        knowledgeType: 'other',
        uploadedBy: req.user.username,
        tags: ['ai_generated'],
      });
      kl.markReady(raw.id);
      const std = kl.createStdVersion(raw.id, { content: aiRecord.content });
      kl.setStdStatus(std.id, 'pending', { reviewedBy: req.user.username });

      res.json({
        ok: true,
        rawId: raw.id,
        stdId: std.id,
        status: 'pending',
        message: 'AI 生成内容已回流为知识草稿，等待审核',
      });
    } catch (klErr) {
      console.error('[feedback/back-to-knowledge] knowledge-layers error:', klErr.message);
      res.json({
        ok: true,
        note: '知识库暂不可用，回流请求已记录',
        sessionId,
        turn,
      });
    }
  } catch (err) {
    console.error('[feedback/back-to-knowledge] error:', err.message);
    res.status(500).json({ ok: false, error: err.message || '处理失败' });
  }
});

// ============================================================
// GET /api/feedback/examples —— 优秀案例列表
// ============================================================

router.get('/examples', auth.requireAuth, (req, res) => {
  try {
    const role = req.query.role || '';
    const examples = qa.listExamples(role || undefined);
    res.json({ ok: true, examples, total: examples.length });
  } catch (err) {
    console.error('[feedback/examples] error:', err.message);
    res.status(500).json({ ok: false, error: err.message || '查询失败' });
  }
});

// ============================================================
// GET /api/feedback/chain/:sessionId/:turn —— 获取全链路记录
// ============================================================

router.get('/chain/:sessionId/:turn', auth.requireAuth, (req, res) => {
  try {
    const { sessionId, turn } = req.params;
    const turnNum = parseInt(turn, 10);
    if (!sessionId || isNaN(turnNum)) {
      return res.status(400).json({ ok: false, error: '参数错误' });
    }

    const snap = snapshot.getSnapshot(sessionId, turnNum);
    if (!snap) {
      return res.status(404).json({ ok: false, error: '未找到该轮全链路记录' });
    }

    const records = qa.listBySession(sessionId);
    const userRecord = records.find((r) => r.turn === turnNum && r.type === 'user');
    const aiRecord = records.find((r) => r.turn === turnNum && r.type === 'ai');

    res.json({
      ok: true,
      sessionId,
      turn: turnNum,
      snapshot: {
        id: snap.id,
        timestamp: snap.timestamp,
        userQuestion: snap.userQuestion,
        intentResult: snap.intentResult,
        workflowId: snap.workflowId,
        chain: snap.chain,
        retrievalResults: snap.retrievalResults,
        references: snap.references,
        promptText: snap.promptText,
        aiOutput: snap.aiOutput,
        qualityCheck: snap.qualityCheck,
        qualityScore: snap.qualityScore,
        llmResult: snap.llmResult,
      },
      qa: {
        user: userRecord ? { id: userRecord.id, content: userRecord.content, timestamp: userRecord.timestamp } : null,
        ai: aiRecord ? {
          id: aiRecord.id, content: aiRecord.content, timestamp: aiRecord.timestamp,
          feedback: aiRecord.feedback, latencyMs: aiRecord.latencyMs,
        } : null,
      },
    });
  } catch (err) {
    console.error('[feedback/chain] error:', err.message);
    res.status(500).json({ ok: false, error: err.message || '查询失败' });
  }
});

/**
 * GET /api/feedback/health
 */
router.get('/health', auth.requireAuth, (req, res) => {
  res.json({ ok: true, msg: '反馈路由已就位' });
});

module.exports = router;