/**
 * 逐层溯源与影响预览
 *
 * 四层模型拆开之后，"这句答案是从哪来的"和"删了它会影响什么"
 * 才第一次变成可以算出来的东西：
 *
 *   traceUp    向量 → 片段 → 标准化版本 → 原始文档（AI 答案的出处）
 *   traceDown  原始文档 → 版本 → 片段 → 向量（改一处影响到哪）
 *   breadcrumb 任意层的完整路径，直接给前端做面包屑
 *   impactOf   危险操作前的影响预览："将影响 37 个片段，其中 12 个被引用 45 次"
 *
 * 依据：docs/技术方案-四层模型.md 第 6 节
 *
 * 关于引用统计：数据来自第 14 步的检索快照表 retrieval_snapshots。
 * 第 8 步这张表还不存在，所以必须**优雅降级** —— 返回 0 并在 warnings 里说明，
 * 绝不能因为表不存在就抛错。影响预览是危险操作前的最后一道提示，
 * 它自己崩掉的后果比统计不准严重得多。
 */

const fs = require('fs');
const store = require('./store');
const kl = require('./knowledge-layers');

const { LAYERS } = kl;
const SNAPSHOT_TABLE = 'retrieval_snapshots';
// 需求文档第八章示例「过去 7 天被引用 45 次」—— 改默认值要同步改 docs/需求文档.md
const DEFAULT_RECENT_DAYS = 7;
const ACTIONS = ['reprocess', 'delete', 'archive'];

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

function assertLayer(layer) {
  if (!Object.values(LAYERS).includes(layer)) throw fail(`未知的层: ${layer}`, 400);
  return layer;
}

/** 按层取一条记录 */
function get(layer, id) {
  switch (assertLayer(layer)) {
    case LAYERS.RAW: return kl.getRaw(id);
    case LAYERS.STD: return kl.getStd(id);
    case LAYERS.CHUNK: return kl.getChunk(id);
    case LAYERS.VECTOR: return kl.listAll(LAYERS.VECTOR).find((v) => v.id === id) || null;
    default: return null;
  }
}

// ============================================================
// 1. 向上 / 向下一层
// ============================================================

/**
 * 向上追溯一层。raw 已是顶层 → null；记录或上层不存在（断链）也返回 null。
 * @returns {{layer, record}|null}
 */
function traceUp(layer, id) {
  const record = get(layer, id);
  if (!record) return null;

  switch (layer) {
    case LAYERS.RAW:
      return null;
    case LAYERS.STD: {
      const raw = kl.getRaw(record.rawId);
      return raw ? { layer: LAYERS.RAW, record: raw } : null;
    }
    case LAYERS.CHUNK: {
      const std = kl.getStd(record.stdId);
      return std ? { layer: LAYERS.STD, record: std } : null;
    }
    case LAYERS.VECTOR: {
      const chunk = kl.getChunk(record.chunkId);
      return chunk ? { layer: LAYERS.CHUNK, record: chunk } : null;
    }
    default:
      return null;
  }
}

/**
 * 向下展开一层。vector 已是最底层 → records 为空。
 * @returns {{layer, records}}
 */
function traceDown(layer, id) {
  const record = get(layer, id);
  if (!record) return { layer: null, records: [] };

  switch (layer) {
    case LAYERS.RAW:
      return { layer: LAYERS.STD, records: kl.listStdByRaw(id) };
    case LAYERS.STD:
      return { layer: LAYERS.CHUNK, records: kl.listChunksByStd(id) };
    case LAYERS.CHUNK:
      return { layer: LAYERS.VECTOR, records: kl.listVectorsByChunk(id) };
    case LAYERS.VECTOR:
      return { layer: null, records: [] };
    default:
      return { layer: null, records: [] };
  }
}

// ============================================================
// 2. 面包屑
// ============================================================

/** 一层记录的人类可读标签（前端面包屑直接用） */
function labelOf(layer, record) {
  switch (layer) {
    case LAYERS.RAW:
      return record.title || record.fileName || record.id;
    case LAYERS.STD:
      return `加工版本 v${record.procVersion}${record.isCurrent ? '（生效中）' : ''}`;
    case LAYERS.CHUNK:
      return `片段 #${record.seq}${record.heading ? ` ${record.heading}` : ''}`;
    case LAYERS.VECTOR:
      return `向量 ${record.model}${record.isCurrent ? '（生效中）' : ''}`;
    default:
      return record.id;
  }
}

/**
 * 完整面包屑，从 raw 一路到当前层。
 * 记录不存在或中途断链返回 []（断链的路径不如不给，免得前端画出半截）。
 * @returns {Array<{layer, id, label}>}
 */
function breadcrumb(layer, id) {
  const record = get(layer, id);
  if (!record) return [];

  const chain = [{ layer, id: record.id, label: labelOf(layer, record) }];
  let curLayer = layer;
  let curId = record.id;
  // 最多 3 跳（vector → chunk → std → raw），加个上限防脏数据成环
  for (let i = 0; i < 3; i++) {
    const up = traceUp(curLayer, curId);
    if (!up) break;
    chain.unshift({ layer: up.layer, id: up.record.id, label: labelOf(up.layer, up.record) });
    curLayer = up.layer;
    curId = up.record.id;
  }
  // 断链检查：非 raw 起点的路径必须以 raw 开头
  if (chain[0].layer !== LAYERS.RAW) return [];
  return chain;
}

// ============================================================
// 3. 完整链条
// ============================================================

/**
 * 给定任意层任意 id，返回它所在的整条链。
 * 上游是单条记录（唯一确定），下游是数组（可能多条）。
 * @returns {{raw, std, chunk, vector}} 各字段可能为 null / 单条 / 数组
 */
function fullChain(layer, id) {
  const empty = { raw: null, std: null, chunk: null, vector: null };
  const record = get(layer, id);
  if (!record) return empty;

  switch (layer) {
    case LAYERS.RAW: {
      const stds = kl.listStdByRaw(id);
      const chunks = [];
      for (const s of stds) chunks.push(...kl.listChunksByStd(s.id));
      const vectors = [];
      for (const c of chunks) vectors.push(...kl.listVectorsByChunk(c.id));
      return { raw: record, std: stds, chunk: chunks, vector: vectors };
    }
    case LAYERS.STD: {
      const chunks = kl.listChunksByStd(id);
      const vectors = [];
      for (const c of chunks) vectors.push(...kl.listVectorsByChunk(c.id));
      return { raw: kl.getRaw(record.rawId), std: record, chunk: chunks, vector: vectors };
    }
    case LAYERS.CHUNK: {
      const std = kl.getStd(record.stdId);
      return {
        raw: std ? kl.getRaw(std.rawId) : kl.getRaw(record.rawId),
        std,
        chunk: record,
        vector: kl.listVectorsByChunk(id),
      };
    }
    case LAYERS.VECTOR: {
      const chunk = kl.getChunk(record.chunkId);
      const std = chunk ? kl.getStd(chunk.stdId) : null;
      return {
        raw: std ? kl.getRaw(std.rawId) : null,
        std,
        chunk,
        vector: record,
      };
    }
    default:
      return empty;
  }
}

// ============================================================
// 4. 影响预览
// ============================================================

/**
 * 读检索快照表统计引用情况 —— 表不存在或为空就降级，不抛错。
 *
 * 必须先 existsSync 再 read：直接 store.read() 会把 fallback 写进缓存，
 * 之后分不清"表不存在"和"表是空的"。
 *
 * 快照结构（第 14 步产出，本步只做兼容读取）：
 *   { id, at, chunkIds: ['chk_001', ...] }
 *   也接受 { citedChunkIds: [...] } 或 { citations: [{ chunkId }] }
 *
 * 引用次数定义：被 affected 命中的快照行数 = 1 次引用，
 * 同一行内重复出现的 chunkId 只算一次。
 */
function countCitations(chunkIds, recentDays) {
  const result = { citedChunkCount: 0, citationCount: 0, available: false };
  const affected = new Set(chunkIds);
  const fp = store.filePath(SNAPSHOT_TABLE);
  if (!fs.existsSync(fp)) return result;

  let rows;
  try {
    rows = store.read(SNAPSHOT_TABLE, []);
  } catch (_) {
    // 表读不出来（格式坏了）也按"统计不可用"处理，不能连带把预览搞崩
    return result;
  }
  // 表存在但空 / 不是数组 → 也算统计不可用（给用户清楚提示）
  if (!Array.isArray(rows) || rows.length === 0) return result;
  result.available = true;

  const since = Date.now() - recentDays * 24 * 60 * 60 * 1000;
  const cited = new Set();
  let total = 0;

  for (const row of rows) {
    if (!row) continue;
    const at = row.at || row.createdAt || row.ts;
    if (at && new Date(at).getTime() < since) continue;

    // 行内去重 —— 同一行里同一 chunkId 重复不算多次；
    // 但一行里多个不同 chunkId 命中各算 1 次（一条问题同时引用了 3 个片段就算 3 次引用）。
    const ids = new Set();
    if (Array.isArray(row.chunkIds)) for (const c of row.chunkIds) if (c) ids.add(c);
    if (Array.isArray(row.citedChunkIds)) for (const c of row.citedChunkIds) if (c) ids.add(c);
    if (Array.isArray(row.citations)) {
      for (const c of row.citations) if (c && c.chunkId) ids.add(c.chunkId);
    }
    let rowHit = 0;
    for (const cid of ids) {
      if (affected.has(cid)) {
        rowHit += 1;
        cited.add(cid);
      }
    }
    total += rowHit;
  }

  result.citedChunkCount = cited.size;
  result.citationCount = total;
  return result;
}

/** 算出某个动作会波及的三层记录 */
function affectedScope(action, layer, record) {
  let stds = [];
  let chunks = [];
  let vectors = [];

  switch (layer) {
    case LAYERS.RAW:
      // 重新加工只产生新版本，波及面是"当前生效的那一版"；
      // 删除 / 归档才是整个原始文档的全部版本
      stds = action === 'reprocess'
        ? [record.currentStdId ? kl.getStd(record.currentStdId) : null].filter(Boolean)
        : kl.listStdByRaw(record.id);
      for (const s of stds) chunks.push(...kl.listChunksByStd(s.id));
      break;
    case LAYERS.STD:
      stds = [record];
      chunks = kl.listChunksByStd(record.id);
      break;
    case LAYERS.CHUNK:
      chunks = [record];
      break;
    case LAYERS.VECTOR:
      vectors = [record];
      return { stds, chunks, vectors };
    default:
      break;
  }
  for (const c of chunks) vectors.push(...kl.listVectorsByChunk(c.id));
  return { stds, chunks, vectors };
}

/**
 * 影响预览。危险操作前必须调用。
 *
 * @param {string} action 'reprocess' | 'delete' | 'archive'
 * @param {string} layer  'raw' | 'std' | 'chunk' | 'vector'
 * @param {string} id
 * @param {Object} [opts] { recentDays }
 * @returns {{action, targetLayer, targetId, destructive, stdCount, chunkCount,
 *            vectorCount, citedChunkCount, citationCount, recentDays, warnings}}
 */
function impactOf(action, layer, id, opts) {
  if (!ACTIONS.includes(action)) {
    throw fail(`未知的操作: ${action}（只支持 ${ACTIONS.join(' / ')}）`, 400);
  }
  assertLayer(layer);
  const record = get(layer, id);
  if (!record) throw fail('目标记录不存在', 404);

  // recentDays 必须是正数。传 0/负数/非数字/不传 → 显式拒绝或回落到默认值，
  // 不允许把窗口甩到未来（→ 统计恒为 0）也不允许静默变默认值（→ 调试时困惑）。
  let recentDays = DEFAULT_RECENT_DAYS;
  if (opts && opts.recentDays !== undefined) {
    const n = Number(opts.recentDays);
    if (!Number.isFinite(n) || n <= 0) {
      throw fail(`recentDays 必须是正数（收到: ${opts.recentDays}）`, 400);
    }
    recentDays = n;
  }
  const { stds, chunks, vectors } = affectedScope(action, layer, record);
  // 重新加工是"新建版本"，不销毁数据；删除与归档都会让内容退出检索且不可逆
  const destructive = action !== 'reprocess';

  const citation = countCitations(chunks.map((c) => c.id), recentDays);
  const warnings = [];

  if (action === 'delete') {
    warnings.push('删除不可撤销：该记录及其下游各层会一并消失');
  }
  if (action === 'archive') {
    warnings.push('归档是终态：归档后不能再改回已发布，只能重新加工出新版本');
  }
  if (action === 'reprocess') {
    warnings.push('重新加工会新建一个草稿版本，当前生效版本在新版本发布后自动归档');
  }

  const liveVectors = vectors.filter((v) => v.isCurrent && kl.RETRIEVABLE.includes(v.status));
  if (destructive && liveVectors.length > 0) {
    warnings.push(`本次操作会让 ${liveVectors.length} 份向量立即退出检索，相关问题可能查不到答案`);
  } else if (destructive && vectors.length > 0) {
    warnings.push(`涉及 ${vectors.length} 份向量，其中没有正在参与检索的`);
  }

  if (!citation.available) {
    // 表不存在 OR 表是空数组 —— 两种情况都说"统计暂不可用"
    warnings.push('引用统计数据暂不可用（检索快照表尚未建立或为空，第 14 步后生效）');
  } else if (citation.citedChunkCount > 0) {
    warnings.push(`其中 ${citation.citedChunkCount} 个片段在近 ${recentDays} 天内被 AI 引用过 ${citation.citationCount} 次`);
  }

  return {
    action,
    targetLayer: layer,
    targetId: id,
    destructive,
    stdCount: stds.length,
    chunkCount: chunks.length,
    vectorCount: vectors.length,
    citedChunkCount: citation.citedChunkCount,
    citationCount: citation.citationCount,
    recentDays,
    warnings,
  };
}

// ============================================================
// 5. 孤儿检测
// ============================================================

/** 孤儿检测：指向不存在上层的记录（复用 knowledge-layers 的实现，保持判据一致） */
function findOrphans() {
  return kl.findOrphans();
}

module.exports = {
  traceUp,
  traceDown,
  breadcrumb,
  fullChain,
  impactOf,
  findOrphans,
};
