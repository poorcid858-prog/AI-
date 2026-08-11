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
 *   - chunk.status 字段可选：第 5 步的 document-processor 切片不带 status，
 *     permissionFilter 不强制要求；loadApprovedIndex 在加载时按文档 status
 *     给 chunk 补 status 字段
 *   - retrieve 内部**必定**跑一遍 permissionFilter，不依赖调用方先过滤
 *     —— 调用方过滤是优化，引擎过滤才是安全
 */

const config = require('../config');
const auth = require('./auth');
const store = require('./store');
const vectorStore = require('./vector-store');

/**
 * 权限过滤 —— RAG 系统的安全关卡
 * @param {Array<chunk>} chunks  候选 chunk
 * @param {Object}      user    当前用户
 * @returns {Array<chunk>}      过滤后允许该用户看的 chunks
 *
 * 规则（严格执行）：
 *   1. status 过滤：chunk 若带 status 字段，必须 === 'approved'
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
    // 1. 状态：未审核 / 驳回 不进 RAG 库；缺字段视为合法（兼容旧数据）
    if (c.status !== undefined && c.status !== 'approved') return false;

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
 * 从已审核文档加载全部 chunk，构建索引
 *
 * 数据来源是第 5 步上传时写入的 data/documents.json（经 store 读取，走缓存）。
 * 只有 status === 'approved' 的文档才进 RAG 库 —— 这是审核环节的意义所在。
 *
 * @returns {{index, chunks, byDoc, byFingerprint}}
 *   index           vector-store 索引（全库，检索时由 retrieve 按用户过滤）
 *   chunks          已审核 chunk 数组（注入 docId / bizLine / securityLevel / status）
 *   byDoc           docId → chunk[] 映射
 *   byFingerprint   指纹 → chunk 映射（第 12 步反馈入库时用于去重）
 */
function loadApprovedIndex() {
  const docs = store.read('documents', []);

  const chunks = [];
  const byDoc = {};
  const byFingerprint = new Map();

  for (const doc of Array.isArray(docs) ? docs : []) {
    if (!doc || doc.status !== 'approved') continue;
    if (!Array.isArray(doc.chunks) || doc.chunks.length === 0) continue;
    byDoc[doc.id] = [];
    for (const c of doc.chunks) {
      // chunk 继承文档级的业务线与密级 —— 权限过滤依赖这两个字段
      const enriched = Object.assign({}, c, {
        bizLine: doc.bizLine,
        securityLevel: doc.securityLevel,
        docId: doc.id,
        status: doc.status,
      });
      chunks.push(enriched);
      byDoc[doc.id].push(enriched);
      if (c.fingerprint && !byFingerprint.has(c.fingerprint)) {
        byFingerprint.set(c.fingerprint, enriched);
      }
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
