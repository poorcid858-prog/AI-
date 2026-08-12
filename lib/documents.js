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
 * 返回当前用户可查看的文档视图（view）列表
 *
 * 阶段 4 切到四层：不再读 `store.read('documents')`，改为走 kl.listRaws() →
 * getDocumentView() 投影。返回的每一项都是 view 形状（id/title/.../status/
 * lifecycleStatus/chunks），与单文档详情接口保持一致。
 *
 * 权限过滤（与旧契约等价）：
 *   - admin / reviewer / readonly：看全部，不按 status / bizLine / securityLevel 过滤
 *   - 其他角色：业务线匹配 + 密级不超限 + lifecycleStatus === 'published'
 *
 * **关键安全决策（plan 阶段 1 决策 2）**：内部岗位的"已发布"判据用
 * `view.lifecycleStatus === kl.STD_STATUS.PUBLISHED`，**不**用
 * `view.status === 'approved'`。原因：LIFECYCLE_TO_OLD 把 APPROVED 也映射成
 * 'pending'，只有 PUBLISHED 映射成 'approved'。用 view.status 过滤会把
 * "审核通过但还没生效"的版本也算成"可看"——那些版本还没法被检索到，对用户不可见。
 *
 * @param {Object} user 当前用户
 * @param {Object} [opts]
 * @param {string|string[]} [opts.status] 按 view.status 过滤（兼容层 3 值：pending/approved/rejected）
 * @returns {Array<Object>} view 数组
 */
function listForUser(user, opts = {}) {
  const maxSec = auth.maxSecurityLevel(user);
  const lines = auth.accessibleBizLines(user);
  const raws = kl.listRaws();
  const isPrivileged = user.role === 'admin' || user.role === 'reviewer' || user.readonly;

  return raws
    .map((raw) => getDocumentView(raw.id))
    .filter((view) => view != null)
    .filter((view) => {
      // status 过滤（先于角色判断，admin/reviewer/readonly 也走这一道）
      if (opts.status) {
        if (Array.isArray(opts.status)) {
          if (!opts.status.includes(view.status)) return false;
        } else if (view.status !== opts.status) {
          return false;
        }
      }
      // 管理员/审核员/只读：看全部（过完 status 过滤后剩下的）
      if (isPrivileged) return true;
      // 内部岗位：业务线 + 密级 + 已发布（lifecycleStatus 判据）
      const lineOk = view.bizLine === 'all' || lines.includes(view.bizLine);
      const secOk = config.securityLevels[view.securityLevel] <= maxSec;
      return lineOk && secOk && view.lifecycleStatus === kl.STD_STATUS.PUBLISHED;
    });
}

// ============================================================
// 阶段 2：upload 切到四层链路 —— 辅助函数
// ============================================================

/**
 * 从标题/文件名/内容关键词推断 knowledgeType。
 * 旧 upload 表单不传 knowledgeType 字段，但 config 里有 6 个枚举（requirement/api/
 * test_spec/business_rule/faq/other）。前端没下拉，本步先靠关键词兜底，
 * 推断失败归 other —— 严格不抛错（用户上传体验优先）。
 */
const KT_KEYWORDS = [
  { type: 'requirement',   keys: ['PRD', '需求', 'requirement', '需求文档'] },
  { type: 'api',           keys: ['API', '接口', 'endpoint', 'swagger'] },
  { type: 'test_spec',     keys: ['测试', 'test', 'spec', '用例', 'testcase'] },
  { type: 'business_rule', keys: ['规则', 'rule', '业务规则', 'policy'] },
  { type: 'faq',           keys: ['FAQ', '常见问题', '常见', 'Q&A'] },
];
function inferKnowledgeType(input) {
  const it = input || {};
  const hay = `${it.title || ''} ${it.fileName || ''}`.toLowerCase();
  for (const { type, keys } of KT_KEYWORDS) {
    for (const k of keys) {
      if (hay.includes(k.toLowerCase())) return type;
    }
  }
  return 'other';
}

/**
 * 从文件名推断文件类型。认不出的扩展名兜底 md（与 scripts/migrate-to-layers.js 行为一致，
 * 但本模块不反向依赖 scripts/，内部保留一份）。
 */
const FILE_TYPES = ['md', 'docx', 'pdf', 'pptx', 'txt'];
function inferFileType(fileName) {
  const ext = String(path.extname(fileName || '')).replace('.', '').toLowerCase();
  return FILE_TYPES.includes(ext) ? ext : 'md';
}

/** 与 lib/knowledge-layers.js 同款 fail()，统一带 HTTP 语义的错误 */
function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

// ============================================================
// 上传
// ============================================================

/**
 * 上传并预处理文档 —— 阶段 2 切到四层链路
 *
 * 流程：
 *   1. 权限校验（auth.canWrite）
 *   2. 参数校验（content / bizLine / securityLevel / tags）
 *   3. kl.createRaw    —— 写第一层 raw_documents（status=uploaded）
 *   4. kl.markReady    —— 推进 raw.status=ready（解析完成）
 *   5. kl.createStdVersion —— 写第二层 std_documents（v1，draft，权限字段继承 raw）
 *   6. dp.processDocument 拿切片 → kl.createChunks 写第三层 chunks
 *   7. kl.setStdStatus(PENDING) —— draft → pending，并同步下游 chunks.status
 *   8. 返回 getDocumentView(rawId) —— 前端友好视图（status / lifecycleStatus / chunks）
 *
 * 阶段 2 不到第四层（vectors），那是阶段 5 的事。
 * 也不调 publishStd，所以新版本的 isCurrent 仍是 false —— 等阶段 3 改造 review() 时
 * 才把 PENDING → APPROVED → PUBLISHED 这条链补齐。
 *
 * @param {Object} user 上传者
 * @param {Object} input
 *   - fileName  原文件名
 *   - content   完整 Markdown 内容
 *   - bizLine   业务线（必填）
 *   - securityLevel 密级（必填）
 *   - tags      标签数组（可选）
 *   - title     标题（可选，默认从 fileName / 兜底"未命名文档"）
 */
function upload(user, input) {
  if (!auth.canWrite(user)) {
    throw fail('当前角色无上传权限（仅系统管理员可上传知识）', 403);
  }

  if (!input || !input.content) throw fail('请提供文档内容', 400);
  if (!input.bizLine) throw fail('请指定业务线', 400);
  if (!input.securityLevel) throw fail('请指定安全分级', 400);
  if (!VALID_BIZLINE.includes(input.bizLine)) throw fail(`业务线非法: ${input.bizLine}`, 400);
  if (!VALID_SECURITY.includes(input.securityLevel)) throw fail(`安全分级非法: ${input.securityLevel}`, 400);

  // tags 数量与长度限制（防御性，与旧实现一致的报错文案）
  if (input.tags) {
    if (!Array.isArray(input.tags)) throw fail('标签必须是数组', 400);
    if (input.tags.length > 20) throw fail('标签数量过多（最多 20 个）', 400);
    for (const t of input.tags) {
      if (typeof t !== 'string' || t.length === 0 || t.length > 30) {
        throw fail('每个标签必须为 1-30 字符', 400);
      }
    }
  }

  // 1. 原始文档进四层（raw.status=uploaded）
  const raw = kl.createRaw({
    title: input.title || input.fileName || '未命名文档',
    fileName: input.fileName || null,
    fileType: inferFileType(input.fileName),
    content: input.content,
    knowledgeType: inferKnowledgeType(input),  // 关键词推断，兜底 other，绝不抛错
    tags: input.tags || [],
    uploadedBy: user.username,
    bizLine: input.bizLine,
    securityLevel: input.securityLevel,
  });
  // 2. 解析完成标记（uploaded → ready）
  kl.markReady(raw.id);

  // 3. 标准化版本（v1，content 即原文，与旧实现保持对齐；草稿态）
  //    processLog 留一行审计记录：std 自身 id 在赋值左侧不可用，before/after 字段记 raw 侧即可
  const std = kl.createStdVersion(raw.id, {
    content: input.content,
    processLog: [{
      step: 'upload',
      action: 'createStdVersion v1（content=原文，待后续重加工）',
      before: null,
      after: raw.id,
      at: new Date().toISOString(),
    }],
  });

  // 4. 切片（用 dp.processDocument 拿 heading / keywords / fingerprint / content）
  const result = dp.processDocument(input.content, { source: input.fileName });
  const chunkInputs = (Array.isArray(result.chunks) ? result.chunks : []).map((c) => ({
    content: c && typeof c.content === 'string' ? c.content : '',
    heading: (c && c.heading) || null,
    keywords: Array.isArray(c && c.keywords) ? c.keywords : [],
    fingerprint: (c && c.fingerprint) || undefined,
  }));
  kl.createChunks(std.id, chunkInputs);

  // 5. 走合法流转：draft → pending（并同步下游 chunks.status=pending）
  kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);

  // 6. 返回前端友好视图（用 getDocumentView 是真相来源；同文件内函数，避免 module.exports 循环引用）
  return getDocumentView(raw.id);
}

// ============================================================
// 审核
// ============================================================

/**
 * 审核文档 —— 阶段 3 切到四层链路
 *
 * 流程：
 *   1. 权限校验（auth.canReview）
 *   2. decision 白名单（旧 3 值 'approved' / 'rejected'）
 *   3. note 长度校验（最多 500 字符，null/undefined/空串合法）
 *   4. kl.getRaw(docId) —— 404 if 不存在
 *   5. 取当前 std（currentStdId 优先，否则 listStdByRaw[0]）—— 409 if 无 std
 *   6. kl.setStdStatus(APPROVED/REJECTED, meta={reviewedBy, reviewNote})
 *
 * 阶段 3 边界：只走 draft→pending→approved/rejected，**不调 publishStd**，
 * 所以 std.isCurrent 保持 false；std 升级到 published 是阶段 12 重建向量
 * 那一段的事（彼时会接 PENDING→APPROVED→PUBLISHED 完整三跳）。
 *
 * @param {Object} user 审核者（需有 review 权限）
 * @param {string} docId raw 文档 id
 * @param {string} decision 'approved' | 'rejected'（旧 3 值字符串）
 * @param {string|null|undefined} [note] 审核备注（≤500 字符，可空）
 * @returns {Object} 更新后的 std 记录
 */
function review(user, docId, decision, note) {
  // 1. 权限校验
  if (!auth.canReview(user)) {
    throw fail('当前角色无审核权限（仅审核专员可审核）', 403);
  }
  // 2. decision 白名单
  if (![STATUS.APPROVED, STATUS.REJECTED].includes(decision)) {
    throw fail(`审核决定非法: ${decision}`, 400);
  }
  // 3. note 长度
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    throw fail('审核备注过长（最多 500 字符）', 400);
  }
  // 4. raw 必须存在
  const raw = kl.getRaw(docId);
  if (!raw) throw fail('文档不存在', 404);
  // 5. 当前 std（与 getDocumentView 同款 fallback：currentStdId 优先，否则 listStdByRaw[0]）
  const std = raw.currentStdId
    ? kl.getStd(raw.currentStdId)
    : (kl.listStdByRaw(docId)[0] || null);
  if (!std) throw fail('文档尚未有可审版本', 409);
  // 6. 调 setStdStatus（内部走 TRANSITIONS + 状态机，非法流转会抛 409；级联同步 chunks.status）
  const meta = {
    reviewedBy: user.username,
    reviewNote: note || null,
  };
  if (decision === STATUS.APPROVED) {
    return kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED, meta);
  }
  // decision === STATUS.REJECTED
  return kl.setStdStatus(std.id, kl.STD_STATUS.REJECTED, meta);
}

// ============================================================
// 删除
// ============================================================

/**
 * 删除一个原始文档 —— 阶段 4 切到四层
 *
 * 旧实现：直接 store.remove('documents', docId) → 只删旧扁平表的一条记录，
 *         留下孤儿（标准版/片段/向量都没清）。
 * 新实现：kl.deleteRawCascade(rawId) → 自下而上删 vector → chunk → std → raw，
 *         不留半截数据（与 I5 不变量一致）。
 *
 * 权限校验不变：auth.canWrite(user) 拦截 readonly / 非 admin。
 *
 * 阶段 4 不动"四层脏数据清理"——若新旧表并行期间旧表残存历史 raw，按计划留到阶段 9 统一清理。
 * 这里只保证 rawId 一定在 raw_documents 表里。
 */
function remove(user, docId) {
  if (!auth.canWrite(user)) {
    throw fail('当前角色无删除权限', 403);
  }
  return kl.deleteRawCascade(docId);
}

// ============================================================
// 详情（脱敏：仅管理员/审核员可见原文与切片，其他角色只见元信息）
// ============================================================

/**
 * 按角色返回文档视图 —— 阶段 4 入参从 doc 改为 view
 *
 * 入参是 getDocumentView() 产出的聚合视图：
 *   {id, title, fileName, bizLine, securityLevel, tags, uploadedBy, createdAt, updatedAt,
 *    chunkCount, status, lifecycleStatus,
 *    chunks: [{id, seq, heading, keywords, content}]}
 *
 * 剥离规则（与旧契约等价）：
 *   - admin / reviewer：返回完整 view（含 chunks 与 chunks[].content），用于审核判断
 *   - 其他角色 / user 为 null：剥 content 与 chunks，避免按段落切好的原文通过 chunks 字段泄漏
 *
 * 视图本身在 getDocumentView 已经不带 top-level content（只有 chunks[].content），
 * 所以"剥 content"在这里是防御性解构（万一调用方塞了 raw.content 进来），核心剥离是 chunks。
 */
function publicView(view, user) {
  if (!view) return null;
  const isAdmin = user && (user.role === 'admin' || user.role === 'reviewer');
  if (isAdmin) return view;
  // eslint-disable-next-line no-unused-vars
  const { content, chunks, ...safe } = view;
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
