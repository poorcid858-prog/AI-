/**
 * 文档管理：上传、列表、详情、审核、删除
 *
 * 状态机：
 *   pending ──审核通过──▶ approved ──删除──▶ (消失)
 *      └──审核驳回──▶ rejected ──可重新上传覆盖
 *
 * 上传时立即做预处理（processDocument），把切片数、字段写入文档记录。
 * 审核通过后，这些切片正式进入 RAG 知识库供检索（第 6 步会接 vector-store）。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('./store');
const dp = require('./document-processor');
const auth = require('./auth');
const kl = require('./knowledge-layers');

// ============================================================
// 状态机
// ============================================================

const STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const VALID_SECURITY = Object.keys(config.securityLevels);
const VALID_BIZLINE = Object.keys(config.bizLines);

// ============================================================
// 列表查询（按权限过滤）
// ============================================================

/**
 * 返回当前用户可查看的文档列表
 * - admin/reviewer 看全部
 * - 其他角色：只看自己业务线 + 自己密级上限之内的已审核文档
 */
function listForUser(user, opts = {}) {
  const all = store.read('documents', []);
  const maxSec = auth.maxSecurityLevel(user);
  const lines = auth.accessibleBizLines(user);

  return all.filter((d) => {
    // 待审核列表：审核员/管理员/访客可见（按参数控制）
    if (opts.status) {
      if (Array.isArray(opts.status) ? !opts.status.includes(d.status) : d.status !== opts.status) return false;
    }

    // 管理员/审核员看全部
    if (user.role === 'admin' || user.role === 'reviewer' || user.readonly) return true;

    // 内部岗位：业务线匹配 + 密级不超限 + 已审核
    const lineOk = d.bizLine === 'all' || lines.includes(d.bizLine);
    const secOk = config.securityLevels[d.securityLevel] <= maxSec;
    return lineOk && secOk && d.status === STATUS.APPROVED;
  });
}

// ============================================================
// 上传
// ============================================================

/**
 * 上传并预处理文档
 * @param {Object} user 上传者
 * @param {Object} input
 *   - fileName  原文件名
 *   - content   完整 Markdown 内容
 *   - bizLine   业务线（必填）
 *   - securityLevel 密级（必填）
 *   - tags      标签数组（可选）
 *   - title     标题（可选，默认从 frontmatter 取）
 */
function upload(user, input) {
  if (!auth.canWrite(user)) {
    throw Object.assign(new Error('当前角色无上传权限（仅系统管理员可上传知识）'), { status: 403 });
  }

  if (!input || !input.content) throw new Error('请提供文档内容');
  if (!input.bizLine) throw new Error('请指定业务线');
  if (!input.securityLevel) throw new Error('请指定安全分级');
  if (!VALID_BIZLINE.includes(input.bizLine)) throw new Error(`业务线非法: ${input.bizLine}`);
  if (!VALID_SECURITY.includes(input.securityLevel)) throw new Error(`安全分级非法: ${input.securityLevel}`);

  // 预处理
  const result = dp.processDocument(input.content, { source: input.fileName });

  // tags 数量与长度限制（防御性，避免恶意上传塞超长标签）
  if (input.tags) {
    if (!Array.isArray(input.tags)) {
      throw Object.assign(new Error('标签必须是数组'), { status: 400 });
    }
    if (input.tags.length > 20) {
      throw Object.assign(new Error('标签数量过多（最多 20 个）'), { status: 400 });
    }
    for (const t of input.tags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 30) {
        throw Object.assign(new Error('每个标签必须为 1-30 字符'), { status: 400 });
      }
    }
  }

  const doc = {
    id: store.nextId('documents', 'doc'),
    title: input.title || result.meta.title || input.fileName || '未命名文档',
    fileName: input.fileName || null,
    bizLine: input.bizLine,
    securityLevel: input.securityLevel,
    tags: input.tags || result.meta.tags || [],
    status: STATUS.PENDING,
    uploadedBy: user.username,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    content: input.content,
    chunks: result.chunks,           // 预处理后的切片（暂存，审核通过后入向量库）
    chunkCount: result.chunks.length,
    docId: result.meta.docId || null,
    stats: result.stats,
    createdAt: new Date().toISOString(),
  };
  store.push('documents', doc);
  return doc;
}

// ============================================================
// 审核
// ============================================================

function review(user, docId, decision, note) {
  if (!auth.canReview(user)) {
    throw Object.assign(new Error('当前角色无审核权限（仅审核专员可审核）'), { status: 403 });
  }
  if (![STATUS.APPROVED, STATUS.REJECTED].includes(decision)) {
    throw new Error(`审核决定非法: ${decision}`);
  }
  // 审核备注长度限制
  if (note && (typeof note !== 'string' || note.length > 500)) {
    throw Object.assign(new Error('审核备注过长（最多 500 字符）'), { status: 400 });
  }
  const doc = store.read('documents', []).find((d) => d.id === docId);
  if (!doc) throw Object.assign(new Error('文档不存在'), { status: 404 });
  if (doc.status !== STATUS.PENDING) {
    throw Object.assign(new Error(`文档已审核（${doc.status}），不可重复审核`), { status: 409 });
  }

  const updated = store.update('documents', docId, {
    status: decision,
    reviewedBy: user.username,
    reviewedAt: new Date().toISOString(),
    reviewNote: note || null,
  });
  return updated;
}

// ============================================================
// 删除
// ============================================================

function remove(user, docId) {
  if (!auth.canWrite(user)) {
    throw Object.assign(new Error('当前角色无删除权限'), { status: 403 });
  }
  return store.remove('documents', docId);
}

// ============================================================
// 详情（脱敏：仅管理员/审核员可见原文与切片，其他角色只见元信息）
// ============================================================

function publicView(doc, user) {
  if (!doc) return null;
  const isAdmin = user && (user.role === 'admin' || user.role === 'reviewer');
  // 管理员/审核员：返回完整文档（含原文 + 切片），用于审核判断
  if (isAdmin) return doc;
  // 其他角色：剥离 content 与 chunks，避免"按段落切好的原文"通过另一字段名泄漏
  const { content, chunks, ...safe } = doc;
  return safe;
}

// ============================================================
// 阶段 1：getDocumentView 纯函数（聚合四层，投影出对外视图）
// ============================================================

/**
 * 把四层知识模型（raw + std + chunks）聚合为单一对外视图。
 *
 * 设计要点：
 *   - 纯函数：仅依赖入参与 kl 状态，无副作用，不写盘。
 *   - raw 不存在 → 返回 null。
 *   - 有 currentStdId 取它，否则 fallback 到该 raw 下最新 std；都拿不到时视为草稿。
 *   - chunks 投影出去只留 id / seq / heading / keywords / content —— 权限判据
 *     （bizLine / securityLevel / status）一律不带出，避免调用方误读做权限判断
 *     （调用方过滤是优化，引擎过滤才是安全，调用方若要过滤应看 view 顶层字段）。
 *
 * 状态映射：
 *   - lifecycleStatus 直接是 std.status
 *   - status 是给旧 3 值消费者（前端 / 老 upload/review 链路）用的兼容层，
 *     published / need_review / approved → approved；其余 → pending / rejected。
 */
/** 8 态 → 旧 3 值 兼容层。任何 typo 都会让前端/老链路拿错状态，
 *  且类型系统抓不到（都是字符串），所以测试要逐状态锁住。 */
const LIFECYCLE_TO_OLD = {
  published: 'approved',
  need_review: 'approved',
  approved: 'pending',
  pending: 'pending',
  draft: 'pending',
  qc_failed: 'pending',
  rejected: 'rejected',
  archived: 'rejected',
};

function getDocumentView(rawId) {
  const raw = kl.getRaw(rawId);
  if (!raw) return null;

  // 优先用 currentStdId（已发布的生效版本），否则 fallback 到同 raw 下最新 std（一般就是草稿）
  const std = raw.currentStdId
    ? kl.getStd(raw.currentStdId)
    : (kl.listStdByRaw(rawId)[0] || null);

  // 没 std：视为草稿
  if (!std) {
    return {
      id: raw.id,
      title: raw.title,
      fileName: raw.fileName,
      bizLine: raw.bizLine,
      securityLevel: raw.securityLevel,
      tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],
      uploadedBy: raw.uploadedBy,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      chunkCount: 0,
      status: 'pending',
      lifecycleStatus: 'draft',
      chunks: [],
    };
  }

  const chunks = kl.listChunksByStd(std.id);
  return {
    id: raw.id,
    title: raw.title,
    fileName: raw.fileName,
    bizLine: raw.bizLine,
    securityLevel: raw.securityLevel,
    tags: Array.isArray(raw.tags) ? raw.tags.slice() : [],
    uploadedBy: raw.uploadedBy,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    chunkCount: chunks.length,
    status: LIFECYCLE_TO_OLD[std.status] || 'pending',
    lifecycleStatus: std.status,
    chunks: chunks.map((c) => ({
      id: c.id,
      seq: c.seq,
      heading: c.heading,
      keywords: Array.isArray(c.keywords) ? c.keywords.slice() : [],
      content: c.content,
    })),
  };
}

module.exports = {
  STATUS,
  listForUser,
  upload,
  review,
  remove,
  publicView,
  getDocumentView,
};
