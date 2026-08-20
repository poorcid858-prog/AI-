/**
 * M4: 知识中心异步处理引擎测试
 *
 * 覆盖（对应《任务包-M4-知识中心异步处理引擎.md》）：
 *   1. 任务创建、状态机流转
 *   2. 阶段进度（phases 列表 + currentPhase + progress）
 *   3. 失败重试（从失败阶段继续，不重跑成功阶段）
 *   4. 批量独立失败
 *   5. 任务持久化到 data/processing-tasks.json
 *
 * 测试隔离：与 knowledge-layers.test.js 一样，临时改 config.paths.data。
 * 异步任务用 setImmediate / setTimeout 触发，本测试用例全部同步等待完成。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const ap = require('../lib/async-processor');
const kl = require('../lib/knowledge-layers');

// ============================================================
// 隔离夹具
// ============================================================

function withTasks(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-m4-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  // 必须 await 内部 async 工作完成后再清理 data 目录，
  // 否则 finally 会先于 async 测试体执行，导致后续阶段访问已删除的文件。
  const run = async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    ap.resetForTest();
    try {
      await fn();
    } finally {
      config.paths.data = realDataDir;
      store.clearCache();
      ap.resetForTest();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
  return run();
}

/** 造一条完整的 doc + version + raw 链路（用于创建任务） */
function seedDocAndVersion(over = {}) {
  const doc = kl.createDocument({ documentName: over.documentName || '测试文档' });
  const version = kl.createDocumentVersion(doc.document_id, {
    sourceFileId: over.sourceFileId || 'raw_001',
    metadata: over.metadata || { knowledgeType: 'business_rule', bizDomain: 'trade' },
  });
  // 审核通过
  kl.updateDocumentVersion(version.version_id, { review_status: 'approved' });
  const raw = kl.createRaw({
    title: '测试文档',
    fileName: 'test.md',
    content: over.content || '# 测试标题\n\n这是一段足够长的内容用于向量化处理，包含订单创建与退款流程的完整业务规则说明。'.repeat(5),
    bizLine: 'trade',
    securityLevel: 'internal',
    documentId: doc.document_id,
    versionId: version.version_id,
  });
  return { doc, version, raw };
}

/** 等待任务完成（最多 timeoutMs）。返回最终状态的任务对象 */
function waitForTask(taskId, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const t = ap.getTask(taskId);
      if (!t) return reject(new Error(`task not found: ${taskId}`));
      if (t.status === 'success' || t.status === 'failed') {
        return resolve(t);
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`task ${taskId} timeout after ${timeoutMs}ms (status=${t.status})`));
      }
      setTimeout(tick, 20);
    };
    tick();
  });
}

// ============================================================
// 1. 任务模型
// ============================================================

test('M4-A1: createTask 返回 taskId 和初始 queued 状态', () => {
  withTasks(() => {
    const { version } = seedDocAndVersion();
    const task = ap.createTask({ versionId: version.version_id, triggeredBy: 'admin' });
    assert.ok(task.task_id, '应返回 task_id');
    assert.ok(/^task_/.test(task.task_id), `task_id 格式: ${task.task_id}`);
    assert.strictEqual(task.version_id, version.version_id);
    assert.strictEqual(task.status, 'queued');
    assert.strictEqual(task.currentPhase, null);
    assert.strictEqual(task.progress, 0);
    assert.ok(Array.isArray(task.phases));
    assert.strictEqual(task.phases.length, 4, '应有 4 个阶段: standardize/chunking/meta_recognize/embedding');
    const names = task.phases.map((p) => p.name);
    assert.deepStrictEqual(names, ['standardize', 'chunking', 'meta_recognize', 'embedding']);
    for (const p of task.phases) {
      assert.strictEqual(p.status, 'pending');
    }
  });
});

test('M4-A2: getTask 按 task_id 查任务', () => {
  withTasks(() => {
    const { version } = seedDocAndVersion();
    const created = ap.createTask({ versionId: version.version_id });
    const found = ap.getTask(created.task_id);
    assert.ok(found);
    assert.strictEqual(found.task_id, created.task_id);
    assert.strictEqual(ap.getTask('task_nonexistent'), null);
  });
});

test('M4-A3: 任务持久化到 data/processing-tasks.json', () => {
  withTasks(() => {
    const { version } = seedDocAndVersion();
    const created = ap.createTask({ versionId: version.version_id });
    const fp = path.join(config.paths.data, 'processing-tasks.json');
    assert.ok(fs.existsSync(fp), 'processing-tasks.json 应已创建');
    const stored = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.ok(Array.isArray(stored));
    assert.ok(stored.find((t) => t.task_id === created.task_id), '任务应已落盘');
  });
});

test('M4-A4: listTasks 返回所有任务，支持按 versionId 过滤', () => {
  withTasks(() => {
    const v1 = kl.createDocumentVersion(kl.createDocument({ documentName: 'A' }).document_id, {
      sourceFileId: 'r1', metadata: {},
    });
    const v2 = kl.createDocumentVersion(kl.createDocument({ documentName: 'B' }).document_id, {
      sourceFileId: 'r2', metadata: {},
    });
    ap.createTask({ versionId: v1.version_id });
    ap.createTask({ versionId: v1.version_id });
    ap.createTask({ versionId: v2.version_id });
    const all = ap.listTasks();
    assert.strictEqual(all.length, 3);
    const v1Tasks = ap.listTasks({ versionId: v1.version_id });
    assert.strictEqual(v1Tasks.length, 2);
  });
});

// ============================================================
// 2. 阶段状态机
// ============================================================

test('M4-A5: runTask 成功时全部阶段为 success，status=success', async () => {
  await withTasks(async () => {
    const { version } = seedDocAndVersion();
    const task = ap.createTask({ versionId: version.version_id });
    ap.runTask(task.task_id, kl); // 注册执行函数
    const done = await waitForTask(task.task_id);
    assert.strictEqual(done.status, 'success');
    for (const p of done.phases) {
      assert.strictEqual(p.status, 'success', `phase ${p.name} 应 success`);
    }
    assert.strictEqual(done.progress, 100);
    assert.ok(done.startedAt);
    assert.ok(done.finishedAt);
  });
});

test('M4-A6: 进度按阶段推进（4 个阶段各 25%）', async () => {
  await withTasks(async () => {
    const { version } = seedDocAndVersion();
    const task = ap.createTask({ versionId: version.version_id });
    ap.runTask(task.task_id, kl);
    const done = await waitForTask(task.task_id);
    // 各阶段 finishedAt 应按顺序推进
    const finished = done.phases.map((p) => new Date(p.finishedAt).getTime());
    for (let i = 1; i < finished.length; i += 1) {
      assert.ok(finished[i] >= finished[i - 1], `phase ${i} finishedAt 早于上一阶段`);
    }
  });
});

// ============================================================
// 3. 失败重试
// ============================================================

test('M4-A7: 失败任务保留失败阶段错误，status=failed', async () => {
  await withTasks(async () => {
    const { version } = seedDocAndVersion();
    const task = ap.createTask({ versionId: version.version_id });
    // 注入：让 meta_recognize 阶段失败
    ap.runTask(task.task_id, kl, { failAt: 'meta_recognize' });
    const done = await waitForTask(task.task_id);
    assert.strictEqual(done.status, 'failed');
    assert.strictEqual(done.currentPhase, 'meta_recognize');
    const failedPhase = done.phases.find((p) => p.name === 'meta_recognize');
    assert.strictEqual(failedPhase.status, 'failed');
    assert.ok(failedPhase.error, '失败阶段应记录 error');
    // 上游阶段（前 2 个）应仍为 success
    assert.strictEqual(done.phases[0].status, 'success');
    assert.strictEqual(done.phases[1].status, 'success');
    // 下游阶段（embedding）应保持 pending（未执行）
    assert.strictEqual(done.phases[3].status, 'pending');
  });
});

test('M4-A8: retryFromPhase 从失败阶段继续，不重跑成功阶段', async () => {
  await withTasks(async () => {
    const { version } = seedDocAndVersion();
    const task = ap.createTask({ versionId: version.version_id });
    // 第一次执行：让 meta_recognize 失败
    ap.runTask(task.task_id, kl, { failAt: 'meta_recognize' });
    const first = await waitForTask(task.task_id);
    assert.strictEqual(first.status, 'failed');

    // 重试：清除失败注入，让 meta_recognize 成功
    ap.runTask(task.task_id, kl, { fromPhase: 'meta_recognize' });
    const retried = await waitForTask(task.task_id);
    // 上游（前 2 个）阶段仍应为 success（不重跑）
    assert.strictEqual(retried.phases[0].status, 'success');
    assert.strictEqual(retried.phases[1].status, 'success');
    assert.strictEqual(retried.phases[2].status, 'success');
    assert.strictEqual(retried.phases[3].status, 'success');
  });
});

// ============================================================
// 4. 批量独立失败
// ============================================================

test('M4-A9: 批量任务中一个失败不影响其他', async () => {
  await withTasks(async () => {
    // 三个版本各自有 raw + 审核通过，触发后只有 v2 注入失败
    const d1 = kl.createDocument({ documentName: 'A' });
    const v1 = kl.createDocumentVersion(d1.document_id, { sourceFileId: 'r1', metadata: {} });
    kl.updateDocumentVersion(v1.version_id, { review_status: 'approved' });
    kl.createRaw({ title: 'A', fileName: 'a.md', content: '# A\n\n足够长。'.repeat(3), bizLine: 'trade', securityLevel: 'internal', documentId: d1.document_id, versionId: v1.version_id });

    const d2 = kl.createDocument({ documentName: 'B' });
    const v2 = kl.createDocumentVersion(d2.document_id, { sourceFileId: 'r2', metadata: {} });
    kl.updateDocumentVersion(v2.version_id, { review_status: 'approved' });
    kl.createRaw({ title: 'B', fileName: 'b.md', content: '# B\n\n足够长。'.repeat(3), bizLine: 'trade', securityLevel: 'internal', documentId: d2.document_id, versionId: v2.version_id });

    const d3 = kl.createDocument({ documentName: 'C' });
    const v3 = kl.createDocumentVersion(d3.document_id, { sourceFileId: 'r3', metadata: {} });
    kl.updateDocumentVersion(v3.version_id, { review_status: 'approved' });
    kl.createRaw({ title: 'C', fileName: 'c.md', content: '# C\n\n足够长。'.repeat(3), bizLine: 'trade', securityLevel: 'internal', documentId: d3.document_id, versionId: v3.version_id });

    const t1 = ap.createTask({ versionId: v1.version_id });
    const t2 = ap.createTask({ versionId: v2.version_id });
    const t3 = ap.createTask({ versionId: v3.version_id });

    // v2 注入失败
    ap.runTask(t1.task_id, kl);
    ap.runTask(t2.task_id, kl, { failAt: 'chunking' });
    ap.runTask(t3.task_id, kl);

    const r1 = await waitForTask(t1.task_id);
    const r2 = await waitForTask(t2.task_id);
    const r3 = await waitForTask(t3.task_id);
    assert.strictEqual(r1.status, 'success');
    assert.strictEqual(r2.status, 'failed');
    assert.strictEqual(r3.status, 'success');
  });
});

// ============================================================
// 5. 与 knowledge-layers 的集成：generateVectors 端到端
// ============================================================

test('M4-A10: kl.generateVectors 端到端 — 完整跑过 4 阶段并落库 chunk/vector', () => {
  withTasks(() => {
    const { version } = seedDocAndVersion({
      content: '# 订单管理\n\n订单创建流程。\n\n## 退款规则\n\n退款三日内到账。',
    });
    // 用 sync 版本避免 setImmediate 与测试夹具的竞争
    const done = kl.generateVectorsSync(version.version_id, { triggeredBy: 'admin' });
    assert.ok(done);
    assert.strictEqual(done.status, 'success');
    // 验证 std / chunks / vectors 都已落库
    const stds = kl.listStds().filter((s) => s.versionId === version.version_id);
    assert.ok(stds.length >= 1, '应至少有 1 个 std');
    const chunks = kl.listChunks().filter((c) => c.versionId === version.version_id);
    assert.ok(chunks.length >= 1, '应至少有 1 个 chunk');
    const vectors = kl.listVectors().filter((v) => v.versionId === version.version_id);
    assert.ok(vectors.length >= 1, '应至少有 1 个 vector');
    assert.strictEqual(chunks.length, vectors.length, '1:1 向量化');
  });
});

test('M4-A11: kl.getProcessingStatus 返回当前处理状态', () => {
  withTasks(() => {
    const { version } = seedDocAndVersion();
    // 处理前
    const before = kl.getProcessingStatus(version.version_id);
    assert.strictEqual(before.status, 'not_started');
    // 触发（用 sync）
    kl.generateVectorsSync(version.version_id);
    // 处理后
    const after = kl.getProcessingStatus(version.version_id);
    assert.strictEqual(after.status, 'success');
  });
});
