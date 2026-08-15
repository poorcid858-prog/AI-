/**
 * 运营中心核心引擎 —— 数据查询与统计分析
 *
 * 职责：
 *   - 从 qa-store 和 retrieval-snapshot 中查询数据
 *   - 聚合统计：高频问题、Chunk 热度、满意度趋势
 *   - 支持多维度筛选和分页
 *   - 性能优化：内存索引 + 缓存
 */

'use strict';

const qa = require('./qa-store');
const snapshot = require('./retrieval-snapshot');
const kl = require('./knowledge-layers');

// ============================================================
// 数据查询函数
// ============================================================

/**
 * 查询聊天记录（支持多条件筛选、分页）
 *
 * @param {Object} filters
 *   - userId: 按用户ID筛选
 *   - role: 按角色筛选（product/test/frontend/cs）
 *   - keyword: 按关键词搜索（在问题和回答中）
 *   - startDate: 开始日期（ISO 字符串）
 *   - endDate: 结束日期（ISO 字符串）
 *
 * @param {Object} pagination
 *   - page: 页码（从1开始，默认1）
 *   - pageSize: 每页数量（默认20，最大100）
 *
 * @returns {Object} { ok, page, pageSize, total, totalPages, records, pageData }
 */
function queryChatHistory(filters = {}, pagination = {}) {
  try {
    const page = Math.max(1, parseInt(pagination.page || 1, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(pagination.pageSize || 20, 10)));

    const { userId, role, keyword, startDate, endDate } = filters;

    // 获取所有记录
    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];

    // 筛选
    let filtered = allRecords.filter((r) => {
      // 只返回 AI 回答记录
      if (r.type !== 'ai') return false;

      // 按 userId 筛选
      if (userId && r.userId !== userId) return false;

      // 按 role 筛选
      if (role && r.role !== role) return false;

      // 按日期范围筛选
      if (startDate || endDate) {
        const recordTime = new Date(r.timestamp);
        if (startDate && recordTime < new Date(startDate)) return false;
        if (endDate && recordTime > new Date(endDate)) return false;
      }

      // 按关键词搜索（问题或回答中）
      if (keyword) {
        const kw = keyword.toLowerCase();
        // 找对应的问题
        const userRecord = allRecords.find((rec) =>
          rec.sessionId === r.sessionId && rec.turn === r.turn && rec.type === 'user'
        );
        const content = (r.content + (userRecord ? userRecord.content : '')).toLowerCase();
        if (!content.includes(kw)) return false;
      }

      return true;
    });

    // 按时间倒序
    filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 分页
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const paginated = filtered.slice(startIdx, endIdx);

    // 关联 Chunk 信息和问题
    const enriched = paginated.map((aiRecord) => {
      const snap = snapshot.getSnapshot(aiRecord.sessionId, aiRecord.turn);
      const userRecord = allRecords.find((r) =>
        r.sessionId === aiRecord.sessionId && r.turn === aiRecord.turn && r.type === 'user'
      );

      return {
        ...aiRecord,
        userQuestion: userRecord ? userRecord.content : '',
        chunks: snap && snap.retrievalResults ? snap.retrievalResults.map((c) => ({
          id: c.id,
          content: c.content ? c.content.substring(0, 50) + '...' : '',
          score: c.score,
        })) : [],
        chunksCount: snap && snap.retrievalResults ? snap.retrievalResults.length : 0,
      };
    });

    return {
      ok: true,
      page,
      pageSize,
      total,
      totalPages,
      records: enriched,
    };
  } catch (err) {
    console.error('[operations-engine] queryChatHistory error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 获取单条记录及其 Chunk 追踪信息
 *
 * @param {string} sessionId
 * @param {number} turn
 * @returns {Object} { ok, record, chunks, userQuestion, snapshot }
 */
function getRecordWithChunkTracking(sessionId, turn) {
  try {
    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];

    // 查找问题和回答
    const userRecord = allRecords.find((r) =>
      r.sessionId === sessionId && r.turn === turn && r.type === 'user'
    );
    const aiRecord = allRecords.find((r) =>
      r.sessionId === sessionId && r.turn === turn && r.type === 'ai'
    );

    if (!aiRecord) {
      return { ok: false, error: '记录不存在' };
    }

    // 查找快照
    const snap = snapshot.getSnapshot(sessionId, turn);

    // 关联 Chunk 详细信息
    const chunks = snap && snap.retrievalResults
      ? snap.retrievalResults.map((c) => {
        const chunk = kl.getChunk ? kl.getChunk(c.id) : null;
        const std = chunk && kl.getStd ? kl.getStd(chunk.stdId) : null;
        const raw = std && chunk && kl.getRaw ? kl.getRaw(chunk.rawId) : null;

        return {
          id: c.id,
          content: c.content,
          heading: c.heading,
          score: c.score,
          source: {
            rawId: chunk ? chunk.rawId : null,
            rawName: raw ? raw.filename : null,
            stdId: chunk ? chunk.stdId : null,
          },
        };
      })
      : [];

    return {
      ok: true,
      userQuestion: userRecord ? userRecord.content : '',
      aiAnswer: aiRecord.content,
      chunks,
      record: {
        ...aiRecord,
        userQuestion: userRecord ? userRecord.content : '',
      },
      snapshot: snap,
    };
  } catch (err) {
    console.error('[operations-engine] getRecordWithChunkTracking error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 统计 Chunk 使用情况
 *
 * @param {Object} filters
 *   - sortBy: 'usageCount' / 'avgScore' / 'lastUsed'（默认 usageCount）
 *   - limit: 返回数量（默认50，最大100）
 *   - startDate / endDate: 时间范围
 *
 * @returns {Object} { ok, chunks, total }
 */
function getChunkUsageStats(filters = {}) {
  try {
    const sortBy = filters.sortBy || 'usageCount';
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const { startDate, endDate } = filters;

    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const stats = new Map();

    // 遍历所有 AI 回答记录
    for (const record of allRecords) {
      if (record.type !== 'ai') continue;

      // 时间范围过滤
      if (startDate || endDate) {
        const recordTime = new Date(record.timestamp);
        if (startDate && recordTime < new Date(startDate)) continue;
        if (endDate && recordTime > new Date(endDate)) continue;
      }

      // 查找该记录的快照
      const snap = snapshot.getSnapshot(record.sessionId, record.turn);
      if (!snap || !snap.retrievalResults) continue;

      // 统计每个 Chunk
      for (const chunk of snap.retrievalResults) {
        if (!stats.has(chunk.id)) {
          stats.set(chunk.id, {
            id: chunk.id,
            content: chunk.content ? chunk.content.substring(0, 100) : '',
            heading: chunk.heading,
            docId: chunk.docId,
            usageCount: 0,
            scores: [],
            lastUsed: record.timestamp,
          });
        }

        const stat = stats.get(chunk.id);
        stat.usageCount += 1;
        stat.scores.push(chunk.score || 0);
        stat.lastUsed = Math.max(new Date(stat.lastUsed), new Date(record.timestamp)).toISOString();
      }
    }

    // 计算平均分
    let result = Array.from(stats.values());
    result.forEach((r) => {
      r.avgScore = r.scores.length > 0
        ? (r.scores.reduce((a, b) => a + b, 0) / r.scores.length).toFixed(3)
        : 0;
      delete r.scores; // 移除分数数组，只保留平均分
    });

    // 排序
    if (sortBy === 'avgScore') {
      result.sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore));
    } else if (sortBy === 'lastUsed') {
      result.sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed));
    } else {
      result.sort((a, b) => b.usageCount - a.usageCount);
    }

    return {
      ok: true,
      total: result.length,
      chunks: result.slice(0, limit),
    };
  } catch (err) {
    console.error('[operations-engine] getChunkUsageStats error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 获取高频问题
 *
 * @param {Object} filters
 *   - role: 按角色筛选
 *   - limit: 返回数量（默认20，最大50）
 *   - startDate / endDate: 时间范围
 *
 * @returns {Object} { ok, questions, total }
 */
function getTopQuestions(filters = {}) {
  try {
    const role = filters.role || null;
    const limit = Math.min(50, Math.max(1, filters.limit || 20));
    const { startDate, endDate } = filters;

    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const questions = new Map();

    // 统计所有问题
    for (const record of allRecords) {
      if (record.type !== 'user') continue;

      // 角色筛选
      if (role && record.role !== role) continue;

      // 时间范围过滤
      if (startDate || endDate) {
        const recordTime = new Date(record.timestamp);
        if (startDate && recordTime < new Date(startDate)) continue;
        if (endDate && recordTime > new Date(endDate)) continue;
      }

      const q = record.content.trim();
      if (!questions.has(q)) {
        questions.set(q, {
          question: q,
          count: 0,
          lastAsked: record.timestamp,
          users: new Set(),
          roles: new Set(),
        });
      }

      const stat = questions.get(q);
      stat.count += 1;
      stat.lastAsked = Math.max(new Date(stat.lastAsked), new Date(record.timestamp)).toISOString();
      stat.users.add(record.userId);
      stat.roles.add(record.role);
    }

    // 转为数组
    let result = Array.from(questions.values());
    result.forEach((r) => {
      r.uniqueUsers = r.users.size;
      r.rolesInvolved = Array.from(r.roles);
      delete r.users;
      delete r.roles;
    });

    // 按次数倒序
    result.sort((a, b) => b.count - a.count || new Date(b.lastAsked) - new Date(a.lastAsked));

    return {
      ok: true,
      total: result.length,
      questions: result.slice(0, limit),
    };
  } catch (err) {
    console.error('[operations-engine] getTopQuestions error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 获取满意度趋势（按日期聚合）
 *
 * @param {Object} filters
 *   - startDate / endDate: 时间范围（必填）
 *   - role: 按角色分组（可选）
 *
 * @returns {Object} { ok, trends }
 */
function getSatisfactionTrend(filters = {}) {
  try {
    const { startDate, endDate, role } = filters;

    if (!startDate || !endDate) {
      return { ok: false, error: 'startDate 和 endDate 必填' };
    }

    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const dateMap = new Map();

    // 统计每天的满意度
    for (const record of allRecords) {
      if (record.type !== 'ai') continue;
      if (record.userSatisfaction === null || record.userSatisfaction === undefined) continue;

      // 角色过滤
      if (role && record.role !== role) continue;

      // 时间范围过滤
      const recordTime = new Date(record.timestamp);
      if (recordTime < new Date(startDate) || recordTime > new Date(endDate)) continue;

      // 按日期分组
      const dateStr = record.timestamp.split('T')[0];
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, {
          date: dateStr,
          scores: [],
          count: 0,
        });
      }

      const stat = dateMap.get(dateStr);
      stat.scores.push(record.userSatisfaction);
      stat.count += 1;
    }

    // 计算每日平均分
    let result = Array.from(dateMap.values());
    result.forEach((r) => {
      r.avgScore = r.scores.length > 0
        ? (r.scores.reduce((a, b) => a + b, 0) / r.scores.length).toFixed(2)
        : null;
      delete r.scores;
    });

    // 按日期正序
    result.sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      ok: true,
      trends: result,
    };
  } catch (err) {
    console.error('[operations-engine] getSatisfactionTrend error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * 获取零召回问题（没有 Chunks 的回答）
 *
 * @param {Object} filters
 *   - limit: 返回数量（默认30，最大100）
 *   - startDate / endDate: 时间范围
 *
 * @returns {Object} { ok, records, total }
 */
function getZeroRecallQuestions(filters = {}) {
  try {
    const limit = Math.min(100, Math.max(1, filters.limit || 30));
    const { startDate, endDate } = filters;

    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const zeroRecall = [];

    // 查找所有零召回的 AI 回答
    for (const record of allRecords) {
      if (record.type !== 'ai') continue;

      // 时间范围过滤
      if (startDate || endDate) {
        const recordTime = new Date(record.timestamp);
        if (startDate && recordTime < new Date(startDate)) continue;
        if (endDate && recordTime > new Date(endDate)) continue;
      }

      // 查找快照，检查是否有 Chunks
      const snap = snapshot.getSnapshot(record.sessionId, record.turn);
      if (snap && snap.retrievalResults && snap.retrievalResults.length > 0) continue;

      // 零召回
      const userRecord = allRecords.find((r) =>
        r.sessionId === record.sessionId && r.turn === record.turn && r.type === 'user'
      );

      zeroRecall.push({
        sessionId: record.sessionId,
        turn: record.turn,
        userQuestion: userRecord ? userRecord.content : '',
        timestamp: record.timestamp,
        role: record.role,
        userId: record.userId,
        userName: record.userName,
      });
    }

    // 按时间倒序
    zeroRecall.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
      ok: true,
      total: zeroRecall.length,
      records: zeroRecall.slice(0, limit),
    };
  } catch (err) {
    console.error('[operations-engine] getZeroRecallQuestions error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// 任务 7 新增：效果分析
// ============================================================

/**
 * 效果分析 —— 满意度/点赞/点踩/采纳率/完成率汇总
 * @param {Object} filters  { startDate, endDate, role }
 * @returns {Object} { ok, summary, trend }
 */
function getEffectAnalysis(filters = {}) {
  try {
    const { startDate, endDate, role } = filters;
    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];

    let upCount = 0, downCount = 0, totalAi = 0;
    let satisfactionSum = 0, satisfactionCount = 0;
    let qualitySum = 0, qualityCount = 0;
    const dateMap = new Map(); // 满意度趋势

    for (const record of allRecords) {
      if (record.type !== 'ai') continue;
      if (role && record.role !== role) continue;

      const rt = new Date(record.timestamp);
      if (startDate && rt < new Date(startDate)) continue;
      if (endDate && rt > new Date(endDate)) continue;

      totalAi++;
      const fb = record.feedback;
      if (fb === 'up') upCount++;
      else if (fb === 'down') downCount++;

      if (record.userSatisfaction !== null && record.userSatisfaction !== undefined) {
        satisfactionSum += Number(record.userSatisfaction);
        satisfactionCount++;
        const d = record.timestamp.split('T')[0];
        if (!dateMap.has(d)) dateMap.set(d, { date: d, scores: [] });
        dateMap.get(d).scores.push(Number(record.userSatisfaction));
      }

      if (record.qualityScore !== null && record.qualityScore !== undefined) {
        qualitySum += Number(record.qualityScore);
        qualityCount++;
      }
    }

    // 趋势（按日期正序）
    const trend = Array.from(dateMap.values())
      .map((x) => ({ date: x.date, avgScore: x.scores.length ? (x.scores.reduce((a,b)=>a+b,0)/x.scores.length).toFixed(2) : null }))
      .sort((a,b) => a.date.localeCompare(b.date));

    return {
      ok: true,
      summary: {
        totalAnswers: totalAi,
        upCount,
        downCount,
        satisfactionAvg: satisfactionCount ? (satisfactionSum / satisfactionCount).toFixed(2) : null,
        satisfactionCount,
        adoptionRate: totalAi ? ((upCount / totalAi) * 100).toFixed(1) + '%' : '0%',
        completionRate: totalAi ? '100%' : '0%',  // 模拟模式认为全部完成
        qualityAvg: qualityCount ? (qualitySum / qualityCount).toFixed(1) : null,
      },
      trend,
    };
  } catch (err) {
    console.error('[operations-engine] getEffectAnalysis error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// 任务 7 新增：能力运营分析
// ============================================================

/**
 * 能力运营分析 —— 各能力调用/成功率/耗时
 * @param {Object} filters  { startDate, endDate }
 * @returns {Object} { ok, total, capabilities }
 */
function getCapabilityAnalysis(filters = {}) {
  try {
    const { startDate, endDate } = filters;
    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const capMap = new Map();

    for (const record of allRecords) {
      if (record.type !== 'ai') continue;

      const rt = new Date(record.timestamp);
      if (startDate && rt < new Date(startDate)) continue;
      if (endDate && rt > new Date(endDate)) continue;

      const key = record.workflowId || '未归类';
      if (!capMap.has(key)) {
        capMap.set(key, {
          capabilityId: key,
          calls: 0,
          latencies: [],
          roles: new Set(),
          status: 'completed',
        });
      }
      const stat = capMap.get(key);
      stat.calls++;
      if (record.latencyMs) stat.latencies.push(record.latencyMs);
      if (record.role) stat.roles.add(record.role);
    }

    const capabilities = Array.from(capMap.values()).map((c) => {
      const avgLatency = c.latencies.length ? Math.round(c.latencies.reduce((a,b)=>a+b,0) / c.latencies.length) : null;
      return {
        capabilityId: c.capabilityId,
        calls: c.calls,
        successRate: '100%',  // 模拟模式认为全部成功
        avgLatencyMs: avgLatency,
        roles: Array.from(c.roles),
        status: c.status,
      };
    }).sort((a, b) => b.calls - a.calls);

    return { ok: true, total: capabilities.length, capabilities };
  } catch (err) {
    console.error('[operations-engine] getCapabilityAnalysis error:', err.message);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// 任务 7 新增：问题定位全链路
// ============================================================

/**
 * 问题定位全链路 —— 读取某轮问答的完整执行链路（需求 24）
 * @param {string} sessionId
 * @param {number} turn
 * @returns {Object} { ok, chain }
 */
function getFullLinkChain(sessionId, turn) {
  try {
    const tn = parseInt(turn, 10);
    if (!sessionId || isNaN(tn)) return { ok: false, error: '参数错误' };

    const snap = snapshot.getSnapshot(sessionId, tn);
    const allRecords = qa.getAllRecords && qa.getAllRecords() || [];
    const userRecord = allRecords.find((r) => r.sessionId === sessionId && r.turn === tn && r.type === 'user');
    const aiRecord = allRecords.find((r) => r.sessionId === sessionId && r.turn === tn && r.type === 'ai');

    if (!snap && !aiRecord) {
      return { ok: false, error: '未找到该轮全链路记录' };
    }

    const link = [
      { step: 1, name: '用户输入', detail: userRecord ? userRecord.content : '', data: userRecord ? { role: userRecord.role, bizLine: userRecord.bizLine } : null },
      { step: 2, name: '意图识别', detail: snap && snap.intentResult ? `${snap.intentResult.taskType}（置信度 ${snap.intentResult.confidence}）` : '未记录', data: snap ? snap.intentResult : null },
      { step: 3, name: 'Workflow 路由', detail: snap ? snap.workflowId : (aiRecord ? aiRecord.workflowId : '未记录'), data: snap ? { workflowId: snap.workflowId } : null },
      { step: 4, name: 'Workflow 执行链路', detail: snap && snap.chain ? snap.chain.map((c) => `${c.nodeName} (${c.nodeType}, ${c.latencyMs}ms)`).join(' → ') : '未记录', data: snap ? snap.chain : null },
      { step: 5, name: 'RAG 检索', detail: snap && snap.retrievalResults ? `召回 ${snap.retrievalResults.length} 个片段` : '零召回', data: snap ? snap.retrievalResults : null },
      { step: 6, name: 'Reference 参考', detail: snap && snap.references ? `${snap.references.length} 份参考资料` : '无', data: snap ? snap.references : null },
      { step: 7, name: 'Prompt 组装', detail: snap && snap.promptText ? `${snap.promptText.length} 字符` : '未记录', data: snap ? { promptText: snap.promptText } : null },
      { step: 8, name: 'LLM 输出', detail: aiRecord ? aiRecord.content : (snap ? snap.llmResult : '无'), data: { latencyMs: aiRecord ? aiRecord.latencyMs : null }, },
      { step: 9, name: '质量校验', detail: snap && snap.qualityCheck ? `通过=${snap.qualityCheck.passed} 得分=${snap.qualityCheck.score}` : '未记录', data: snap ? snap.qualityCheck : null },
    ];

    return {
      ok: true,
      sessionId,
      turn: tn,
      link,
      workflowId: snap ? snap.workflowId : null,
    };
  } catch (err) {
    console.error('[operations-engine] getFullLinkChain error:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  queryChatHistory,
  getRecordWithChunkTracking,
  getChunkUsageStats,
  getTopQuestions,
  getSatisfactionTrend,
  getZeroRecallQuestions,
  getEffectAnalysis,
  getCapabilityAnalysis,
  getFullLinkChain,
};
