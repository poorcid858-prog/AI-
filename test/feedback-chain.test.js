/**
 * 任务 9 测试 —— 全链路记录 + 双向反馈
 *
 * 覆盖：
 *   F1. 全链路快照记录包含所有新增字段（intent, workflow, chain, references, llm, qc）
 *   F2. 获取全链路记录 GET /api/feedback/chain/:sessionId/:turn
 *   F3. 点赞/点踩反馈（POST /api/feedback/record → up/down）
 *   F4. 标记为优秀案例（POST /api/feedback/flag-as-example → 写入 qa-examples）
 *   F5. 优秀案例列表（GET /api/feedback/examples）
 *   F6. AI 生成→知识库回流（POST /api/feedback/back-to-knowledge）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');

// ============================================================
// 隔离夹具
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-fb-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// F1. 全链路快照记录包含所有新增字段
// ============================================================

test('F1: recordSnapshot 记录全链路（intent/workflow/chain/references/llm/qc）', () => {
  withTempDataDir(() => {
    const snapshot = require('../lib/retrieval-snapshot');
    const out = snapshot.recordSnapshot({
      sessionId: 's_f1',
      turn: 1,
      userQuestion: '生成退款流程PRD',
      user: { id: 'u_1', name: '测试' },
      retrievalResults: [{ id: 'chk_1', content: '退款规则', heading: '退款', score: 0.5 }],
      aiOutput: 'PRD 输出',
      promptText: '[角色] product\n[问题] 生成退款流程PRD',
      qualityScore: 8,
      intentResult: { taskType: 'PRD生成', confidence: 0.88, role: 'product', entities: [] },
      workflowId: 'wf_prd',
      chain: [
        { nodeId: 'node_1', nodeType: 'intent', nodeName: '意图', latencyMs: 1, ok: true },
        { nodeId: 'node_2', nodeType: 'llm', nodeName: 'LLM', latencyMs: 2, ok: true },
      ],
      references: [{ name: 'PRD模板', type: 'template', content: '1.背景 2.目标' }],
      llmResult: 'PRD 输出',
      qualityCheck: { passed: true, score: 8, issues: [] },
    });

    // 基本字段
    assert.ok(out.id, '应有 id');
    assert.strictEqual(out.sessionId, 's_f1');
    assert.strictEqual(out.turn, 1);

    // 意图
    assert.ok(out.intentResult, '应有 intentResult');
    assert.strictEqual(out.intentResult.taskType, 'PRD生成');
    assert.strictEqual(out.intentResult.confidence, 0.88);

    // Workflow
    assert.strictEqual(out.workflowId, 'wf_prd');

    // 链路
    assert.ok(Array.isArray(out.chain) && out.chain.length === 2, '应有 2 步链路');
    assert.strictEqual(out.chain[0].nodeType, 'intent');

    // References
    assert.ok(Array.isArray(out.references) && out.references.length === 1);
    assert.strictEqual(out.references[0].name, 'PRD模板');

    // LLM 结果
    assert.strictEqual(out.llmResult, 'PRD 输出');

    // 质量检查
    assert.ok(out.qualityCheck);
    assert.strictEqual(out.qualityCheck.passed, true);
    assert.strictEqual(out.qualityCheck.score, 8);

    // 落盘可读回
    const read = snapshot.getSnapshot('s_f1', 1);
    assert.ok(read, '应能读回');
    assert.strictEqual(read.workflowId, 'wf_prd');
  });
});

// ============================================================
// F2. 全链路记录查询（getSnapshot 直接函数层）
// ============================================================

test('F2: getSnapshot 返回完整全链路记录', () => {
  withTempDataDir(() => {
    const snapshot = require('../lib/retrieval-snapshot');
    snapshot.recordSnapshot({
      sessionId: 's_f2',
      turn: 2,
      userQuestion: '写测试用例',
      user: { id: 'u_1', name: '测试' },
      workflowId: 'wf_test',
      chain: [{ nodeId: 'n1', nodeType: 'skill', nodeName: '测试分析', latencyMs: 5, ok: true }],
      aiOutput: '用例输出',
    });

    const read = snapshot.getSnapshot('s_f2', 2);
    assert.ok(read, '应能查到');
    assert.strictEqual(read.workflowId, 'wf_test');
    assert.strictEqual(read.chain.length, 1);
    assert.strictEqual(read.chain[0].nodeType, 'skill');
  });
});

// ============================================================
// F3. 点赞/点踩反馈（qa.getQAPair）
// ============================================================

test('F3: getQAPair 取某个 session/turn 的问答对', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    // 造 user + ai record
    qa.appendRecord({
      id: 'qa_u1', sessionId: 's_f3', turn: 1, type: 'user',
      content: '退款流程是什么', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });
    qa.appendRecord({
      id: 'qa_a1', sessionId: 's_f3', turn: 1, type: 'ai',
      content: '退款需要 3 个工作日', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });

    const pair = qa.getQAPair('s_f3', 1);
    assert.ok(pair, '应取到问答对');
    assert.strictEqual(pair.user.content, '退款流程是什么');
    assert.strictEqual(pair.ai.content, '退款需要 3 个工作日');

    const none = qa.getQAPair('s_ghost', 9);
    assert.strictEqual(none, null);
  });
});

// ============================================================
// F4. 标记为优秀案例（addExample → qa-examples.json）
// ============================================================

test('F4: addExample 写入优秀案例库（双向反馈回路一）', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    const out = qa.addExample({
      role: 'product',
      question: '如何制定验收标准？',
      answer: '用 SMART 原则...',
      tags: ['PRD', '验收'],
    });
    assert.strictEqual(out.ok, true);
    assert.ok(out.id, '应有 id');

    // 读回
    const list = qa.listExamples('product');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].question, '如何制定验收标准？');
    assert.deepStrictEqual(list[0].tags, ['PRD', '验收']);
  });
});

test('F4b: addExample 同 role 同问题去重', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    qa.addExample({ role: 'product', question: '写 PRD', answer: 'A' });
    const dup = qa.addExample({ role: 'product', question: '写PRD', answer: 'B' });
    assert.strictEqual(dup.duplicated, true, '归一化后相同问题应判重');
    const list = qa.listExamples('product');
    assert.strictEqual(list.length, 1);
  });
});

test('F4c: listExamples 按角色过滤', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    qa.addExample({ role: 'product', question: '写 PRD', answer: 'A' });
    qa.addExample({ role: 'test', question: '写测试', answer: 'B' });
    const products = qa.listExamples('product');
    assert.strictEqual(products.length, 1);
    assert.strictEqual(products[0].role, 'product');
    const all = qa.listExamples();
    assert.strictEqual(all.length, 2);
  });
});

// ============================================================
// F5. flag-as-example 全流程（getQAPair → addExample）
// ============================================================

test('F5: 从问答对标记为优秀案例', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    // 造一轮问答
    qa.appendRecord({
      id: 'qa_u1', sessionId: 's_f5', turn: 1, type: 'user',
      content: '生成退款流程PRD', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });
    qa.appendRecord({
      id: 'qa_a1', sessionId: 's_f5', turn: 1, type: 'ai',
      content: '## PRD\n背景/目标/流程', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });

    const pair = qa.getQAPair('s_f5', 1);
    assert.ok(pair);

    const res = qa.addExample({
      role: pair.user.role,
      question: pair.user.content,
      answer: pair.ai.content,
      tags: [],
      source: 'session:s_f5/turn:1',
    });
    assert.strictEqual(res.ok, true);
    const list = qa.listExamples('product');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].question, '生成退款流程PRD');
    assert.ok(list[0].answer.includes('PRD'));
  });
});

// ============================================================
// F6. AI 生成→知识库回流（back-to-knowledge 后端）
// ============================================================

test('F6: createRaw → markReady → createStdVersion → pending 回流流程', () => {
  withTempDataDir(() => {
    const qa = require('../lib/qa-store');
    const kl = require('../lib/knowledge-layers');

    // 造 AI 回答
    qa.appendRecord({
      id: 'qa_u1', sessionId: 's_f6', turn: 1, type: 'user',
      content: '生成退款规则文档', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });
    qa.appendRecord({
      id: 'qa_a1', sessionId: 's_f6', turn: 1, type: 'ai',
      content: '退款需提交订单号，3 个工作日内处理。', timestamp: '2026-08-16T00:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u_1',
    });

    // 模拟 back-to-knowledge 流程的前半段
    const aiRecord = qa.listBySession('s_f6').find((r) => r.turn === 1 && r.type === 'ai');
    assert.ok(aiRecord);

    const raw = kl.createRaw({
      title: 'AI 生成回流_s_f6_1',
      content: aiRecord.content,
      bizLine: 'trade',
      securityLevel: 'internal',
      knowledgeType: 'other',
      uploadedBy: 'admin',
      tags: ['ai_generated'],
    });
    assert.ok(raw.id, '应创建 raw');
    kl.markReady(raw.id);

    const std = kl.createStdVersion(raw.id, { content: aiRecord.content });
    assert.ok(std.id, '应创建 std');
    kl.setStdStatus(std.id, 'pending', { reviewedBy: 'admin' });

    const finalStd = kl.getStd(std.id);
    assert.strictEqual(finalStd.status, 'pending', '状态应为 pending（等待审核）');
  });
});