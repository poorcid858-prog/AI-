/**
 * 快照对比引擎 —— 需求 7：回答对比调试工具
 *
 * 功能：
 *   1. 维护一组测试问题（增删改）
 *   2. 生成快照 A / B（记录拆解结果、召回片段、AI 回答、客服命中率）
 *   3. 快照 A/B 并排对比（召回差异、回答差异、指标变化、综合结论）
 *
 * 存储：data/snapshot-compare.json
 *   - questions: TestQuestion[]
 *   - snapshots: Snapshot[]
 */

'use strict';

const store = require('./store');

// ============================================================
// 数据模型
// ============================================================

/** @typedef {{ id: string, text: string, role: string, category: string }} TestQuestion */
/** @typedef {{ id: string, label: string, timestamp: string, results: SnapshotResult[] }} Snapshot */
/** @typedef {{ questionIndex: number, decomposed: object, retrievedChunks: object[], aiAnswer: string, serviceHitRate: number, transferRate: number }} SnapshotResult */

function emptyData() {
  return { version: 1, updatedAt: null, questions: [], snapshots: [] };
}

function readData() {
  const v = store.read('snapshot-compare', emptyData());
  if (!v || !Array.isArray(v.questions)) return emptyData();
  if (!Array.isArray(v.snapshots)) v.snapshots = [];
  return v;
}

function writeData(data) {
  data.version = 1;
  data.updatedAt = new Date().toISOString();
  return store.write('snapshot-compare', data);
}

/** 生成随机 ID */
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// 功能 1：测试问题集维护
// ============================================================

/**
 * 列出所有测试问题。
 * @returns {TestQuestion[]}
 */
function listQuestions() {
  const data = readData();
  return data.questions;
}

/**
 * 新增一个测试问题。
 * @param {{ text: string, role: string, category: string }} input
 * @returns {TestQuestion}
 */
function addQuestion(input) {
  const data = readData();
  const q = {
    id: genId('q'),
    text: input.text,
    role: input.role || 'cs',
    category: input.category || '通用',
    createdAt: new Date().toISOString(),
  };
  data.questions.push(q);
  writeData(data);
  return q;
}

/**
 * 更新一个测试问题。
 * @param {string} id
 * @param {{ text?: string, role?: string, category?: string }} patch
 * @returns {TestQuestion|null}
 */
function updateQuestion(id, patch) {
  const data = readData();
  const idx = data.questions.findIndex((q) => q.id === id);
  if (idx === -1) return null;
  const updated = { ...data.questions[idx], ...patch, id: data.questions[idx].id };
  data.questions[idx] = updated;
  writeData(data);
  return updated;
}

/**
 * 删除一个测试问题。
 * @param {string} id
 * @returns {boolean}
 */
function removeQuestion(id) {
  const data = readData();
  const before = data.questions.length;
  data.questions = data.questions.filter((q) => q.id !== id);
  if (data.questions.length === before) return false;
  writeData(data);
  return true;
}

// ============================================================
// 功能 2-3：生成快照 A / B
// ============================================================

/**
 * 生成一张快照。
 *
 * @param {'A'|'B'} label  快照标签
 * @param {Array<{questionIndex: number, decomposed: object, retrievedChunks: object[], aiAnswer: string, serviceHitRate: number, transferRate: number}>} results
 * @returns {Snapshot}
 */
function generateSnapshot(label, results) {
  const data = readData();
  const snapshot = {
    id: genId('snap'),
    label,
    timestamp: new Date().toISOString(),
    results: results.map((r) => ({
      questionIndex: r.questionIndex,
      questionText: data.questions[r.questionIndex]
        ? data.questions[r.questionIndex].text
        : '(未知问题)',
      decomposed: r.decomposed ? {
        originalTokens: r.decomposed.originalTokens || [],
        filteredTokens: r.decomposed.filteredTokens || [],
        normalizedTokens: r.decomposed.normalizedTokens || [],
      } : null,
      retrievedChunks: (r.retrievedChunks || []).map((c) => ({
        id: c.id,
        content: c.content,
        score: c.score,
      })),
      aiAnswer: r.aiAnswer || '',
      serviceHitRate: typeof r.serviceHitRate === 'number' ? r.serviceHitRate : 0,
      transferRate: typeof r.transferRate === 'number' ? r.transferRate : 0,
    })),
  };
  data.snapshots.push(snapshot);
  writeData(data);
  return snapshot;
}

/**
 * 列出所有快照。
 * @returns {Array<{id: string, label: string, timestamp: string, resultCount: number}>}
 */
function listSnapshots() {
  const data = readData();
  return data.snapshots.map((s) => ({
    id: s.id,
    label: s.label,
    timestamp: s.timestamp,
    resultCount: s.results ? s.results.length : 0,
  }));
}

/**
 * 删除一张快照。
 * @param {string} id
 * @returns {boolean}
 */
function removeSnapshot(id) {
  const data = readData();
  const before = data.snapshots.length;
  data.snapshots = data.snapshots.filter((s) => s.id !== id);
  if (data.snapshots.length === before) return false;
  writeData(data);
  return true;
}

// ============================================================
// 功能 4：快照 A/B 并排对比
// ============================================================

/**
 * 按 label 找快照。
 * @param {string} label
 * @returns {Snapshot|null}
 */
function findSnapshotByLabel(label) {
  const data = readData();
  return data.snapshots.find((s) => s.label === label) || null;
}

/**
 * 对比两张快照。
 *
 * @param {string} labelA  快照 A 标签
 * @param {string} labelB  快照 B 标签
 * @returns {{
 *   snapshotALabel: string,
 *   snapshotBLabel: string,
 *   snapshotATimestamp: string,
 *   snapshotBTimestamp: string,
 *   diffs: Array<{
 *     questionIndex: number,
 *     questionText: string,
 *     retrievalChanged: boolean,
 *     retrievalDiff: { added: object[], removed: object[], scoreChanges: object[] }|null,
 *     answerChanged: boolean,
 *     answerDiff: { oldAnswer: string, newAnswer: string }|null,
 *     metricsChanged: boolean,
 *     metricsDiff: { serviceHitRate: { old: number, new: number, delta: number }, transferRate: { old: number, new: number, delta: number } }|null,
 *     conclusion: 'improved'|'worsened'|'unchanged',
 *   }>,
 *   summary: { improved: number, worsened: number, unchanged: number },
 * }}
 */
function compareSnapshots(labelA, labelB) {
  const snapA = findSnapshotByLabel(labelA);
  if (!snapA) throw new Error(`快照 ${labelA} 不存在`);
  const snapB = findSnapshotByLabel(labelB);
  if (!snapB) throw new Error(`快照 ${labelB} 不存在`);

  // 按 questionIndex 对齐
  const resultsA = snapA.results || [];
  const resultsB = snapB.results || [];
  const allIndices = new Set([
    ...resultsA.map((r) => r.questionIndex),
    ...resultsB.map((r) => r.questionIndex),
  ]);

  const diffs = [];
  for (const idx of [...allIndices].sort((a, b) => a - b)) {
    const rA = resultsA.find((r) => r.questionIndex === idx);
    const rB = resultsB.find((r) => r.questionIndex === idx);

    if (!rA || !rB) {
      // 仅出现在一张快照中
      diffs.push({
        questionIndex: idx,
        questionText: (rA || rB).questionText || '(未知)',
        retrievalChanged: true,
        retrievalDiff: null,
        answerChanged: true,
        answerDiff: {
          oldAnswer: rA ? rA.aiAnswer : '',
          newAnswer: rB ? rB.aiAnswer : '',
        },
        metricsChanged: true,
        metricsDiff: null,
        conclusion: 'changed',
      });
      continue;
    }

    // 召回差异
    const chunksA = rA.retrievedChunks || [];
    const chunksB = rB.retrievedChunks || [];
    const idsA = new Set(chunksA.map((c) => c.id));
    const idsB = new Set(chunksB.map((c) => c.id));
    const added = chunksB.filter((c) => !idsA.has(c.id));
    const removed = chunksA.filter((c) => !idsB.has(c.id));

    // 共有的 chunk 的分数变化
    const commonIds = [...idsA].filter((id) => idsB.has(id));
    const scoreChanges = commonIds.map((id) => {
      const cA = chunksA.find((c) => c.id === id);
      const cB = chunksB.find((c) => c.id === id);
      return {
        id,
        oldScore: cA ? cA.score : 0,
        newScore: cB ? cB.score : 0,
        delta: (cB ? cB.score : 0) - (cA ? cA.score : 0),
      };
    });

    const retrievalChanged = added.length > 0 || removed.length > 0 || scoreChanges.some((s) => s.delta !== 0);

    // 回答差异
    const answerChanged = rA.aiAnswer !== rB.aiAnswer;

    // 指标差异
    const hitRateChanged = rA.serviceHitRate !== rB.serviceHitRate || rA.transferRate !== rB.transferRate;
    const metricsChanged = hitRateChanged;

    // 结论
    let conclusion = 'unchanged';
    if (retrievalChanged || answerChanged || metricsChanged) {
      // 判断是否变好：命中率升高且转人工率降低，或召回增多
      const hitBetter = rB.serviceHitRate > rA.serviceHitRate;
      const transferBetter = rB.transferRate < rA.transferRate;
      const recallBetter = added.length > removed.length;
      const improvedCount = [hitBetter, transferBetter, recallBetter].filter(Boolean).length;
      const worsenedCount = [rB.serviceHitRate < rA.serviceHitRate, rB.transferRate > rA.transferRate, removed.length > added.length].filter(Boolean).length;
      if (improvedCount > worsenedCount) conclusion = 'improved';
      else if (worsenedCount > improvedCount) conclusion = 'worsened';
      else conclusion = 'unchanged';
    }

    diffs.push({
      questionIndex: idx,
      questionText: rA.questionText || rB.questionText || '(未知)',
      retrievalChanged,
      retrievalDiff: (retrievalChanged || added.length > 0 || removed.length > 0) ? {
        added,
        removed,
        scoreChanges: scoreChanges.filter((s) => s.delta !== 0),
      } : null,
      answerChanged,
      answerDiff: answerChanged ? {
        oldAnswer: rA.aiAnswer,
        newAnswer: rB.aiAnswer,
      } : null,
      metricsChanged,
      metricsDiff: metricsChanged ? {
        serviceHitRate: {
          old: rA.serviceHitRate,
          new: rB.serviceHitRate,
          delta: +(rB.serviceHitRate - rA.serviceHitRate).toFixed(4),
        },
        transferRate: {
          old: rA.transferRate,
          new: rB.transferRate,
          delta: +(rB.transferRate - rA.transferRate).toFixed(4),
        },
      } : null,
      conclusion,
    });
  }

  // 综合摘要
  const summary = {
    improved: diffs.filter((d) => d.conclusion === 'improved').length,
    worsened: diffs.filter((d) => d.conclusion === 'worsened').length,
    unchanged: diffs.filter((d) => d.conclusion === 'unchanged').length,
  };

  return {
    snapshotALabel: labelA,
    snapshotBLabel: labelB,
    snapshotATimestamp: snapA.timestamp,
    snapshotBTimestamp: snapB.timestamp,
    diffs,
    summary,
  };
}

module.exports = {
  listQuestions,
  addQuestion,
  updateQuestion,
  removeQuestion,
  generateSnapshot,
  listSnapshots,
  removeSnapshot,
  compareSnapshots,
  findSnapshotByLabel,
};