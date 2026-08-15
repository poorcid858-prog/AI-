/**
 * /api/workflow 路由 —— Workflow 引擎 RESTful API（任务 1b）
 *
 * 端点：
 *   GET    /api/workflow              —— 列表（listWorkflows）
 *   GET    /api/workflow/:id          —— 详情（getWorkflow）
 *   POST   /api/workflow              —— 创建（createWorkflow，需 admin）
 *   PUT    /api/workflow/:id          —— 更新（updateWorkflow，需 admin）
 *   DELETE /api/workflow/:id          —— 删除（deleteWorkflow，需 admin）
 *   POST   /api/workflow/:id/execute  —— 执行（executeWorkflow，需已登录）
 *   GET    /api/workflow/:id/status   —— 状态查询（getWorkflow）
 *   POST   /api/workflow/:id/toggle   —— 启用/禁用（updateWorkflow status，需 admin）
 */

const express = require('express');
const auth = require('../lib/auth');
const wf = require('../lib/workflow-engine');

const router = express.Router();

// 写操作需要认证 + 写入权限
const requireWrite = [auth.requireAuth, auth.requireWrite];

// 统一错误处理
function sendError(res, e) {
  const code = Number.isInteger(e.status) ? e.status : 500;
  const msg = code === 500 ? '服务器内部错误' : e.message;
  if (code === 500) console.error('[workflow] 意外异常:', e);
  res.status(code).json({ ok: false, error: msg });
}

// ============================================================
// GET / —— 列表
// ============================================================

router.get('/', auth.requireAuth, (req, res) => {
  try {
    const list = wf.listWorkflows();
    res.json({ ok: true, workflows: list, total: list.length });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// POST / —— 创建（需 admin）
// ============================================================

router.post('/', requireWrite, (req, res) => {
  try {
    const { id, name, description, role, nodes, entryNode, status } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: '缺少 name 字段' });
    if (!role) return res.status(400).json({ ok: false, error: '缺少 role 字段' });

    const created = wf.createWorkflow({
      id, name, description, role, nodes, entryNode, status,
    });
    res.status(201).json({ ok: true, workflow: created });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// GET /:id —— 详情
// ============================================================

router.get('/:id', auth.requireAuth, (req, res) => {
  try {
    const workflow = wf.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ ok: false, error: 'Workflow 不存在' });
    res.json({ ok: true, workflow });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// PUT /:id —— 更新（需 admin）
// ============================================================

router.put('/:id', requireWrite, (req, res) => {
  try {
    const { name, description, role, nodes, entryNode, status } = req.body || {};
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (role !== undefined) patch.role = role;
    if (nodes !== undefined) patch.nodes = nodes;
    if (entryNode !== undefined) patch.entryNode = entryNode;
    if (status !== undefined) patch.status = status;

    const updated = wf.updateWorkflow(req.params.id, patch);
    if (!updated) return res.status(404).json({ ok: false, error: 'Workflow 不存在' });
    res.json({ ok: true, workflow: updated });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// DELETE /:id —— 删除（需 admin）
// ============================================================

router.delete('/:id', requireWrite, (req, res) => {
  try {
    const ok = wf.deleteWorkflow(req.params.id);
    if (!ok) return res.status(404).json({ ok: false, error: 'Workflow 不存在' });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// GET /:id/status —— 状态查询
// ============================================================

router.get('/:id/status', auth.requireAuth, (req, res) => {
  try {
    const workflow = wf.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ ok: false, error: 'Workflow 不存在' });
    res.json({
      ok: true,
      status: workflow.status,
      role: workflow.role,
      nodeCount: (workflow.nodes || []).length,
      updatedAt: workflow.updatedAt,
    });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// POST /:id/toggle —— 启用/禁用（需 admin）
// ============================================================

router.post('/:id/toggle', requireWrite, (req, res) => {
  try {
    const workflow = wf.getWorkflow(req.params.id);
    if (!workflow) return res.status(404).json({ ok: false, error: 'Workflow 不存在' });
    const newStatus = workflow.status === 'published' ? 'disabled' : 'published';
    const updated = wf.updateWorkflow(req.params.id, { status: newStatus });
    res.json({ ok: true, workflow: updated });
  } catch (e) {
    sendError(res, e);
  }
});

// ============================================================
// POST /:id/execute —— 执行 Workflow
// ============================================================

router.post('/:id/execute', auth.requireAuth, (req, res) => {
  try {
    const { userQuestion, role, bizLine } = req.body || {};
    if (!userQuestion) return res.status(400).json({ ok: false, error: '缺少 userQuestion' });

    const result = wf.executeWorkflow(req.params.id, {
      userQuestion,
      role: role || req.user.role,
      bizLine: bizLine || 'trade',
      user: req.user,
    });

    res.json({ ok: true, ...result });
  } catch (e) {
    sendError(res, e);
  }
});

module.exports = router;