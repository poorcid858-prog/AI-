/**
 * 快照对比引擎测试 —— 需求 7：回答对比调试工具
 *
 * 测试覆盖：
 *   T1: 测试问题集维护 —— 增删改
 *   T2: 生成快照 A（记录拆解结果、召回片段、AI 回答、客服命中率）
 *   T3: 生成快照 B（基于不同数据，标记为 B）
 *   T4: 快照 A/B 并排对比 —— 召回差异
 *   T5: 快照 A/B 并排对比 —— 回答内容差异
 *   T6: 快照 A/B 并排对比 —— 客服命中率变化
 *   T7: 快照 A/B 并排对比 —— 综合结论（变好/变坏/无影响）
 *   T8: 空快照 / 边界情况
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');

// 延迟加载 snapshot-compare 模块（测试隔离后需要先设 data 目录）
let sc;

// ============================================================
// 隔离夹具
// ============================================================

function withIsolation(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-snapshot-compare-test-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    delete require.cache[require.resolve('../lib/snapshot-compare')];
    sc = require('../lib/snapshot-compare');
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

// ============================================================
// T1: 测试问题集维护
// ============================================================

test('T1: 测试问题集维护 —— 增删改', () => {
  withIsolation(() => {
    // 空列表
    assert.deepStrictEqual(sc.listQuestions(), [], '初始应为空列表');

    // 新增
    const q1 = sc.addQuestion({
      text: '退款流程怎么操作',
      role: 'cs',
      category: '客服',
    });
    assert.ok(q1, '应返回新增问题');
    assert.ok(q1.id, '应有 ID');
    assert.strictEqual(q1.text, '退款流程怎么操作');
    assert.strictEqual(q1.role, 'cs');
    assert.strictEqual(q1.category, '客服');

    const q2 = sc.addQuestion({
      text: '订单管理模块退款需求的 PRD',
      role: 'product',
      category: '内部助手',
    });
    assert.ok(q2, '应返回第二题');

    assert.strictEqual(sc.listQuestions().length, 2, '应有 2 个问题');

    // 修改
    const updated = sc.updateQuestion(q1.id, { text: '退款流程如何操作', category: '客服-常见' });
    assert.ok(updated, '更新应成功');
    assert.strictEqual(updated.text, '退款流程如何操作');
    assert.strictEqual(updated.category, '客服-常见');

    // 删除
    const removed = sc.removeQuestion(q1.id);
    assert.strictEqual(removed, true, '删除应成功');
    assert.strictEqual(sc.listQuestions().length, 1, '删除后应剩 1 个');

    // 删不存在的
    const removedNone = sc.removeQuestion('nonexistent');
    assert.strictEqual(removedNone, false, '删除不存在的应返回 false');
  });
});

// ============================================================
// T2: 生成快照 A
// ============================================================

test('T2: 生成快照 A', () => {
  withIsolation(() => {
    // 先准备测试问题
    sc.addQuestion({ text: '退款流程怎么操作', role: 'cs', category: '客服' });
    sc.addQuestion({ text: '订单管理 PRD', role: 'product', category: '内部助手' });

    // 为每个问题准备模拟结果
    const answers = [
      {
        questionIndex: 0,
        decomposed: {
          originalTokens: ['退款', '流程', '怎么', '操作'],
          filteredTokens: ['退款', '流程', '操作'],
          normalizedTokens: ['退款', '流程', '操作'],
        },
        retrievedChunks: [
          { id: 'chunk_001', content: '退款流程说明', score: 0.85 },
          { id: 'chunk_002', content: '审核流程说明', score: 0.42 },
        ],
        aiAnswer: '退款流程：用户提交申请后进入审核。',
        serviceHitRate: 0.67,
        transferRate: 0.33,
      },
      {
        questionIndex: 1,
        decomposed: {
          originalTokens: ['订单', '管理', 'prd'],
          filteredTokens: ['订单', '管理', 'prd'],
          normalizedTokens: ['订单', '管理', 'prd'],
        },
        retrievedChunks: [
          { id: 'chunk_003', content: '订单管理需求', score: 0.92 },
        ],
        aiAnswer: '订单管理 PRD：包含退款、物流、优惠券模块。',
        serviceHitRate: 1.0,
        transferRate: 0.0,
      },
    ];

    const snapshotA = sc.generateSnapshot('A', answers);
    assert.ok(snapshotA, '应返回快照 A');
    assert.strictEqual(snapshotA.label, 'A', '标签应为 A');
    assert.ok(snapshotA.id, '应有快照 ID');
    assert.ok(snapshotA.timestamp, '应有时间戳');
    assert.strictEqual(snapshotA.results.length, 2, '应有 2 个结果');

    // 检查第一个结果字段
    const r1 = snapshotA.results[0];
    assert.ok(r1.decomposed, '应有拆解结果');
    assert.ok(Array.isArray(r1.retrievedChunks), '应有召回片段数组');
    assert.strictEqual(typeof r1.aiAnswer, 'string', '应有 AI 回答');
    assert.strictEqual(typeof r1.serviceHitRate, 'number', '应有客服命中率');
    assert.strictEqual(typeof r1.transferRate, 'number', '应有转人工率');

    // 快照应持久化到存储
    const list = sc.listSnapshots();
    assert.strictEqual(list.length, 1, '应有 1 个快照');
    assert.strictEqual(list[0].label, 'A');
  });
});

// ============================================================
// T3: 生成快照 B
// ============================================================

test('T3: 生成快照 B', () => {
  withIsolation(() => {
    sc.addQuestion({ text: '退款流程怎么操作', role: 'cs', category: '客服' });

    // 快照 A
    const answersA = [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款', '流程'], filteredTokens: ['退款', '流程'], normalizedTokens: ['退款', '流程'] },
      retrievedChunks: [{ id: 'chunk_001', content: '退款流程说明', score: 0.85 }],
      aiAnswer: '旧版回答：退款流程说明。',
      serviceHitRate: 0.5,
      transferRate: 0.5,
    }];
    sc.generateSnapshot('A', answersA);

    // 快照 B（改动后）
    const answersB = [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款', '流程'], filteredTokens: ['退款', '流程'], normalizedTokens: ['退款', '流程'] },
      retrievedChunks: [
        { id: 'chunk_001', content: '退款流程说明', score: 0.85 },
        { id: 'chunk_004', content: '新增：退款加速说明', score: 0.71 },
      ],
      aiAnswer: '新版回答：退款流程已更新，新增加速通道。',
      serviceHitRate: 0.8,
      transferRate: 0.2,
    }];
    const snapshotB = sc.generateSnapshot('B', answersB);
    assert.strictEqual(snapshotB.label, 'B', '标签应为 B');

    const list = sc.listSnapshots();
    assert.strictEqual(list.length, 2, '应有 2 个快照');
  });
});

// ============================================================
// T4: 快照 A/B 对比 —— 召回差异
// ============================================================

test('T4: 快照 A/B 对比 —— 召回差异', () => {
  withIsolation(() => {
    sc.addQuestion({ text: '退款流程怎么操作', role: 'cs', category: '客服' });
    sc.addQuestion({ text: '订单管理 PRD', role: 'product', category: '内部助手' });

    // 快照 A
    const answersA = [
      {
        questionIndex: 0,
        decomposed: { originalTokens: ['退款', '流程'], filteredTokens: ['退款', '流程'], normalizedTokens: ['退款', '流程'] },
        retrievedChunks: [
          { id: 'chunk_001', content: '退款流程说明', score: 0.85 },
          { id: 'chunk_002', content: '审核流程说明', score: 0.42 },
        ],
        aiAnswer: '旧版回答。',
        serviceHitRate: 0.5,
        transferRate: 0.5,
      },
      {
        questionIndex: 1,
        decomposed: { originalTokens: ['订单'], filteredTokens: ['订单'], normalizedTokens: ['订单'] },
        retrievedChunks: [
          { id: 'chunk_003', content: '订单管理需求', score: 0.92 },
        ],
        aiAnswer: '订单管理说明。',
        serviceHitRate: 0.8,
        transferRate: 0.2,
      },
    ];
    sc.generateSnapshot('A', answersA);

    // 快照 B（chunk_002 被替换为 chunk_004）
    const answersB = [
      {
        questionIndex: 0,
        decomposed: { originalTokens: ['退款', '流程'], filteredTokens: ['退款', '流程'], normalizedTokens: ['退款', '流程'] },
        retrievedChunks: [
          { id: 'chunk_001', content: '退款流程说明', score: 0.85 },
          { id: 'chunk_004', content: '新增：退款加速说明', score: 0.73 },
        ],
        aiAnswer: '新版回答。',
        serviceHitRate: 0.85,
        transferRate: 0.15,
      },
      {
        questionIndex: 1,
        decomposed: { originalTokens: ['订单'], filteredTokens: ['订单'], normalizedTokens: ['订单'] },
        retrievedChunks: [
          { id: 'chunk_003', content: '订单管理需求', score: 0.92 },
        ],
        aiAnswer: '订单管理说明。',
        serviceHitRate: 0.8,
        transferRate: 0.2,
      },
    ];
    sc.generateSnapshot('B', answersB);

    // 对比
    const compare = sc.compareSnapshots('A', 'B');
    assert.ok(compare, '应返回对比结果');
    assert.strictEqual(compare.snapshotALabel, 'A');
    assert.strictEqual(compare.snapshotBLabel, 'B');
    assert.ok(Array.isArray(compare.diffs), '应有差异数组');

    // 第 1 个问题应有召回差异
    const diff0 = compare.diffs[0];
    assert.ok(diff0, '第一个问题应有对比');
    assert.strictEqual(diff0.questionText, '退款流程怎么操作');
    assert.ok(diff0.retrievalChanged, '召回应标记为有变化');
    assert.ok(diff0.retrievalDiff, '应有召回差异详情');
    assert.ok(Array.isArray(diff0.retrievalDiff.added), '应有新增片段');
    assert.ok(Array.isArray(diff0.retrievalDiff.removed), '应有移除片段');
    assert.strictEqual(diff0.retrievalDiff.added.length, 1, '应新增 1 个片段');
    assert.strictEqual(diff0.retrievalDiff.removed.length, 1, '应移除 1 个片段');

    // 第 2 个问题无变化
    const diff1 = compare.diffs[1];
    assert.strictEqual(diff1.retrievalChanged, false, '第二个问题召回应无变化');
    assert.strictEqual(diff1.answerChanged, false, '回答应无变化');
  });
});

// ============================================================
// T5: 快照 A/B 对比 —— 回答内容差异
// ============================================================

test('T5: 快照 A/B 对比 —— 回答内容差异', () => {
  withIsolation(() => {
    sc.addQuestion({ text: '退款流程怎么操作', role: 'cs', category: '客服' });

    // 快照 A
    sc.generateSnapshot('A', [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
      retrievedChunks: [{ id: 'chunk_001', content: '旧版内容', score: 0.8 }],
      aiAnswer: '旧版回答：退款需走审核流程。',
      serviceHitRate: 0.5,
      transferRate: 0.5,
    }]);

    // 快照 B（回答变了）
    sc.generateSnapshot('B', [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
      retrievedChunks: [{ id: 'chunk_001', content: '新版内容', score: 0.9 }],
      aiAnswer: '新版回答：退款已支持自动审核，无需人工介入。',
      serviceHitRate: 0.9,
      transferRate: 0.1,
    }]);

    const compare = sc.compareSnapshots('A', 'B');
    const diff = compare.diffs[0];
    assert.ok(diff.answerChanged, '回答应标记为有变化');
    assert.ok(diff.answerDiff, '应有回答差异详情');
    // 至少应记录旧版和新版回答
    assert.strictEqual(diff.answerDiff.oldAnswer, '旧版回答：退款需走审核流程。');
    assert.strictEqual(diff.answerDiff.newAnswer, '新版回答：退款已支持自动审核，无需人工介入。');
  });
});

// ============================================================
// T6: 快照 A/B 对比 —— 客服命中率变化
// ============================================================

test('T6: 快照 A/B 对比 —— 客服命中率变化', () => {
  withIsolation(() => {
    sc.addQuestion({ text: '退款多久到账', role: 'cs', category: '客服' });

    // 快照 A：低命中率
    sc.generateSnapshot('A', [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
      retrievedChunks: [{ id: 'chunk_001', content: '内容', score: 0.5 }],
      aiAnswer: '旧版回答。',
      serviceHitRate: 0.62,
      transferRate: 0.38,
    }]);

    // 快照 B：高命中率
    sc.generateSnapshot('B', [{
      questionIndex: 0,
      decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
      retrievedChunks: [{ id: 'chunk_001', content: '更好的内容', score: 0.9 }],
      aiAnswer: '新版回答。',
      serviceHitRate: 0.87,
      transferRate: 0.13,
    }]);

    const compare = sc.compareSnapshots('A', 'B');
    const diff = compare.diffs[0];
    assert.ok(diff.metricsChanged, '指标应标记为有变化');
    assert.ok(diff.metricsDiff, '应有指标差异详情');
    assert.strictEqual(diff.metricsDiff.serviceHitRate.old, 0.62);
    assert.strictEqual(diff.metricsDiff.serviceHitRate.new, 0.87);
    assert.strictEqual(diff.metricsDiff.serviceHitRate.delta, 0.25, 'delta 应为 0.25');
    assert.strictEqual(diff.metricsDiff.transferRate.old, 0.38);
    assert.strictEqual(diff.metricsDiff.transferRate.new, 0.13);
    assert.strictEqual(diff.metricsDiff.transferRate.delta, -0.25, 'delta 应为 -0.25');
  });
});

// ============================================================
// T7: 综合结论
// ============================================================

test('T7: 快照 A/B 对比 —— 综合结论（变好/变坏/无影响）', () => {
  withIsolation(() => {
    sc.addQuestion({ text: '退款流程怎么操作', role: 'cs', category: '客服' });
    sc.addQuestion({ text: '订单管理 PRD', role: 'product', category: '内部助手' });

    // 快照 A
    sc.generateSnapshot('A', [
      {
        questionIndex: 0,
        decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
        retrievedChunks: [{ id: 'chunk_001', content: '旧内容', score: 0.5 }],
        aiAnswer: '旧版回答。',
        serviceHitRate: 0.5,
        transferRate: 0.5,
      },
      {
        questionIndex: 1,
        decomposed: { originalTokens: ['订单'], filteredTokens: ['订单'], normalizedTokens: ['订单'] },
        retrievedChunks: [{ id: 'chunk_002', content: '订单内容', score: 0.9 }],
        aiAnswer: '订单说明。',
        serviceHitRate: 0.8,
        transferRate: 0.2,
      },
    ]);

    // 快照 B：问题 0 变好，问题 1 无变化
    sc.generateSnapshot('B', [
      {
        questionIndex: 0,
        decomposed: { originalTokens: ['退款'], filteredTokens: ['退款'], normalizedTokens: ['退款'] },
        retrievedChunks: [{ id: 'chunk_001', content: '更好的内容', score: 0.9 }],
        aiAnswer: '更好的回答。',
        serviceHitRate: 0.9,
        transferRate: 0.1,
      },
      {
        questionIndex: 1,
        decomposed: { originalTokens: ['订单'], filteredTokens: ['订单'], normalizedTokens: ['订单'] },
        retrievedChunks: [{ id: 'chunk_002', content: '订单内容', score: 0.9 }],
        aiAnswer: '订单说明。',
        serviceHitRate: 0.8,
        transferRate: 0.2,
      },
    ]);

    const compare = sc.compareSnapshots('A', 'B');
    assert.ok(compare.summary, '应有综合摘要');
    assert.strictEqual(typeof compare.summary.improved, 'number', '应有改善计数');
    assert.strictEqual(typeof compare.summary.worsened, 'number', '应有变差计数');
    assert.strictEqual(typeof compare.summary.unchanged, 'number', '应有无变化计数');
    assert.strictEqual(compare.summary.improved, 1, '应标记 1 个改善');
    assert.strictEqual(compare.summary.worsened, 0, '应标记 0 个变差');
    assert.strictEqual(compare.summary.unchanged, 1, '应标记 1 个无变化');
  });
});

// ============================================================
// T8: 边界情况
// ============================================================

test('T8: 边界情况', () => {
  withIsolation(() => {
    // 空快照列表
    assert.deepStrictEqual(sc.listSnapshots(), [], '空快照列表');

    // 对比不存在的快照
    assert.throws(() => sc.compareSnapshots('A', 'B'), /不存在/, '应抛错提示快照不存在');

    // 只有一个快照时对比
    sc.addQuestion({ text: '测试问题', role: 'cs', category: '客服' });
    sc.generateSnapshot('A', [{
      questionIndex: 0,
      decomposed: { originalTokens: [], filteredTokens: [], normalizedTokens: [] },
      retrievedChunks: [],
      aiAnswer: '回答。',
      serviceHitRate: 0.5,
      transferRate: 0.5,
    }]);
    assert.throws(() => sc.compareSnapshots('A', 'B'), /不存在/, 'B 不存在时应抛错');

    // 删除快照
    const snapshots = sc.listSnapshots();
    const removed = sc.removeSnapshot(snapshots[0].id);
    assert.strictEqual(removed, true, '删除快照应成功');
    assert.strictEqual(sc.listSnapshots().length, 0, '删除后应为空');
  });
});