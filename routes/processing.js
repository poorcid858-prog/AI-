/**
 * M4: 知识中心异步处理 API 路由
 *
 * 端点：
 *   POST /api/processing/knowledge/:versionId/generate-vectors
 *   GET  /api/processing/knowledge/tasks/:taskId
 *   POST /api/processing/knowledge/tasks/:taskId/retry
 *   POST /api/processing/knowledge/batch-generate
 *   GET  /api/processing/knowledge/tasks/list
 *   GET  /api/processing/knowledge/status/:versionId
 *
 * 知识中心原有路由在 `/api/knowledge`（routes/knowledge.js），
 * 本文件用 `/api/processing` 前缀挂载以避免冲突。
 */

const express = require('express');
const auth = require('../lib/auth');
const kl = require('../lib/knowledge-layers');
const ap = require('../lib/async-processor');

const router = express.Router();

router.use(auth.requireAuth);

function ok(res, data) {
  res.json({ ok: true, ...data });
}

function fail(res, err) {
  const status = (err && err.status) || 500;
  res.status(status).json({ ok: false, error: (err && err.message) || String(err) });
}

// 1. POST /api/processing/knowledge/:versionId/generate-vectors
router.post('/knowledge/:versionId/generate-vectors', (req, res) => {
  try {
    const versionId = req.params.versionId;
    const triggeredBy = (req.user && (req.user.username || req.user.id)) || null;
    const task = kl.generateVectors(versionId, { triggeredBy });
    ok(res, {
      taskId: task.task_id,
      versionId,
      status: task.status,
      phases: task.phases.map((p) => p.name),
      message: '任务已创建，异步执行中',
    });
  } catch (err) {
    fail(res, err);
  }
});

// 2. GET /api/processing/knowledge/tasks/:taskId
router.get('/knowledge/tasks/:taskId', (req, res) => {
  try {
    const task = ap.getTask(req.params.taskId);
    if (!task) {
      return res.status(404).json({ ok: false, error: '任务不存在' });
    }
    ok(res, {
      taskId: task.task_id,
      versionId: task.version_id,
      documentId: task.document_id,
      status: task.status,
      currentPhase: task.currentPhase,
      progress: task.progress,
      phases: task.phases.map((p) => ({
        name: p.name,
        status: p.status,
        startedAt: p.startedAt,
        finishedAt: p.finishedAt,
        error: p.error,
      })),
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  } catch (err) {
    fail(res, err);
  }
});

// 3. POST /api/processing/knowledge/tasks/:taskId/retry
router.post('/knowledge/tasks/:taskId/retry', (req, res) => {
  try {
    const task = ap.getTask(req.params.taskId);
    if (!task) return res.status(404).json({ ok: false, error: '任务不存在' });
    if (task.status !== 'failed') {
      return res.status(409).json({
        ok: false,
        error: '任务状态为 ' + task.status + '，仅 failed 任务可重试',
      });
    }
    const failedPhase = task.phases.find((p) => p.status === 'failed');
    const fromPhase = (req.body && req.body.fromPhase) || (failedPhase && failedPhase.name);
    if (!fromPhase) {
      return res.status(400).json({ ok: false, error: '未找到失败阶段，请指定 fromPhase' });
    }
    const newTask = kl.retryFromPhase(task.version_id, fromPhase);
    ok(res, {
      taskId: newTask.task_id,
      versionId: task.version_id,
      fromPhase,
      status: newTask.status,
      message: '重试任务已创建，异步执行中',
    });
  } catch (err) {
    fail(res, err);
  }
});

// 4. POST /api/processing/knowledge/batch-generate
router.post('/knowledge/batch-generate', (req, res) => {
  try {
    const body = req.body || {};
    const versionIds = Array.isArray(body.versionIds) ? body.versionIds : [];
    if (versionIds.length === 0) {
      return res.status(400).json({ ok: false, error: '请提供 versionIds 数组' });
    }
    const triggeredBy = (req.user && (req.user.username || req.user.id)) || null;
    const results = [];
    for (const vid of versionIds) {
      try {
        const task = kl.generateVectors(vid, { triggeredBy });
        results.push({ versionId: vid, ok: true, taskId: task.task_id, status: task.status });
      } catch (e) {
        results.push({ versionId: vid, ok: false, error: (e && e.message) || String(e) });
      }
    }
    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;
    ok(res, {
      total: results.length,
      successCount,
      failCount,
      results,
      message: '一个文档失败不影响其他文档（独立处理）',
    });
  } catch (err) {
    fail(res, err);
  }
});

// 5. GET /api/processing/knowledge/tasks/list
router.get('/knowledge/tasks/list', (req, res) => {
  try {
    const versionId = req.query.versionId || null;
    const tasks = ap.listTasks(versionId ? { versionId } : {});
    ok(res, {
      total: tasks.length,
      tasks: tasks.map((t) => ({
        taskId: t.task_id,
        versionId: t.version_id,
        documentId: t.document_id,
        status: t.status,
        currentPhase: t.currentPhase,
        progress: t.progress,
        triggeredBy: t.triggeredBy,
        error: t.error,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    });
  } catch (err) {
    fail(res, err);
  }
});

// 6. GET /api/processing/knowledge/status/:versionId
router.get('/knowledge/status/:versionId', (req, res) => {
  try {
    const status = kl.getProcessingStatus(req.params.versionId);
    if (status.status === 'not_found') {
      return res.status(404).json({ ok: false, error: status.error || '版本不存在' });
    }
    ok(res, status);
  } catch (err) {
    fail(res, err);
  }
});

router.use((err, req, res, next) => {
  console.error('[PROCESSING ERROR]', err.message);
  res.status(err.status || 500).json({ ok: false, error: err.message || '服务器错误' });
});

module.exports = router;
