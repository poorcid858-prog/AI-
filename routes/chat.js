/**
 * 聊天 API 路由（B4）
 *
 * 4 个 endpoint：
 *   GET /api/chat/history —— 历史聊天列表
 *   GET /api/chat/frequency?role= —— 常用问题 top 10
 *   POST /api/chat/send —— 发新问题
 *   GET /api/chat/session/:id —— session 详情
 */

const express = require('express');
const auth = require('../lib/auth');
const qa = require('../lib/qa-store');
const reports = require('../lib/reports');
const rag = require('../lib/rag-engine');
const snapshot = require('../lib/retrieval-snapshot');

const router = express.Router();

// ---------- GET /api/chat/history 历史聊天列表 ----------

router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const sessions = qa.listSessions(limit);
  res.json({
    ok: true,
    sessions,
    total: sessions.length,
  });
});

// ---------- GET /api/chat/frequency 常用问题 top 10 ----------

router.get('/frequency', (req, res) => {
  const role = req.query.role || '';
  const validRoles = ['product', 'test', 'frontend', 'cs'];

  if (!validRoles.includes(role)) {
    return res.status(400).json({
      ok: false,
      error: `invalid role: ${role}`,
    });
  }

  const frequency = qa.getTopFrequency(role, 10);
  res.json({
    ok: true,
    frequency,
    role,
    total: frequency.length,
  });
});

// ---------- POST /api/chat/send 发新问题 ----------

router.post('/send', auth.requireAuth, auth.requireWrite, (req, res) => {
  const { sessionId, role, bizLine, userQuestion, ragChunks } = req.body || {};
  const user = req.user;

  // 基础校验
  if (!sessionId || !role || !bizLine || !userQuestion) {
    return res.status(400).json({
      ok: false,
      error: '缺少必填字段：sessionId, role, bizLine, userQuestion',
    });
  }

  // role 白名单校验
  const validRoles = ['product', 'test', 'frontend', 'cs'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid role: ${role}`,
    });
  }

  try {
    // 生成唯一 ID
    const timestamp = new Date().toISOString();
    const turn = qa.getNextTurn(sessionId); // 从 session 推导 turn（确定递增）

    // 1. 生成并存储 user record
    const userRecord = {
      id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_u`,
      userId: user.id,
      userName: user.name,
      sessionId,
      turn,
      type: 'user',
      content: userQuestion,
      timestamp,
      role,
      bizLine,
      workflowId: null,
      ragChunks: [],
      qualityScore: null,
      feedback: null,
      latencyMs: null,
    };

    qa.appendRecord(userRecord);

    // 2. 调用 workflow（简化实现：直接返回模拟结果）
    const workflowId = `wf_${Date.now()}`;
    const workflowResult = `基于您的问题"${userQuestion}"，AI 给出的回答。`;

    // 3. 生成并存储 ai record
    const aiRecord = {
      id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_a`,
      userId: user.id,
      userName: user.name,
      sessionId,
      turn,
      type: 'ai',
      content: workflowResult,
      timestamp, // 与 user record 使用相同的 timestamp
      role,
      bizLine,
      workflowId,
      ragChunks: Array.isArray(ragChunks) ? ragChunks : [],
      qualityScore: null,
      feedback: null,
      latencyMs: Math.floor(Math.random() * 5000) || 1, // 整数，0-5000，至少 1
    };

    qa.appendRecord(aiRecord);

    // 4. 更新频次
    qa.incrementFrequency(role, userQuestion);

    // 5. 记录检索快照（需求 6：召回可观测）
    try {
      const index = rag.loadApprovedIndex();
      const results = rag.retrieve(user, userQuestion, index);
      snapshot.recordSnapshot({
        sessionId,
        turn,
        userQuestion,
        user,
        retrievalResults: results,
        ragIndex: index,
        aiOutput: workflowResult,
      });
    } catch (_) { /* 快照记录失败不阻断 */ }

    // 6. 会话结束自动生成会话报告（任务包 C 收口）
    const sessionData = {
      sessionId,
      role,
      startTime: new Date(),
      endTime: new Date(),
      turnCount: turn,
      successCount: 1,
      failCount: 0,
    };
    try { reports.cronScheduleForSessionReport(sessionData); } catch (_) { /* 报告失败不阻断 */ }

    // 返回结果
    res.json({
      ok: true,
      sessionId,
      turn,
      result: workflowResult,
      workflowId,
    });
  } catch (err) {
    console.error('[chat] send error:', err.message);
    res.status(500).json({
      ok: false,
      error: err.message || '处理失败',
    });
  }
});

// ---------- GET /api/chat/session/:id session 详情 ----------

router.get('/session/:id', (req, res) => {
  const sessionId = req.params.id;
  const records = qa.listBySession(sessionId);

  res.json({
    ok: true,
    sessionId,
    records,
  });
});

module.exports = router;
