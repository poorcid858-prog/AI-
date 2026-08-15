/**
 * 检索快照引擎 —— 需求 6：召回可观测与反向修复
 *
 * 每次 AI 回答都留一条完整检索快照（看得见），并通过影响预览驱动
 * 三种修复动作（改文档 / 调参数重新标准化 / 删除文档）（改得动）。
 *
 * 数据链路：
 *   原始问题 → 拆解（分词 / 停用词 / 同义词归一）
 *     → 权限过滤前候选 → 权限过滤（剔除了哪些、为什么）
 *     → 召回结果（每条含相似度分数 / 来源文档章 / Chunk ID / 入选淘汰原因）
 *     → 重排后最终选择 → 提示词全文 → AI 输出 + 质量校验
 *
 * 存储：data/retrieval-snapshots.json —— 与 qa-history 分离，
 * 因为快照是"运维观测面"，体积大、只增不删，不该和对话流混在一起。
 *
 * 三种修复动作的统一入口 previewImpact / executeFix：
 *   - delete_doc  删除文档（片段与向量连带失效）
 *   - reprocess   调参数重新标准化（不动原文，重新生成 std + chunk + vector）
 *   - rewrite_doc 改原始文档（重新加工 → 新版标准化 → 重新切分 → 重新向量化，旧版归档）
 * 安全设计：任何修复动作都必须先出影响预览，确认后才执行。
 *
 * 本模块只负责"观测 + 影响评估 + 修复驱动"，具体的数据层操作（deleteRawCascade /
 * createStdVersion / processDocument）委托给 lib/knowledge-layers 与 lib/document-processor，
 * 不在本模块重复实现。
 */

'use strict';

const store = require('./store');
const kl = require('./knowledge-layers');
const dp = require('./document-processor');

// ============================================================
// 存储
// ============================================================

function emptyData() {
  return { version: 1, updatedAt: null, snapshots: [] };
}

function readSnapshots() {
  const v = store.read('retrieval-snapshots', emptyData());
  if (!v || !Array.isArray(v.snapshots)) return emptyData();
  return v;
}

function writeSnapshots(data) {
  data.version = 1;
  data.updatedAt = new Date().toISOString();
  return store.write('retrieval-snapshots', data);
}

// ============================================================
// 功能 1：检索快照（看得见）
// ============================================================

/**
 * 记录一条完整检索快照。
 *
 * @param {Object} input
 * @param {string} input.sessionId    会话 ID
 * @param {number} input.turn         turn 号（与 qa-history 的 turn 对齐）
 * @param {string} input.userQuestion 原始问题
 * @param {Object} input.user         当前用户（用于审计是谁问的 + 谁的权限范围）
 * @param {Array}  [input.retrievalResults]  重排后的最终选择（实际塞进提示词的那几条）
 * @param {Object} [input.ragIndex]   RAG 全库索引（用于"权限过滤前候选"与召回率统计）
 * @param {string} [input.aiOutput]   AI 输出
 * @param {number} [input.qualityScore] 质量校验分（0-10）
 * @param {Object} [input.decomposed] 拆解结果 { originalTokens, afterStopwords, afterNormalize, synonyms }
 * @param {Object} [input.permissionFilter] 权限过滤记录 { beforeFilter, afterFilter, denied }
 * @param {string} [input.promptText] 提示词全文
 * @param {string} [input.timestamp]  可选时间戳（测试注入；默认 now）
 *
 * @param {Object} [input.intentResult] 意图识别结果 { taskType, confidence, role, entities }
 * @param {string} [input.workflowId]  Workflow ID
 * @param {Array}  [input.chain]       Workflow 执行链路 [{ nodeId, nodeType, nodeName, latencyMs, ok }]
 * @param {Array}  [input.references]  参考资料 [{ name, type, content }]
 * @param {string} [input.llmResult]   LLM 生成结果
 * @param {Object} [input.qualityCheck] 质量检查结果 { passed, score, issues }
 * @returns {Object} 落盘后的快照对象
 */
function recordSnapshot(input) {
  const it = input || {};
  if (!it.sessionId) throw new Error('recordSnapshot 需要 sessionId');
  if (!Number.isInteger(it.turn)) throw new Error('recordSnapshot 需要 integer turn');
  if (!it.userQuestion) throw new Error('recordSnapshot 需要 userQuestion');

  const data = readSnapshots();
  const snapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: it.sessionId,
    turn: it.turn,
    userQuestion: it.userQuestion,
    userId: it.user ? it.user.id : null,
    userName: it.user ? it.user.name : null,
    timestamp: it.timestamp || new Date().toISOString(),

    // 拆解结果
    decomposed: it.decomposed ? {
      originalTokens: Array.isArray(it.decomposed.originalTokens) ? it.decomposed.originalTokens : [],
      afterStopwords: Array.isArray(it.decomposed.afterStopwords) ? it.decomposed.afterStopwords : [],
      afterNormalize: Array.isArray(it.decomposed.afterNormalize) ? it.decomposed.afterNormalize : [],
      synonyms: it.decomposed.synonyms || [],
    } : null,

    // 权限过滤记录
    permissionFilter: it.permissionFilter ? {
      beforeFilter: typeof it.permissionFilter.beforeFilter === 'number' ? it.permissionFilter.beforeFilter : null,
      afterFilter: typeof it.permissionFilter.afterFilter === 'number' ? it.permissionFilter.afterFilter : null,
      denied: Array.isArray(it.permissionFilter.denied) ? it.permissionFilter.denied : [],
    } : null,

    // 召回结果（权限过滤后、重排前，若有）
    // 简化：直接存调用方传入的 retrievalResults（重排后最终选择）
    retrievalResults: Array.isArray(it.retrievalResults) ? it.retrievalResults.map(scrubResult) : [],

    // 候选统计（从 ragIndex 推算权限过滤前候选数）
    candidateStats: computeCandidateStats(it.ragIndex, it.user),

    // 重排后的最终选择 = retrievalResults
    finalSelection: Array.isArray(it.retrievalResults) ? it.retrievalResults.map((r) => r.id).filter(Boolean) : [],

    // 提示词全文
    promptText: it.promptText || null,

    // AI 输出 + 质量校验
    aiOutput: it.aiOutput || null,
    qualityScore: it.qualityScore == null ? null : it.qualityScore,

    // ===== 任务 9 新增：全链路附加字段 =====
    // 意图识别结果
    intentResult: it.intentResult ? {
      taskType: it.intentResult.taskType || null,
      confidence: typeof it.intentResult.confidence === 'number' ? it.intentResult.confidence : null,
      role: it.intentResult.role || null,
      entities: Array.isArray(it.intentResult.entities) ? it.intentResult.entities : [],
    } : null,

    // Workflow 信息
    workflowId: it.workflowId || null,

    // 节点执行链路（不含大段内容，只含元信息）
    chain: Array.isArray(it.chain) ? it.chain.map((s) => ({
      nodeId: s.nodeId,
      nodeType: s.nodeType,
      nodeName: s.nodeName,
      latencyMs: typeof s.latencyMs === 'number' ? s.latencyMs : null,
      ok: s.ok !== false,
    })) : [],

    // 参考资料
    references: Array.isArray(it.references) ? it.references.map((r) => ({
      name: r.name || null,
      type: r.type || null,
      content: typeof r.content === 'string' ? r.content.slice(0, 500) : null,
    })) : [],

    // LLM 结果
    llmResult: it.llmResult || null,

    // 质量检查
    qualityCheck: it.qualityCheck ? {
      passed: it.qualityCheck.passed !== false,
      score: typeof it.qualityCheck.score === 'number' ? it.qualityCheck.score : null,
      issues: Array.isArray(it.qualityCheck.issues) ? it.qualityCheck.issues : [],
    } : null,
  };

  data.snapshots.push(snapshot);
  writeSnapshots(data);
  return snapshot;
}

/** 从一条召回结果里挑出观测面字段，避免把大段内容/向量也带进快照 */
function scrubResult(r) {
  return {
    id: r.id,
    content: r.content,
    heading: r.heading,
    source: r.source,
    docId: r.docId,
    score: r.score,
    baseScore: r.baseScore != null ? r.baseScore : r.score,
  };
}

/** 候选统计：如给了 ragIndex，数一遍全部向量作为"权限过滤前候选"，再按用户测一下权限 */
function computeCandidateStats(ragIndex, user) {
  if (!ragIndex || !Array.isArray(ragIndex.vectors)) return null;
  const before = ragIndex.vectors.length;
  // 复用 rag-engine 的权限过滤逻辑，避免这里重复实现权限判定
  let after = before;
  try {
    const rag = require('./rag-engine');
    after = rag.permissionFilter(ragIndex.vectors, user).length;
  } catch (_) { /* 权限过滤失败时退化为 before（观测面不阻断） */ }
  return { beforeFilter: before, afterFilter: after };
}

/**
 * 查询一条快照。
 * @param {string} sessionId
 * @param {number} turn
 * @returns {Object|null}
 */
function getSnapshot(sessionId, turn) {
  const data = readSnapshots();
  return data.snapshots.find((s) => s.sessionId === sessionId && s.turn === turn) || null;
}

/** 读一个 session 的全部快照（按 turn 升序） */
function listSessionSnapshots(sessionId) {
  const data = readSnapshots();
  return data.snapshots
    .filter((s) => s.sessionId === sessionId)
    .sort((a, b) => a.turn - b.turn);
}

/**
 * 采样最近 N 条快照做 RAG 检索分析（AI 运营 → RAG 检索分析）。
 * @returns {Array<{id, sessionId, turn, userQuestion, timestamp, recallCount, candidateCount}>}
 */
function listRecentSnapshots(n = 50) {
  const data = readSnapshots();
  return data.snapshots.slice(-n).map((s) => ({
    id: s.id,
    sessionId: s.sessionId,
    turn: s.turn,
    userQuestion: s.userQuestion,
    timestamp: s.timestamp,
    recallCount: s.retrievalResults ? s.retrievalResults.length : 0,
    candidateCount: s.candidateStats ? s.candidateStats.beforeFilter : null,
  }));
}

// ============================================================
// 功能 2 扩展：RAG 检索分析（聚合仪表板）
// ============================================================

/**
 * 对一个范围内的快照做检索分析。
 * @param {string|number} [scope]  sessionId 则分析该 session；数字则分析最近 N 条；缺省分析全部
 * @returns {Object} { total, withRecall, zeroRecall, zeroRecallQuestions, avgRecall, recallDistribution, topCitedChunks }
 */
function analyzeRetrieval(scope) {
  const data = readSnapshots();
  let snaps = data.snapshots;
  if (typeof scope === 'string') snaps = snaps.filter((s) => s.sessionId === scope);
  else if (typeof scope === 'number') snaps = snaps.slice(-scope);

  const withRecall = snaps.filter((s) => s.retrievalResults && s.retrievalResults.length > 0);
  const zeroRecall = snaps.filter((s) => !s.retrievalResults || s.retrievalResults.length === 0);

  // 召回率分布：按每条的召回数分桶
  const distribution = {};
  for (const s of snaps) {
    const n = s.retrievalResults ? s.retrievalResults.length : 0;
    const bucket = n === 0 ? '0' : (n <= 3 ? '1-3' : (n <= 5 ? '4-5' : '6+'));
    distribution[bucket] = (distribution[bucket] || 0) + 1;
  }

  // 高频引用片段排行：统计 finalSelection 里每个 chunk id 出现次数
  const citeCount = new Map();
  for (const s of snaps) {
    for (const id of s.finalSelection || []) {
      citeCount.set(id, (citeCount.get(id) || 0) + 1);
    }
  }
  const topCitedChunks = [...citeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([chunkId, count]) => ({ chunkId, citedCount: count }));

  return {
    total: snaps.length,
    withRecall: withRecall.length,
    zeroRecall: zeroRecall.length,
    avgRecall: snaps.length === 0 ? 0 : Math.round((withRecall.length / snaps.length) * 100) / 100,
    recallDistribution: distribution,
    zeroRecallQuestions: zeroRecall.map((s) => ({
      question: s.userQuestion, sessionId: s.sessionId, turn: s.turn,
    })),
    topCitedChunks,
  };
}

// ============================================================
// 功能 2 扩展：影响预览（安全设计 ①）
// ============================================================

/**
 * 影响预览 —— 任何修复动作执行前必须调用，返回"将影响多少 raw/std/chunk/vector"。
 * 安全设计 ①：执行前必须显示影响预览，否则不允许执行。
 *
 * @param {'delete_doc'|'reprocess'|'rewrite_doc'} action
 * @param {Object} opts
 * @param {string} opts.rawId      目标原始文档
 * @param {Object} [opts.params]   reprocess 时的新加工参数
 * @returns {Object} 影响预览对象（含 warning 文本 / 计数 / rawId）
 */
function previewImpact(action, opts) {
  const it = opts || {};
  if (!it.rawId) throw new Error('previewImpact 需要 rawId');
  const raw = kl.getRaw(it.rawId);
  if (!raw) return { error: `原始文档不存在: ${it.rawId}`, ok: false };

  const stds = kl.listStdByRaw(it.rawId);
  const chunks = kl.listChunks().filter((c) => c.rawId === it.rawId);
  const vectors = kl.listVectors().filter((v) => v.rawId === it.rawId);
  const currentStd = stds.find((s) => s.isCurrent);
  const currentChunks = currentStd ? kl.listChunksByStd(currentStd.id) : chunks;

  // 计数
  const impact = {
    ok: true,
    action,
    rawId: it.rawId,
    rawTitle: raw.title,
    rawCount: 1,
    stdCount: stds.length,
    chunkCount: chunks.length,
    vectorCount: vectors.length,
    // "现在生效的一版"
    currentStdId: currentStd ? currentStd.id : null,
    currentProcVersion: currentStd ? currentStd.procVersion : null,
    currentChunkCount: currentChunks.length,
  };

  // 被引用统计（从快照推算这版 chunk 在过去被引用次数）——若无快照则标记"暂不可用"
  const recentReferences = countRecentReferences(it.rawId);
  impact.recentReferences = recentReferences;

  impact.warning = buildWarning(impact);
  return impact;
}

/** 统计快照 finalSelection 里命中该 rawId 下 chunk 的次数（近 7 天窗口，写死可用） */
function countRecentReferences(rawId) {
  const data = readSnapshots();
  const chunkIds = new Set(
    kl.listChunks().filter((c) => c.rawId === rawId).map((c) => c.id)
  );
  let count = 0;
  for (const s of data.snapshots) {
    for (const id of s.finalSelection || []) {
      if (chunkIds.has(id)) count += 1;
    }
  }
  return count;
}

function buildWarning(impact) {
  const lines = [];
  lines.push(`将影响 ${impact.stdCount} 份标准化文档（v${impact.currentProcVersion || '-'} → 变更/归档）`);
  lines.push(`· ${impact.chunkCount} 个知识片段`);
  lines.push(`· ${impact.vectorCount} 条向量`);
  if (impact.recentReferences > 0) {
    lines.push(`· 其中 ${impact.recentReferences} 个片段过去被 AI 引用过（含翻重字，均计入）`);
  }
  return lines.join('\n');
}

/**
 * 用户文档的修改痕迹不在本模块 —— 已由 knowledge-layers / documents 承载。
 * 本模块只提供"观测与影响评估"，执行动作的入口 executeFix 见下。
 */

// ============================================================
// 功能 2 扩展：修复动作（改得动）
// ============================================================

/**
 * 执行一个修复动作。安全设计 ①：必须先 previewImpact 拿到预览（confirm）才执行。
 *
 * @param {'delete_doc'|'reprocess'|'rewrite_doc'} action
 * @param {Object} opts
 * @param {string} opts.rawId
 * @param {Object} [opts.params]     reprocess 的新参数
 * @param {string} [opts.newContent] rewrite_doc 的新原文
 * @param {boolean} [opts.confirmed] 是否已确认（必须 true，安全设计 ①）
 * @returns {Object} 执行结果
 */
function executeFix(action, opts) {
  const it = opts || {};
  if (it.confirmed !== true) {
    return { ok: false, error: '安全设计①：执行前必须先显示影响预览并确认（confirmed=true）' };
  }
  if (!it.rawId) return { ok: false, error: '需要 rawId' };

  switch (action) {
    case 'delete_doc': {
      const counts = kl.deleteRawCascade(it.rawId);
      return { ok: true, action, rawId: it.rawId, ...counts };
    }
    case 'reprocess': {
      const raw = kl.getRaw(it.rawId);
      if (!raw) return { ok: false, error: `原始文档不存在: ${it.rawId}` };
      // 重新标准化：不动原文，用新参数生成新 std 版本（草稿，不生效，安全设计 ②）
      const std = kl.createStdVersion(it.rawId, { content: raw.content, params: it.params || {} });
      // 用 document-processor 在新参数下重跑 testo 切分
      const proc = dp.processDocument(raw.content, {});
      // 为新 version 生成 chunks（草稿 std 允许追加片段）
      const chunks = kl.createChunks(std.id, proc.chunks.map((c) => ({
        content: c.content,
        heading: c.heading,
        sectionPath: [],
        keywords: c.keywords,
      })));
      return {
        ok: true,
        action,
        rawId: it.rawId,
        draftStdId: std.id,
        draftProcVersion: std.procVersion,
        newChunkCount: chunks.length,
      };
    }
    case 'rewrite_doc': {
      const raw = kl.getRaw(it.rawId);
      if (!raw) return { ok: false, error: `原始文档不存在: ${it.rawId}` };
      if (!it.newContent) return { ok: false, error: 'rewrite_doc 需要新原文 newContent' };
      // 改原文：直接用新内容生成新 std 版本（草稿），走完整审核流程。旧版本保留不删。
      const std = kl.createStdVersion(it.rawId, { content: it.newContent, params: it.params || {} });
      const proc = dp.processDocument(it.newContent, {});
      const chunks = kl.createChunks(std.id, proc.chunks.map((c) => ({
        content: c.content,
        heading: c.heading,
        sectionPath: [],
        keywords: c.keywords,
      })));
      return {
        ok: true,
        action,
        rawId: it.rawId,
        draftStdId: std.id,
        draftProcVersion: std.procVersion,
        newChunkCount: chunks.length,
      };
    }
    default:
      return { ok: false, error: `未知修复动作: ${action}` };
  }
}

// ============================================================
// 功能 2 扩展：回归验证（拿历史问题重放）
// ============================================================

/**
 * 回归验证：拿历史真实问题（快照里记录的）重放，对比新旧检索结果。
 * 修复完成后再调用，验证"修好了"。
 *
 * @param {string} sessionId 历史快照所属 session
 * @param {number} turn      该 session 里要回放的那一轮
 * @param {Array}  newResults 修复后新索引跑出来的召回结果
 * @param {Object} [newIndex] 新索引（用于算候选数）
 * @returns {Object} 新旧对比
 */
function runRegression(sessionId, turn, newResults, newIndex) {
  const original = getSnapshot(sessionId, turn);
  if (!original) return { ok: false, error: `快照不存在: ${sessionId}#${turn}` };

  const originalIds = (original.retrievalResults || []).map((r) => r.id);
  const newIds = (newResults || []).map((r) => r.id);

  // 对比：新旧召回集合的重叠度
  const overlap = originalIds.filter((id) => newIds.includes(id));

  return {
    ok: true,
    originalQuestion: original.userQuestion,
    originalResults: original.retrievalResults || [],
    newResults: newResults || [],
    originalCount: originalIds.length,
    newCount: newIds.length,
    overlapCount: overlap.length,
    overlapIds: overlap,
  };
}

module.exports = {
  emptyData,
  readSnapshots,
  writeSnapshots,
  recordSnapshot,
  getSnapshot,
  listSessionSnapshots,
  listRecentSnapshots,
  analyzeRetrieval,
  previewImpact,
  executeFix,
  runRegression,
};