/**
 * 检索快照引擎测试 —— 需求 6：召回可观测与反向修复
 *
 * 测试覆盖：
 *   S1: 记录一条完整检索快照
 *   S2: 按 sessionId + turn 查询快照
 *   S3: 快照包含完整链路（原始问题 → 拆解 → 权限过滤 → 召回 → 重排 → 提示词 → 输出）
 *   S4: 修复动作：删除文档（deleteRawCascade）影响预览
 *   S5: 修复动作：调参数重新标准化（reprocess preview）影响预览
 *   S6: 安全设计：执行前影响预览
 *   S7: 回归验证：拿历史真实问题重放对比
 *   S8: 快照统计：召回率分布、零召回问题、高频引用片段排行
 *   S9: 快照中权限过滤记录
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const rag = require('../lib/rag-engine');
const vectorStore = require('../lib/vector-store');

// 延迟加载 snapshot 模块（测试隔离后需要先设 data 目录）
let snapshot;

// ============================================================
// 隔离夹具
// ============================================================

function withIsolation(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-retrieval-test-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    // 每次隔离后重新加载模块（缓存不同）
    delete require.cache[require.resolve('../lib/retrieval-snapshot')];
    snapshot = require('../lib/retrieval-snapshot');
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

/** 构建四层链并 publish */
function buildPublishedDoc(bizLine = 'trade', securityLevel = 'internal', content = '默认内容：用户提交退款申请后系统进入审核环节的处理流程说明。') {
  const raw = kl.createRaw({
    title: '测试文档',
    fileName: 'test.md',
    fileType: 'md',
    content,
    knowledgeType: 'business_rule',
    bizLine,
    securityLevel,
  });
  kl.markReady(raw.id);
  const std = kl.createStdVersion(raw.id, { content });
  const chunks = kl.createChunks(std.id, [
    { content: '用户提交退款申请后系统进入审核环节的处理流程说明。', heading: '退款流程' },
    { content: '审核通过后系统自动将退款金额原路返回至用户支付账户。', heading: '退款流程' },
    { content: '会员积分兑换规则：每100积分可兑换1元，最低兑换10元。', heading: '积分规则' },
  ]);
  chunks.forEach((c) => {
    kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main' });
  });
  kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
  kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED);
  kl.publishStd(std.id);
  return { raw, std, chunks };
}

// ============================================================
// S1: 记录一条完整检索快照
// ============================================================

test('S1: 记录一条完整检索快照', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    const index = rag.loadApprovedIndex();

    // 模拟用户
    const user = { id: 'user_001', name: '测试用户', role: 'admin', bizLine: 'all' };

    // 执行检索 — 模拟 chat 流程
    const results = rag.retrieve(user, '退款流程怎么操作', index);

    // 记录快照
    const record = snapshot.recordSnapshot({
      sessionId: 's_test_001',
      turn: 1,
      userQuestion: '退款流程怎么操作',
      user,
      retrievalResults: results,
      ragIndex: index,
      aiOutput: '退款流程：用户提交退款申请后，系统进入审核环节...',
      qualityScore: 8,
    });

    assert.ok(record, '应返回快照记录');
    assert.ok(record.id, '快照应有 ID');
    assert.strictEqual(record.sessionId, 's_test_001');
    assert.strictEqual(record.turn, 1);
    assert.strictEqual(record.userQuestion, '退款流程怎么操作');
    assert.ok(record.aiOutput, '应有 AI 输出');
    assert.strictEqual(record.qualityScore, 8);
    assert.ok(record.timestamp, '应有时间戳');
  });
});

// ============================================================
// S2: 按 sessionId + turn 查询快照
// ============================================================

test('S2: 按 sessionId + turn 查询快照', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    const index = rag.loadApprovedIndex();
    const user = { id: 'user_001', name: '测试用户', role: 'admin', bizLine: 'all' };

    const results = rag.retrieve(user, '退款流程', index);
    snapshot.recordSnapshot({
      sessionId: 's_test_002',
      turn: 1,
      userQuestion: '退款流程',
      user,
      retrievalResults: results,
      ragIndex: index,
      aiOutput: '退款流程说明。',
    });

    const found = snapshot.getSnapshot('s_test_002', 1);
    assert.ok(found, '应能找到快照');
    assert.strictEqual(found.sessionId, 's_test_002');
    assert.strictEqual(found.turn, 1);

    const notFound = snapshot.getSnapshot('s_test_002', 999);
    assert.strictEqual(notFound, null, '不存在的 turn 应返回 null');

    const sessionNotFound = snapshot.getSnapshot('nonexistent', 1);
    assert.strictEqual(sessionNotFound, null, '不存在的 session 应返回 null');
  });
});

// ============================================================
// S3: 快照包含完整链路
// ============================================================

test('S3: 快照包含完整链路（原始问题 → 拆解 → 权限过滤 → 召回 → 重排 → 提示词 → 输出）', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    const index = rag.loadApprovedIndex();
    const user = { id: 'user_001', name: '测试用户', role: 'admin', bizLine: 'all' };

    const results = rag.retrieve(user, '退款流程怎么操作', index);
    const record = snapshot.recordSnapshot({
      sessionId: 's_test_003',
      turn: 1,
      userQuestion: '退款流程怎么操作',
      user,
      retrievalResults: results,
      ragIndex: index,
      aiOutput: '退款流程说明。',
      // 显式补充拆解结果
      decomposed: {
        originalTokens: ['退款', '流程', '怎么', '操作'],
        afterStopwords: ['退款', '流程', '操作'],
        afterNormalize: ['退款', '流程', '操作'],
      },
      // 权限过滤记录
      permissionFilter: {
        beforeFilter: 3,
        afterFilter: 3,
        denied: [],
      },
      // 提示词全文
      promptText: '你是一个AI助手。\n\n知识：\n- 退款流程：用户提交退款申请...\n\n问题：退款流程怎么操作',
    });

    assert.ok(record.decomposed, '应有拆解结果');
    assert.ok(Array.isArray(record.decomposed.originalTokens), '应有原始 token');
    assert.ok(Array.isArray(record.decomposed.afterStopwords), '应有去停用词后 token');
    assert.ok(Array.isArray(record.decomposed.afterNormalize), '应有归一化后 token');

    assert.ok(record.permissionFilter, '应有权限过滤记录');
    assert.strictEqual(typeof record.permissionFilter.beforeFilter, 'number', '应有过滤前候选数');
    assert.strictEqual(typeof record.permissionFilter.afterFilter, 'number', '应有过滤后候选数');

    assert.ok(record.promptText, '应有提示词全文');
    assert.ok(record.aiOutput, '应有 AI 输出');

    // 召回结果应该包含每条的信息
    assert.ok(Array.isArray(record.retrievalResults), '召回结果应为数组');
    if (record.retrievalResults.length > 0) {
      const first = record.retrievalResults[0];
      assert.ok('score' in first, '每条召回应有分数');
      assert.ok('content' in first, '每条召回应有内容');
    }
  });
});

// ============================================================
// S4: 修复动作 - 删除文档影响预览
// ============================================================

test('S4: 修复动作：删除文档（deleteRawCascade）影响预览', () => {
  withIsolation(() => {
    // 构造一条有文档的 RAG 环境
    const { raw, std, chunks } = buildPublishedDoc();
    const index = rag.loadApprovedIndex();

    // 使用 snapshot 的影响预览功能
    const impact = snapshot.previewImpact('delete_doc', { rawId: raw.id });

    assert.ok(impact, '应返回影响预览');
    assert.strictEqual(impact.action, 'delete_doc', '应标记动作类型');
    assert.strictEqual(typeof impact.rawCount, 'number', '应有 raw 计数');
    assert.strictEqual(typeof impact.stdCount, 'number', '应有 std 计数');
    assert.strictEqual(typeof impact.chunkCount, 'number', '应有 chunk 计数');
    assert.strictEqual(typeof impact.vectorCount, 'number', '应有 vector 计数');
    assert.ok(impact.rawCount > 0, '应至少影响 1 个 raw');
  });
});

// ============================================================
// S5: 修复动作 - 调参数重新标准化影响预览
// ============================================================

test('S5: 修复动作：调参数重新标准化（reprocess preview）影响预览', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();

    // 预览重新标准化影响
    const impact = snapshot.previewImpact('reprocess', { rawId: raw.id, params: { splitMode: 'paragraph' } });

    assert.ok(impact, '应返回影响预览');
    assert.strictEqual(impact.action, 'reprocess');
    assert.ok(impact.rawId, '应包含 rawId');
    assert.ok(impact.currentChunkCount >= 0, '应有当前 chunk 数');
  });
});

// ============================================================
// S6: 安全设计 - 影响预览
// ============================================================

test('S6: 安全设计：执行前显示影响预览', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();

    // 模拟"这个操作将影响"的完整预览信息
    const impact = snapshot.previewImpact('delete_doc', { rawId: raw.id });

    // 安全设计要求：预览必须包含以下字段
    assert.ok(impact, '应有影响预览');
    assert.ok(impact.warning, '应有警告信息');
    // 可选：引用统计（如果数据可用）
    if (impact.recentReferences !== undefined) {
      assert.strictEqual(typeof impact.recentReferences, 'number', '引用统计应为数字');
    }
  });
});

// ============================================================
// S7: 回归验证
// ============================================================

test('S7: 回归验证：拿历史真实问题重放对比', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    // 先发布，建索引
    const index = rag.loadApprovedIndex();
    const user = { id: 'user_001', name: '测试用户', role: 'admin', bizLine: 'all' };

    // 记录一组历史快照
    const originalResults = rag.retrieve(user, '退款流程', index);
    snapshot.recordSnapshot({
      sessionId: 's_regression',
      turn: 1,
      userQuestion: '退款流程',
      user,
      retrievalResults: originalResults,
      ragIndex: index,
      aiOutput: '原始版本的回答。',
    });

    // 模拟"重新加工"后的索引（新内容）
    // 先删旧索引，重建新文档
    kl.deleteRawCascade(raw.id);
    store.clearCache();

    const newRaw = kl.createRaw({
      title: '新版测试文档',
      fileName: 'test.md',
      fileType: 'md',
      content: '新版内容：退款流程已更新，用户需先联系客服确认。',
      knowledgeType: 'business_rule',
      bizLine: 'trade',
      securityLevel: 'internal',
    });
    kl.markReady(newRaw.id);
    const newStd = kl.createStdVersion(newRaw.id, { content: '新版内容：退款流程已更新，用户需先联系客服确认。' });
    const newChunks = kl.createChunks(newStd.id, [
      { content: '退款流程已更新，用户需先联系客服确认。', heading: '退款流程' },
    ]);
    newChunks.forEach((c) => {
      kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [0.2, 0.8], indexName: 'main' });
    });
    kl.setStdStatus(newStd.id, kl.STD_STATUS.PENDING);
    kl.setStdStatus(newStd.id, kl.STD_STATUS.APPROVED);
    kl.publishStd(newStd.id);

    // 重放回归验证
    const newIndex = rag.loadApprovedIndex();
    const newResults = rag.retrieve(user, '退款流程', newIndex);

    // 回归验证应返回新旧对比
    const regression = snapshot.runRegression('s_regression', 1, newResults, newIndex);

    assert.ok(regression, '应返回回归结果');
    assert.ok(regression.ok, '回归应 ok');
    assert.ok(Array.isArray(regression.originalResults), '应有原始结果数组');
    assert.ok(Array.isArray(regression.newResults), '应包含新结果数组');
    assert.ok(Array.isArray(regression.overlapIds), '应有重叠 ID 列表');
    assert.strictEqual(regression.originalQuestion, '退款流程', '应保留原始问题');

    // 如果可以，对比新旧检索结果数量
    if (regression.originalResults && regression.newResults) {
      assert.strictEqual(
        typeof regression.originalResults.length,
        'number',
        '原始结果应为数组',
      );
    }
  });
});

// ============================================================
// S8: 快照统计
// ============================================================

test('S8: 快照统计：召回率分布、零召回问题、高频引用片段排行', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    const index = rag.loadApprovedIndex();
    const user = { id: 'user_001', name: '测试用户', role: 'admin', bizLine: 'all' };

    // 记录多条快照
    const qs = ['退款流程', '积分规则', '会员等级', '物流查询', '支付问题'];
    for (let i = 0; i < qs.length; i++) {
      const results = rag.retrieve(user, qs[i], index);
      snapshot.recordSnapshot({
        sessionId: 's_stats',
        turn: i + 1,
        userQuestion: qs[i],
        user,
        retrievalResults: results,
        ragIndex: index,
        aiOutput: `回答：${qs[i]}`,
      });
    }

    // 统计
    const stats = snapshot.analyzeRetrieval('s_stats');

    assert.ok(stats, '应有统计结果');
    assert.strictEqual(stats.total, 5, '应有 5 个问题');
    assert.strictEqual(typeof stats.avgRecall, 'number', '应有平均召回率');
    assert.ok(Array.isArray(stats.zeroRecallQuestions), '应有零召回问题列表');
    assert.ok(Array.isArray(stats.topCitedChunks), '应有高频引用片段排行');
    assert.ok(stats.recallDistribution, '应有召回率分布');
  });
});

// ============================================================
// S9: 快照中权限过滤记录
// ============================================================

test('S9: 快照中权限过滤记录', () => {
  withIsolation(() => {
    const { raw, std, chunks } = buildPublishedDoc();
    // 再建一个 doc，不同业务线
    const raw2 = kl.createRaw({
      title: '会员线文档',
      fileName: 'membership.md',
      fileType: 'md',
      content: '会员积分兑换规则：每100积分可兑换1元。',
      knowledgeType: 'business_rule',
      bizLine: 'membership',
      securityLevel: 'public',
    });
    kl.markReady(raw2.id);
    const std2 = kl.createStdVersion(raw2.id, { content: '会员积分兑换规则：每100积分可兑换1元。' });
    const chunks2 = kl.createChunks(std2.id, [
      { content: '会员积分兑换规则：每100积分可兑换1元。', heading: '积分规则' },
    ]);
    chunks2.forEach((c) => {
      kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [0.3, 0.7], indexName: 'main' });
    });
    kl.setStdStatus(std2.id, kl.STD_STATUS.PENDING);
    kl.setStdStatus(std2.id, kl.STD_STATUS.APPROVED);
    kl.publishStd(std2.id);

    const index = rag.loadApprovedIndex();

    // 用 trade 线用户（只能看 trade）
    const tradeUser = { id: 'user_trade', name: '交易线用户', role: 'product', bizLine: 'trade' };

    const results = rag.retrieve(tradeUser, '积分规则', index);
    const record = snapshot.recordSnapshot({
      sessionId: 's_perm',
      turn: 1,
      userQuestion: '积分规则',
      user: tradeUser,
      retrievalResults: results,
      ragIndex: index,
      aiOutput: '关于积分规则的说明。',
      // 权限过滤记录
      permissionFilter: {
        beforeFilter: 2,
        afterFilter: results.length,
        denied: ['会员积分兑换规则：每100积分可兑换1元。'],
      },
    });

    assert.ok(record.permissionFilter, '应有权限过滤记录');
    assert.ok(Array.isArray(record.permissionFilter.denied), '应有被拒绝的文档列表');
  });
});