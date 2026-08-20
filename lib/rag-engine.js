/**
 * RAG 引擎 —— 权限过滤 + 向量检索
 *
 * 这是整个 RAG 系统的"安全关卡"。第 6 步的 vector-store 不知道用户是谁，
 * 所有 chunk 平等对待；本模块在检索前先按"业务线 + 密级 + 状态"过滤，
 * 再交给 vector-store 算相似度。
 *
 * 设计要点：
 *   - permissionFilter 是纯函数，鉴权信息来自 lib/auth（已读 lib/vector-store）
 *   - 优先用 auth.accessibleBizLines / maxSecurityLevel 复用现有权限模型，
 *     不在此处重复实现业务线/密级判定
 *   - admin / reviewer / readonly(guest) 三类用户绕过业务线+密级限制
 *     —— demo 用，与 lib/auth 中"客服/访客只能看 public"的角色约束是
 *     两套：业务模型用 auth，UI demo 用旁路
 *   - chunk.status 字段在阶段 7a 后从 'approved' 切换为 'published'（I4）：
 *     loadApprovedIndex 从四层表读 vector 状态，RAG 索引里只放 PUBLISHED 的向量
 *   - retrieve 内部**必定**跑一遍 permissionFilter，不依赖调用方先过滤
 *     —— 调用方过滤是优化，引擎过滤才是安全
 */

const config = require('../config');
const auth = require('./auth');
const vectorStore = require('./vector-store');
const kl = require('./knowledge-layers');

/**
 * 权限过滤 —— RAG 系统的安全关卡
 * @param {Array<chunk>} chunks  候选 chunk
 * @param {Object}      user    当前用户
 * @returns {Array<chunk>}      过滤后允许该用户看的 chunks
 *
 * 规则（严格执行）：
 *   1. status 过滤：chunk 若带 status 字段，必须 === 'published'
 *      （阶段 7b 改动 —— 数据源从 documents.json 切到四层表后，索引项 status
 *      从 'approved' 变为 'published'，判定值同步切换）
 *   2. 业务线旁路：admin / reviewer / readonly（guest demo）→ 全放行
 *   3. 密级过滤：config.securityLevels[chunk.securityLevel] <= user.maxSecurityLevel
 *   4. 业务线过滤：chunk.bizLine === 'all' 或 chunk.bizLine ∈ user.accessibleBizLines
 */
function permissionFilter(chunks, user) {
  if (!user) return [];
  if (!Array.isArray(chunks)) return [];

  const lines = auth.accessibleBizLines(user);
  const maxSec = auth.maxSecurityLevel(user);
  // 旁路：管理员 / 审核员 / 只读 demo 账号 —— 一律放行
  const bypass = user.role === 'admin' || user.role === 'reviewer' || user.readonly === true;

  return chunks.filter((c) => {
    // 1. 状态：未审核 / 驳回 / 复审中 / 草稿 / 已审待发 不进 RAG 库；缺字段视为合法（兼容旧数据）。
    //    阶段 7b：数据源已切到四层表，索引里 chunk 的 status 来自 std —— RAG 入库只收 PUBLISHED，
    //    所以判定值从 'approved' 改为 'published'。这两条必须配套 commit。
    if (c.status !== undefined && c.status !== 'published') return false;

    // 2. 旁路
    if (bypass) return true;

    // 3. 密级：chunk 密级数值 > 用户密级上限 → 拒绝
    const cSec = config.securityLevels[c.securityLevel];
    if (typeof cSec !== 'number') return false; // 缺/非法密级直接拒
    if (cSec > maxSec) return false;

    // 4. 业务线：'all' 跨线；其他必须命中
    if (c.bizLine === 'all') return true;
    if (lines.includes(c.bizLine)) return true;
    return false;
  });
}

/**
 * RAG 检索主入口 —— 权限在此强制生效
 *
 * @param {Object} user    用户
 * @param {string} query   查询
 * @param {Object} index   vector-store.buildIndex 的产物（可以是全库索引）
 * @param {number} [topK]  最终召回条数（默认 config.rag.rerankTopK）
 *
 * 安全设计：本函数**自己**跑一遍 permissionFilter，不假设调用方已经过滤。
 * 理由与项目一贯原则一致 —— "调用方过滤是优化，引擎过滤才是安全"。
 * 第 9 步的工作流会传一个全库索引进来，若这里不拦，所有用户都能搜到全部知识。
 *
 * 为什么可以在建好索引之后再过滤向量：
 *   vocab 与 idfMap 是全库共享的，qVec 和每个 v.vec 都在同一个词表空间里，
 *   所以剔掉一部分 v 不影响剩下向量的 cosine 计算 ——
 *   这正是真实向量数据库做「元数据预过滤」的方式。
 *   附带好处：idf 用全库统计更稳定，不会因为用户可见范围小而失真。
 */
function retrieve(user, query, index, topK) {
  if (!index || !Array.isArray(index.vectors) || index.vectors.length === 0) return [];

  // 权限关卡：按 业务线 × 密级 × 状态 剔除该用户不可见的向量
  const allowed = permissionFilter(index.vectors, user);
  if (allowed.length === 0) return [];

  const scopedIndex = { vocab: index.vocab, idfMap: index.idfMap, vectors: allowed };
  const finalTopK = typeof topK === 'number' ? topK : config.rag.rerankTopK;
  const recall = vectorStore.search(query, scopedIndex, config.rag.recallTopK);
  return vectorStore.rerank(query, recall, finalTopK);
}

/**
 * 从四层表加载"已发布"chunk 集合，构建 RAG 索引。
 *
 * 数据来源：lib/knowledge-layers（四层模型 raw → std → chunk → vector）。
 * 阶段 7a 之前是读 data/documents.json，按旧 doc.status === 'approved' 过滤；
 * 切换后改为读四层表，RAG 索引的 status 语义变为 'published'。
 *
 * 状态决策（计划决策 6）：只入 PUBLISHED，不收 NEED_REVIEW。
 *   旧 "approved" 严格语义下，APPROVED ≠ 发布；同理新四层里
 *   APPROVED 是"审过"，PUBLISHED 才是"对外可用"。NEED_REVIEW（过期待复审）
 *   仍可检索是另一套产品决策，不在本阶段范围内。
 *   所以这里显式再过滤一遍 v.status === 'published'，不依赖 listRetrievableVectors
 *   的 RETRIEVABLE 集合（它包含 NEED_REVIEW）。
 *
 * M6 更新（需求第 36 节 - RAG 兼容）：
 *   RAG 正常检索只使用：审核通过 + 处理完成 + 当前有效 + 已上线的数据。
 *   下线数据即使保存在数据库，也不得参与正常检索。
 *   改为从 DocumentVersion 三元状态过滤：
 *     review_status === approved
 *     processing_status === success
 *     online_status === online
 *
 * @returns {{index, chunks, byDoc, byFingerprint}}
 *   index           vector-store 索引（全库，检索时由 retrieve 按用户过滤）
 *   chunks          已发布 chunk 数组（继承 std 的 bizLine / securityLevel / status，
 *                   同时带 docId 指向 rawId 兼容旧 shape）
 *   byDoc           rawId → chunk[] 映射
 *   byFingerprint   指纹 → chunk 映射（反馈入库去重）
 */
function loadApprovedIndex() {
  // M6: 从 DocumentVersion 三元状态过滤（需求第 36 节）
  // 只有审核通过 + 处理完成 + 已上线的数据才参与检索
  const allVersions = kl.listVersionsByReviewStatus('approved');
  const approvedVersionIds = new Set(
    allVersions
      .filter((v) => v.processing_status === 'success' && v.online_status === 'online')
      .map((v) => v.version_id)
  );

  // 从四层表获取向量，但只保留 approvedVersionIds 中版本的向量
  const vectors = kl.listRetrievableVectors().filter((v) => {
    // 优先检查 versionId（M3 新模型）
    if (v.versionId && approvedVersionIds.has(v.versionId)) {
      return true;
    }
    // 兼容旧模型：检查 chunk 的 status 是否为 published
    return v.status === kl.STD_STATUS.PUBLISHED;
  });

  const chunks = [];
  const byDoc = {};
  const byFingerprint = new Map();

  for (const v of vectors) {
    const chunk = kl.getChunk(v.chunkId);
    if (!chunk) continue;
    const std = kl.getStd(v.stdId);
    if (!std) continue;

    // 形状兼容：旧 shape 用 doc.bizLine / doc.securityLevel / doc.id / doc.status
    // 新 shape 用 std.bizLine / std.securityLevel / chunk.rawId / std.status
    // 字段（chunk 上其实已继承 I4），这里再显式覆盖以防万一。
    const enriched = Object.assign({}, chunk, {
      bizLine: std.bizLine,
      securityLevel: std.securityLevel,
      status: std.status,
      // docId 在旧 shape 是 doc.id；新 shape 里 doc 的等价物是 raw
      docId: chunk.rawId,
      // M6: 带上 versionId 用于后续过滤
      versionId: v.versionId || null,
    });
    chunks.push(enriched);

    if (!byDoc[chunk.rawId]) byDoc[chunk.rawId] = [];
    byDoc[chunk.rawId].push(enriched);

    if (chunk.fingerprint && !byFingerprint.has(chunk.fingerprint)) {
      byFingerprint.set(chunk.fingerprint, enriched);
    }
  }

  const index = vectorStore.buildIndex(chunks);
  return { index, chunks, byDoc, byFingerprint };
}

module.exports = {
  permissionFilter,
  retrieve,
  loadApprovedIndex,
};
