/**
 * 聊天 API 路由（任务 2 重写 —— 完整 AI 执行链路）
 *
 * 端点：
 *   GET  /api/chat/history              —— 历史聊天列表
 *   GET  /api/chat/frequency?role=      —— 常用问题 top 10
 *   POST /api/chat/send                 —— 发新问题（完整链路）
 *   GET  /api/chat/session/:id          —— session 详情
 *
 * POST /send 完整链路（需求 1.2.3）：
 *   ① 意图识别（classifyIntent）→ 路由到 Workflow
 *   ② 执行引擎（executeWorkflow）→ 内部含 RAG → Skill → Reference → Prompt → LLM → QC
 *   ③ 存储 user record + ai record
 *   ④ 记录全链路检索快照
 *   ⑤ 更新频次
 *   ⑥ 返回结果
 *
 * 需求 1.2.3 描述的"用户输入→意图→Workflow→Skill→RAG→Reference→Prompt→LLM→输出"在此实现。
 */

const express = require('express');
const auth = require('../lib/auth');
const qa = require('../lib/qa-store');
const reports = require('../lib/reports');
const wf = require('../lib/workflow-engine');
const snapshot = require('../lib/retrieval-snapshot');
const pe = require('../lib/prompt-engine');

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

// ---------- POST /api/chat/send 发新问题（完整 AI 执行链路） ----------

router.post('/send', auth.requireAuth, auth.requireWrite, (req, res) => {
  const { sessionId, role, bizLine, userQuestion } = req.body || {};
  const user = req.user;

  // 基础校验
  if (!sessionId || !role || !bizLine || !userQuestion) {
    return res.status(400).json({
      ok: false,
      error: '缺少必填字段：sessionId, role, bizLine, userQuestion',
    });
  }

  const validRoles = ['product', 'test', 'frontend', 'cs'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({
      ok: false,
      error: `Invalid role: ${role}`,
    });
  }

  try {
    const timestamp = new Date().toISOString();
    const turn = qa.getNextTurn(sessionId);
    const startTime = Date.now();

    // ================================================================
    // ① 意图识别 → 路由到 Workflow
    // ================================================================
    const intent = wf.classifyIntent(userQuestion, role);
    const workflowId = intent.workflowId;

    // 确保种子数据就绪
    wf.seedIfEmpty();

    // ================================================================
    // ② 执行 Workflow 引擎（内部含 RAG → Skill → Reference → Prompt → LLM → QC）
    // ================================================================
    const execResult = wf.executeWorkflow(workflowId, {
      userQuestion,
      role,
      bizLine,
      user,
      intent,
    });

    const latencyMs = Date.now() - startTime;

    // ================================================================
    // ③ 存储 user record + ai record
    // ================================================================

    // user record
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
      workflowId,
      ragChunks: execResult.ragChunks || [],
      qualityScore: null,
      feedback: null,
      latencyMs: null,
    };
    qa.appendRecord(userRecord);

    // ai record
    const aiOutput = execResult.result || '';
    const aiRecord = {
      id: `qa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_a`,
      userId: user.id,
      userName: user.name,
      sessionId,
      turn,
      type: 'ai',
      content: aiOutput,
      timestamp,
      role,
      bizLine,
      workflowId,
      ragChunks: execResult.ragChunks || [],
      qualityScore: execResult.qualityScore,
      feedback: null,
      latencyMs: Math.max(1, latencyMs),
    };
    qa.appendRecord(aiRecord);

    // ================================================================
    // ④ 记录全链路检索快照
    // ================================================================
    try {
      snapshot.recordSnapshot({
        sessionId,
        turn,
        userQuestion,
        user,
        retrievalResults: execResult.ragChunks || [],
        aiOutput,
        promptText: execResult.promptText,
        qualityScore: execResult.qualityScore,
        // 新增全链路字段
        intentResult: {
          taskType: intent.taskType,
          confidence: intent.confidence,
          role: intent.role,
          entities: intent.entities,
        },
        workflowId: execResult.workflowId,
        chain: (execResult.chain || []).map((s) => ({
          nodeId: s.nodeId,
          nodeType: s.nodeType,
          nodeName: s.nodeName,
          latencyMs: s.latencyMs,
          ok: s.ok !== false,
        })),
        references: execResult.references || [],
        llmResult: execResult.llmResult || aiOutput,
        qualityCheck: execResult.qualityCheck || null,
      });
    } catch (_) { /* 快照记录失败不阻断 */ }

    // ================================================================
    // ⑤ 更新频次
    // ================================================================
    qa.incrementFrequency(role, userQuestion);

    // ================================================================
    // ⑥ 会话结束自动生成会话报告
    // ================================================================
    try {
      const sessionData = {
        sessionId,
        role,
        startTime: new Date(),
        endTime: new Date(),
        turnCount: turn,
        successCount: 1,
        failCount: 0,
      };
      reports.cronScheduleForSessionReport(sessionData);
    } catch (_) { /* 报告失败不阻断 */ }

    // ================================================================
    // 返回结果
    // ================================================================
    res.json({
      ok: true,
      sessionId,
      turn,
      result: aiOutput,
      workflowId,
      intent: {
        taskType: intent.taskType,
        confidence: intent.confidence,
      },
      chain: execResult.chain,
      latencyMs,
      ragChunkCount: (execResult.ragChunks || []).length,
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