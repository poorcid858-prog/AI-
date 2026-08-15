/**
 * 运营中心 API 路由（任务包 H）
 *
 * 功能：
 *   - 查询所有用户的聊天记录
 *   - 显示每条回答使用的 Chunk ID
 *   - 统计 Chunk 使用情况
 *   - 支持按用户、日期、关键词筛选
 *
 * 端点：
 *   GET /api/operations/chat-records          - 聊天记录列表（支持分页、筛选）
 *   GET /api/operations/chat-records/:sessionId/:turn  - 单条记录详情 + Chunk追踪
 *   GET /api/operations/chunk-usage           - Chunk 使用统计
 *   GET /api/operations/top-questions         - 高频问题排行
 *   GET /api/operations/satisfaction-trend    - 满意度趋势
 *   GET /api/operations/zero-recall          - 零召回问题
 */

'use strict';

const express = require('express');
const auth = require('../lib/auth');
const engine = require('../lib/operations-engine');

const router = express.Router();

// 权限检查：只有运营人员（admin/reviewer）可访问
const requireOpsAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: '未登录' });
  }
  // admin 和 reviewer 角色可以访问运营中心
  if (!['admin', 'reviewer'].includes(req.user.role)) {
    return res.status(403).json({ ok: false, error: '权限不足，仅运营人员可访问' });
  }
  next();
};

// ============================================================
// GET /api/operations/chat-records - 聊天记录列表
// ============================================================
router.get('/chat-records', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    userId: req.query.userId,
    role: req.query.role,
    keyword: req.query.keyword,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const pagination = {
    page: req.query.page,
    pageSize: req.query.pageSize,
  };

  const result = engine.queryChatHistory(filters, pagination);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/chat-records/:sessionId/:turn - 单条记录详情 + Chunk追踪
// ============================================================
router.get('/chat-records/:sessionId/:turn', auth.requireAuth, requireOpsAccess, (req, res) => {
  const { sessionId, turn } = req.params;

  const result = engine.getRecordWithChunkTracking(sessionId, parseInt(turn, 10));
  if (!result.ok) {
    return res.status(404).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/chunk-usage - Chunk 使用统计
// ============================================================
router.get('/chunk-usage', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    sortBy: req.query.sortBy || 'usageCount',
    limit: req.query.limit,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const result = engine.getChunkUsageStats(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/top-questions - 高频问题排行
// ============================================================
router.get('/top-questions', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    role: req.query.role,
    limit: req.query.limit,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const result = engine.getTopQuestions(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/satisfaction-trend - 满意度趋势
// ============================================================
router.get('/satisfaction-trend', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    role: req.query.role,
  };

  const result = engine.getSatisfactionTrend(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/zero-recall - 零召回问题
// ============================================================
router.get('/zero-recall', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    limit: req.query.limit,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const result = engine.getZeroRecallQuestions(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/effect-analysis - 效果分析
// ============================================================
router.get('/effect-analysis', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
    role: req.query.role,
  };

  const result = engine.getEffectAnalysis(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/capability-analysis - 能力运营分析
// ============================================================
router.get('/capability-analysis', auth.requireAuth, requireOpsAccess, (req, res) => {
  const filters = {
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };

  const result = engine.getCapabilityAnalysis(filters);
  if (!result.ok) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// ============================================================
// GET /api/operations/full-link/:sessionId/:turn - 问题定位全链路
// ============================================================
router.get('/full-link/:sessionId/:turn', auth.requireAuth, requireOpsAccess, (req, res) => {
  const { sessionId, turn } = req.params;

  const result = engine.getFullLinkChain(sessionId, turn);
  if (!result.ok) {
    return res.status(404).json(result);
  }

  res.json(result);
});

module.exports = router;
