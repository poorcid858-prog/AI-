/**
 * M4: 知识中心异步处理引擎
 *
 * 任务模型：
 *   {
 *     task_id, version_id, document_id,
 *     status: 'queued' | 'running' | 'success' | 'failed',
 *     currentPhase, progress (0-100),
 *     phases: [
 *       { name, status: 'pending'|'running'|'success'|'failed'|'skipped',
 *         startedAt, finishedAt, error, result }
 *     ],
 *     startedAt, finishedAt, error, triggeredBy, createdAt, updatedAt
 *   }
 *
 * 阶段定义（按顺序）：
 *   1. standardize     - 标准化处理
 *   2. chunking        - 按 Markdown 标题切分 Chunk
 *   3. meta_recognize  - Chunk 元数据 AI 识别
 *   4. embedding       - 向量化
 *
 * 设计要点：
 *   - 存储走 lib/store.js（与四层模型共用持久化层）
 *   - 阶段独立状态：失败时上游成功阶段不重跑（runTask 接受 fromPhase 选项）
 *   - 任务调度：runTask 是同步执行的。生产场景下调用方用 setImmediate
 *     推迟到下一个事件循环，使得 HTTP 响应能立即返回（不阻塞页面）。
 */

const store = require('./store');

const PHASES = ['standardize', 'chunking', 'meta_recognize', 'embedding'];
const TASK_TABLE = 'processing-tasks';

function now() {
  return new Date().toISOString();
}

function readAll() {
  return store.read(TASK_TABLE, []);
}

function writeAll(list) {
  store.write(TASK_TABLE, list);
}

function nextId() {
  // store.nextId 查找 it.id 字段，但任务主键是 task_id，
  // 因此本模块自带 nextId：扫现有 task_id 找最大序号。
  const list = readAll();
  let max = 0;
  for (const it of list) {
    const m = String(it.task_id || '').match(/_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `task_${String(max + 1).padStart(3, '0')}`;
}

/**
 * 创建处理任务（任务进入 queued 状态，需要调用 runTask 才开始执行）。
 *
 * @param {Object} input
 * @param {string} input.versionId   文档版本 ID（必填）
 * @param {string} [input.documentId] 文档 ID
 * @param {string} [input.triggeredBy] 触发人
 * @returns {Object} 任务对象
 */
function createTask(input = {}) {
  const it = input || {};
  if (!it.versionId || typeof it.versionId !== 'string') {
    throw fail('versionId 必填', 400);
  }
  const ts = now();
  const task = {
    task_id: nextId(),
    version_id: it.versionId,
    document_id: it.documentId || null,
    status: 'queued',
    currentPhase: null,
    progress: 0,
    triggeredBy: it.triggeredBy || null,
    phases: PHASES.map((name) => ({
      name,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    })),
    startedAt: null,
    finishedAt: null,
    error: null,
    createdAt: ts,
    updatedAt: ts,
  };
  const list = readAll();
  list.push(task);
  writeAll(list);
  return task;
}

/**
 * 按 taskId 查任务。
 */
function getTask(taskId) {
  if (!taskId) return null;
  return readAll().find((t) => t.task_id === taskId) || null;
}

/**
 * 任务列表。可按 versionId 过滤。
 */
function listTasks(filter = {}) {
  const all = readAll();
  if (!filter || !filter.versionId) return all;
  return all.filter((t) => t.version_id === filter.versionId);
}

/**
 * 查某 versionId 的最新任务。
 */
function getLatestTaskByVersion(versionId) {
  if (!versionId) return null;
  const all = readAll().filter((t) => t.version_id === versionId);
  if (all.length === 0) return null;
  return all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function updateTaskPatch(taskId, patch) {
  const list = readAll();
  const idx = list.findIndex((t) => t.task_id === taskId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: now() };
  writeAll(list);
  return list[idx];
}

function updatePhase(taskId, phaseName, patch) {
  const list = readAll();
  const idx = list.findIndex((t) => t.task_id === taskId);
  if (idx === -1) return null;
  const t = list[idx];
  const pIdx = t.phases.findIndex((p) => p.name === phaseName);
  if (pIdx === -1) return null;
  t.phases[pIdx] = { ...t.phases[pIdx], ...patch };
  t.updatedAt = now();
  writeAll(list);
  return t;
}

/**
 * 进度 = 成功阶段数 / 总阶段数 × 100。
 * 当前正在执行的阶段算半步。
 */
function computeProgress(task) {
  if (!task || !Array.isArray(task.phases)) return 0;
  let score = 0;
  for (const p of task.phases) {
    if (p.status === 'success') score += 1;
    else if (p.status === 'running') score += 0.5;
  }
  return Math.round((score / task.phases.length) * 100);
}

/**
 * 执行任务（同步执行各阶段）。
 *
 * @param {string} taskId
 * @param {Object} knowledgeLayers 知识层函数集（lib/knowledge-layers）
 *   必须提供：standardizeDocument / chunkingDocument / recognizeChunkMeta / embedChunksForVersion
 * @param {Object} [opts]
 * @param {string} [opts.fromPhase] 从该阶段开始执行（用于失败重试）
 * @param {string} [opts.failAt] 测试用：让指定阶段失败
 * @returns {Object} 任务最新状态
 */
function runTask(taskId, knowledgeLayers, opts = {}) {
  const task = getTask(taskId);
  if (!task) throw fail(`任务不存在: ${taskId}`, 404);
  if (!knowledgeLayers) throw fail('knowledgeLayers 必填', 400);

  const startIdx = opts.fromPhase
    ? task.phases.findIndex((p) => p.name === opts.fromPhase)
    : 0;
  if (startIdx < 0) throw fail(`未知阶段: ${opts.fromPhase}`, 400);

  // 重置从 startIdx 起的所有阶段
  for (let i = startIdx; i < task.phases.length; i += 1) {
    updatePhase(taskId, task.phases[i].name, {
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      error: null,
      result: null,
    });
  }

  // 设置任务为 running
  updateTaskPatch(taskId, {
    status: 'running',
    currentPhase: null,
    startedAt: task.startedAt || now(),
    error: null,
    progress: computeProgress(getTask(taskId)),
  });

  // 逐阶段执行
  for (let i = startIdx; i < task.phases.length; i += 1) {
    const phaseName = task.phases[i].name;
    updatePhase(taskId, phaseName, { status: 'running', startedAt: now() });
    updateTaskPatch(taskId, {
      currentPhase: phaseName,
      progress: computeProgress(getTask(taskId)),
    });

    // 测试钩子：注入失败
    if (opts.failAt === phaseName) {
      const errMsg = `注入失败: ${phaseName}`;
      updatePhase(taskId, phaseName, {
        status: 'failed',
        finishedAt: now(),
        error: errMsg,
      });
      updateTaskPatch(taskId, {
        status: 'failed',
        currentPhase: phaseName,
        finishedAt: now(),
        error: `阶段 ${phaseName} 失败: ${errMsg}`,
      });
      return getTask(taskId);
    }

    try {
      let result;
      switch (phaseName) {
        case 'standardize':
          result = knowledgeLayers.standardizeDocument(task.version_id, opts);
          break;
        case 'chunking':
          result = knowledgeLayers.chunkingDocument(task.version_id, opts);
          break;
        case 'meta_recognize':
          result = knowledgeLayers.recognizeChunkMeta(task.version_id, opts);
          break;
        case 'embedding':
          result = knowledgeLayers.embedChunksForVersion(task.version_id, opts);
          break;
        default:
          throw new Error(`未知阶段: ${phaseName}`);
      }

      updatePhase(taskId, phaseName, {
        status: 'success',
        finishedAt: now(),
        result: result || null,
      });
      updateTaskPatch(taskId, { progress: computeProgress(getTask(taskId)) });
    } catch (err) {
      const errMsg = err && err.message ? err.message : String(err);
      updatePhase(taskId, phaseName, {
        status: 'failed',
        finishedAt: now(),
        error: errMsg,
      });
      updateTaskPatch(taskId, {
        status: 'failed',
        currentPhase: phaseName,
        finishedAt: now(),
        error: `阶段 ${phaseName} 失败: ${errMsg}`,
      });
      return getTask(taskId);
    }
  }

  // 全部成功
  updateTaskPatch(taskId, {
    status: 'success',
    currentPhase: null,
    progress: 100,
    finishedAt: now(),
  });
  return getTask(taskId);
}

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

/** 测试用：清空状态 + 缓存 */
function resetForTest() {
  store.clearCache();
}

module.exports = {
  PHASES,
  TASK_TABLE,
  createTask,
  getTask,
  listTasks,
  getLatestTaskByVersion,
  runTask,
  computeProgress,
  resetForTest,
};
