/**
 * 四层知识模型 —— 存储与状态机
 *
 *   raw_documents ──1:N──→ std_documents ──1:N──→ chunks ──1:N──→ vectors
 *   （原始文档）           （标准化版本）        （知识片段）      （向量）
 *
 * 设计依据：docs/技术方案-四层模型.md（该文档是唯一规格来源）
 *
 * 为什么要拆四层：
 *   - 重新加工要"先出草稿再对比生效"→ 标准化文档必须有版本，不能覆盖原文
 *   - 换 Embedding 模型做效果对比 → 一个片段要能存多份向量
 *   - 影响预览"将影响 37 个片段，其中 12 个被引用 45 次" → 片段必须有独立身份
 *   - 逐层向上溯源 / 删除连带向量失效 → 层与层之间只靠 ID 关联，不用嵌套
 *
 * 两条铁律（对应不变量 I3 / I4）：
 *   1. 权限判据字段（bizLine / securityLevel / status）在每层冗余存储，
 *      但**只能从上层继承**，调用方传入的同名字段直接忽略并覆盖。
 *   2. std 的状态变化必须同步下游两层，一次都不能漏。
 *
 *   这不是洁癖。第 7 步的真实事故：buildIndex 白名单拷贝字段时漏了 status，
 *   而权限过滤把"status 缺失"当成"兼容旧数据，放行"，
 *   两个各自合理的决定凑在一起，让整层状态过滤静默失效 ——
 *   未审核文档变成任何人可检索。所以继承这件事不能靠调用方自觉。
 *
 * 所有写操作统一走 lib/store.js（它有模块级缓存，绕过去读文件会读到旧数据）。
 */

const config = require('../config');
const store = require('./store');
const { fingerprint } = require('./document-processor');

// ============================================================
// 0. 常量
// ============================================================

/**
 * M3 三元状态模型（需求说明书第 30 节）
 * 审核 / 处理 / 生效三个维度独立管理，不塞进一个字段。
 */
const REVIEW_STATUS = {
  PENDING: 'pending',       // 待审核
  APPROVED: 'approved',     // 审核通过
  REJECTED: 'rejected',     // 审核失败
};

const PROCESSING_STATUS = {
  NOT_PROCESSED: 'not_processed', // 未处理
  PROCESSING: 'processing',       // 处理中
  SUCCESS: 'success',             // 处理成功
  FAILED: 'failed',               // 处理失败
};

const ONLINE_STATUS = {
  NOT_ONLINE: 'not_online', // 未生效
  ONLINE: 'online',         // 已上线
  OFFLINE: 'offline',       // 已下线
};

/** Document 与 DocumentVersion 的表名（独立实体，见需求第 31 节推荐实体模型） */
const DOCUMENT_TABLE = 'documents';
const DOCUMENT_VERSION_TABLE = 'document_versions';

const LAYERS = { RAW: 'raw', STD: 'std', CHUNK: 'chunk', VECTOR: 'vector' };

/** 层 → { 表名, ID 前缀 } */
const TABLES = {
  [LAYERS.RAW]: { table: 'raw_documents', prefix: 'raw' },
  [LAYERS.STD]: { table: 'std_documents', prefix: 'std' },
  [LAYERS.CHUNK]: { table: 'chunks', prefix: 'chk' },
  [LAYERS.VECTOR]: { table: 'vectors', prefix: 'vec' },
};

/** 原始文档状态：只表达"解析进行到哪一步"，业务状态在第二层 */
const RAW_STATUS = {
  UPLOADED: 'uploaded',
  PARSING: 'parsing',
  PARSE_FAILED: 'parse_failed',
  READY: 'ready',
};

/** 标准化文档状态：这才是真正的业务状态机 */
const STD_STATUS = {
  DRAFT: 'draft',
  QC_FAILED: 'qc_failed',
  PENDING: 'pending',
  REJECTED: 'rejected',
  APPROVED: 'approved',
  PUBLISHED: 'published',
  NEED_REVIEW: 'need_review',
  ARCHIVED: 'archived',
};

/**
 * 可检索状态。
 * need_review（有效期已过但还没复审）仍然可检索，
 * 但 AI 答案里要标注「此规则可能已过期」—— 宁可提示过期，也别让人查不到。
 */
const RETRIEVABLE = [STD_STATUS.PUBLISHED, STD_STATUS.NEED_REVIEW];

/**
 * 允许的状态流转，表里没有的一律拒绝（archived 是终态）。
 *
 * draft → archived（废弃草稿）与 pending → draft（撤回送审）是两个日常动作，
 * 契约 4.2 的原始流转表漏了，导致"草稿写坏了想扔掉""送审送早了想撤回"无路可走。
 *
 * archived 保持终态：版本回滚不是让旧版本复活，而是
 * rollbackToVersion() 拿旧版本的 content/params 建一个新版本 ——
 * 版本号只增不减，审计上永远看得出当前是第几版、每版活过哪段时间。
 */
const TRANSITIONS = {
  [STD_STATUS.DRAFT]: [STD_STATUS.QC_FAILED, STD_STATUS.PENDING, STD_STATUS.ARCHIVED],
  [STD_STATUS.QC_FAILED]: [STD_STATUS.ARCHIVED],
  [STD_STATUS.PENDING]: [STD_STATUS.APPROVED, STD_STATUS.REJECTED, STD_STATUS.DRAFT],
  [STD_STATUS.REJECTED]: [STD_STATUS.ARCHIVED],
  [STD_STATUS.APPROVED]: [STD_STATUS.PUBLISHED, STD_STATUS.ARCHIVED],
  [STD_STATUS.PUBLISHED]: [STD_STATUS.NEED_REVIEW, STD_STATUS.ARCHIVED],
  [STD_STATUS.NEED_REVIEW]: [STD_STATUS.PUBLISHED, STD_STATUS.ARCHIVED],
  [STD_STATUS.ARCHIVED]: [],
};

/**
 * 允许**追加片段**的 std 状态。
 *
 * 为什么要有这道闸门：审核员批的是 std 的正文。发布之后再往这个版本上追加片段，
 * 追加的正文可以和 std.content 毫无关系，而片段一出生就继承 published、
 * 配上向量立刻被 listRetrievableVectors() 返回 —— 六个不变量字面上全部成立，
 * I6 存在的理由（未审核内容不得泄漏）却被绕过了。
 * 这和"重新加工产生新版本、绝不覆盖"的设计本来就一致：
 * 已发布版本要改内容，就该出新版本重新过审。
 */
const CHUNK_APPENDABLE = [
  STD_STATUS.DRAFT, STD_STATUS.QC_FAILED, STD_STATUS.PENDING, STD_STATUS.APPROVED,
];

/**
 * 允许**建向量**的 std 状态（= 除 archived 以外全部）。
 *
 * 为什么这个集合比 CHUNK_APPENDABLE 宽：向量不引入新正文，它只是已审核片段的
 * 一种表示形式。正常发布流程里向量就是在 approved→published 之间建的，
 * 发布后补建漏掉的向量、换 Embedding 模型重算，都是合法运维动作，
 * 拦掉它们等于把第 12 步的重建向量堵死。
 * archived 例外：终态版本的向量永远不会参与检索，为它建向量只会造垃圾数据。
 */
const VECTOR_DENIED = [STD_STATUS.ARCHIVED];

const VALID_BIZLINE = Object.keys(config.bizLines);
const VALID_SECURITY = Object.keys(config.securityLevels);
const VALID_KNOWLEDGE_TYPE = Object.keys(config.knowledgeTypes);

// ============================================================
// 0a. Document / DocumentVersion 实体管理（M3 新模型）
// ============================================================

/**
 * 创建文档实体（需求第 31 节）
 * Document 是业务上的同一份知识，不随版本变化。
 */
function createDocument(input) {
  const it = input || {};
  if (!it.documentName || typeof it.documentName !== 'string') {
    throw fail('请提供文档名称', 400);
  }
  const ts = now();
  const docs = store.read(DOCUMENT_TABLE, []);
  let max = 0;
  for (const d of docs) {
    const m = String(d.document_id || '').match(/_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const doc = {
    document_id: `doc_${String(max + 1).padStart(3, '0')}`,
    document_name: it.documentName,
    current_version_id: null,
    created_at: ts,
    updated_at: ts,
  };
  docs.push(doc);
  store.write(DOCUMENT_TABLE, docs);
  return doc;
}

function getDocument(documentId) {
  const docs = store.read(DOCUMENT_TABLE, []);
  return docs.find((d) => d.document_id === documentId) || null;
}

function listDocuments() {
  return store.read(DOCUMENT_TABLE, []);
}

/**
 * 创建文档版本（需求第 31 节）
 * 版本号规则：未完成向量化时 version_number = 0，完成正式知识处理后形成 V1 / V2 / V3。
 */
function createDocumentVersion(documentId, input) {
  const doc = getDocument(documentId);
  if (!doc) throw fail('文档不存在', 404);
  const it = input || {};
  const ts = now();
  const versions = store.read(DOCUMENT_VERSION_TABLE, []);
  let max = 0;
  for (const v of versions) {
    const m = String(v.version_id || '').match(/_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const version = {
    version_id: `ver_${String(max + 1).padStart(3, '0')}`,
    document_id: documentId,
    version_number: 0, // 未完成向量化处理时 version_number = 0
    source_file_id: it.sourceFileId || null,
    review_status: REVIEW_STATUS.PENDING,
    processing_status: PROCESSING_STATUS.NOT_PROCESSED,
    online_status: ONLINE_STATUS.NOT_ONLINE,
    metadata: it.metadata || {},
    created_at: ts,
    updated_at: ts,
  };
  versions.push(version);
  store.write(DOCUMENT_VERSION_TABLE, versions);
  return version;
}

function getDocumentVersion(versionId) {
  const versions = store.read(DOCUMENT_VERSION_TABLE, []);
  return versions.find((v) => v.version_id === versionId) || null;
}

function listVersionsByDocument(documentId) {
  return store.read(DOCUMENT_VERSION_TABLE, [])
    .filter((v) => v.document_id === documentId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * 按审核状态筛选版本列表（需求第 8 节 - 审核联动）
 * @param {string} reviewStatus 审核状态：pending / approved / rejected
 * @returns {Array} 版本列表
 */
function listVersionsByReviewStatus(reviewStatus) {
  return store.read(DOCUMENT_VERSION_TABLE, [])
    .filter((v) => v.review_status === reviewStatus)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/**
 * 更新文档版本字段（如审核/处理/生效状态）
 */
function updateDocumentVersion(versionId, patch) {
  const versions = store.read(DOCUMENT_VERSION_TABLE, []);
  const idx = versions.findIndex((v) => v.version_id === versionId);
  if (idx === -1) return null;
  const ts = now();
  versions[idx] = { ...versions[idx], ...patch, updated_at: ts };
  store.write(DOCUMENT_VERSION_TABLE, versions);
  return versions[idx];
}

/**
 * 标记版本处理完成（形成正式版本号）
 * 版本号规则（需求第 5 节）：
 * - 未完成完整向量化处理 → 不显示版本号（version_number = 0）
 * - 完成正式知识处理后 → 形成 V1（version_number = 1）
 * - 后续 V1 → V2 → V3
 */
function markVersionProcessingComplete(versionId) {
  const version = getDocumentVersion(versionId);
  if (!version) throw fail('版本不存在', 404);
  // 同文档已完成的版本数 + 1 = 新版本号
  const siblings = store.read(DOCUMENT_VERSION_TABLE, [])
    .filter((v) => v.document_id === version.document_id && v.version_number > 0);
  const maxVersion = siblings.reduce((m, v) => Math.max(m, v.version_number), 0);
  const newVersionNumber = maxVersion + 1;
  const updated = updateDocumentVersion(versionId, {
    version_number: newVersionNumber,
    processing_status: PROCESSING_STATUS.SUCCESS,
  });
  // 更新文档的 current_version_id
  const doc = getDocument(version.document_id);
  if (doc) {
    const docs = store.read(DOCUMENT_TABLE, []);
    const docIdx = docs.findIndex((d) => d.document_id === version.document_id);
    if (docIdx !== -1) {
      docs[docIdx].current_version_id = versionId;
      docs[docIdx].updated_at = now();
      store.write(DOCUMENT_TABLE, docs);
    }
  }
  return updated;
}

// ============================================================
// 1. 内部工具
// ============================================================

/** 统一的带 HTTP 语义的错误（与 lib/documents.js 的写法保持一致） */
function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

function now() {
  return new Date().toISOString();
}

function tableOf(layer) {
  const t = TABLES[layer];
  if (!t) throw fail(`未知的层: ${layer}`, 400);
  return t;
}

/**
 * 读整张表（数组）。**返回浅拷贝，不返回 store 缓存里的活对象。**
 *
 * 为什么必须拷：store.write 落盘时 stringify 整个缓存数组，
 * 所以内存里改一个对象，只要之后该表发生任意一次写操作，改动就被写进文件。
 * 这就是契约里"状态流转只能通过 setStdStatus / publishStd / archiveStd，
 * 不提供直接改 status 的口子"被绕过的实际通道。
 * 浅拷贝对象时数组字段（vec、sections、processLog）仍共享引用，所以 vec 也要拷。
 */
function listAll(layer) {
  const { table } = tableOf(layer);
  const list = store.read(table, []);
  if (!Array.isArray(list)) return [];
  return list.map(cloneRecord);
}

/** 浅拷贝：对象 + 数组字段都拷一层。够用 —— 我们要防的是"外部改 vec/keywords/sections"被落盘 */
function cloneRecord(r) {
  const out = { ...r };
  if (Array.isArray(out.vec)) out.vec = out.vec.slice();
  if (Array.isArray(out.sections)) out.sections = out.sections.map((s) => ({ ...s }));
  if (Array.isArray(out.processLog)) out.processLog = out.processLog.map((p) => ({ ...p }));
  if (Array.isArray(out.keywords)) out.keywords = out.keywords.slice();
  if (Array.isArray(out.sectionPath)) out.sectionPath = out.sectionPath.slice();
  if (Array.isArray(out.tags)) out.tags = out.tags.slice();
  return out;
}

function findById(layer, id) {
  if (!id) return null;
  return listAll(layer).find((r) => r.id === id) || null;
}

/**
 * 批量给一张表打补丁：cond 命中的记录合并 patch，一次性落盘。
 * 逐条 store.update 会写 N 次文件，级联同步时代价太高。
 */
function patchWhere(layer, cond, patch) {
  const { table } = tableOf(layer);
  const list = listAll(layer);
  let changed = 0;
  const next = list.map((r) => {
    if (!cond(r)) return r;
    changed += 1;
    return { ...r, ...patch, updatedAt: now() };
  });
  if (changed > 0) store.write(table, next);
  return changed;
}

/**
 * 批量插入：一次算好连续 ID 再整表写回。
 * 直接连着调 store.push 会每条读一次表算一次 nextId，切片多时很慢。
 */
function insertMany(layer, records) {
  const { table, prefix } = tableOf(layer);
  if (records.length === 0) return [];
  const list = listAll(layer);
  let max = 0;
  for (const r of list) {
    const m = String(r.id || '').match(/_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const made = records.map((r, i) => ({
    id: `${prefix}_${String(max + 1 + i).padStart(3, '0')}`,
    ...r,
  }));
  store.write(table, list.concat(made));
  return made;
}

function insertOne(layer, record) {
  return insertMany(layer, [record])[0];
}

/** 深拷贝加工参数（快照必须与 config 脱钩，否则改配置会篡改历史版本） */
function snapshotParams(input) {
  const def = config.processing;
  const over = (input && input.params) || {};
  return {
    ...def,
    ...over,
    cleanLevel: { ...def.cleanLevel, ...(over.cleanLevel || {}) },
  };
}

// ============================================================
// 2. 第一层：raw_documents
// ============================================================

/**
 * 新建原始文档。
 * 校验 bizLine / securityLevel / knowledgeType 的合法性 ——
 * 权限判据从这里开始，源头不校验，后面每层继承的都是脏值。
 */
function createRaw(input) {
  const it = input || {};
  if (!it.content || typeof it.content !== 'string') {
    throw fail('请提供文档内容（原文必须保留，否则无法重新加工）', 400);
  }
  if (!VALID_BIZLINE.includes(it.bizLine)) throw fail(`业务线非法: ${it.bizLine}`, 400);
  if (!VALID_SECURITY.includes(it.securityLevel)) throw fail(`安全分级非法: ${it.securityLevel}`, 400);

  const knowledgeType = it.knowledgeType || 'other';
  if (!VALID_KNOWLEDGE_TYPE.includes(knowledgeType)) {
    throw fail(`知识类型非法: ${it.knowledgeType}`, 400);
  }

  const ts = now();
  return insertOne(LAYERS.RAW, {
    title: it.title || it.fileName || '未命名文档',
    fileName: it.fileName || null,
    fileType: it.fileType || 'md',
    fileSize: typeof it.fileSize === 'number' ? it.fileSize : Buffer.byteLength(it.content, 'utf8'),
    content: it.content,
    knowledgeType,
    version: it.version || null,
    tags: Array.isArray(it.tags) ? it.tags : [],
    owner: it.owner || null,
    validUntil: it.validUntil || null,
    uploadedBy: it.uploadedBy || null,
    bizLine: it.bizLine,
    securityLevel: it.securityLevel,
    // M3: 血缘字段 —— document / version 标识
    documentId: it.documentId || null,
    versionId: it.versionId || null,
    // M3: 完整元数据（文档类型/业务域/敏感等级/有效期）
    metadata: it.metadata || null,
    /**
     * 旧扁平表（data/documents.json）里的原始 id，仅迁移时写入。
     * 契约 3.2 没有这个字段，但迁移要求"按 fileName+createdAt 判重"，
     * 而旧记录允许 fileName 为空（手工粘贴的内容就没有文件名），
     * 这时没有任何持久化字段能对齐旧记录 → 重复执行会造出重复数据。
     * 所以留一个来源标记，非迁移场景恒为 null。
     */
    legacyId: it.legacyId || null,
    // 状态由本模块掌管，不接受调用方指定
    status: RAW_STATUS.UPLOADED,
    currentStdId: null,
    parseError: null,
    createdAt: it.createdAt || ts,
    updatedAt: ts,
  });
}

/**
 * 标记解析失败。
 * 不校验来源状态：解析可以重试，失败→失败也是合法的（换个解析器再来一次）。
 */
function markParseFailed(rawId, reason) {
  const raw = getRaw(rawId);
  if (!raw) throw fail('原始文档不存在', 404);
  return store.update(TABLES[LAYERS.RAW].table, rawId, {
    status: RAW_STATUS.PARSE_FAILED,
    parseError: reason || '解析失败（未提供原因）',
    updatedAt: now(),
  });
}

/** 标记解析完成，清掉上一次的失败原因 */
function markReady(rawId) {
  const raw = getRaw(rawId);
  if (!raw) throw fail('原始文档不存在', 404);
  return store.update(TABLES[LAYERS.RAW].table, rawId, {
    status: RAW_STATUS.READY,
    parseError: null,
    updatedAt: now(),
  });
}

function getRaw(rawId) {
  return findById(LAYERS.RAW, rawId);
}

// ============================================================
// 3. 第二层：std_documents
// ============================================================

/**
 * 新建一个标准化版本（重新加工就是新建一个版本，绝不覆盖旧的）。
 *
 * - procVersion 自动 = 同 raw 下 max + 1
 * - bizLine / securityLevel 强制从 raw 继承，忽略 input 里的同名字段（I3）
 * - 初始 status = draft，isCurrent = false —— 草稿不生效，要 publishStd 才生效
 */
function createStdVersion(rawId, input) {
  const raw = getRaw(rawId);
  if (!raw) throw fail('原始文档不存在', 404);
  const it = input || {};

  const siblings = listAll(LAYERS.STD).filter((s) => s.rawId === rawId);
  const maxVersion = siblings.reduce((m, s) => Math.max(m, Number(s.procVersion) || 0), 0);

  const ts = now();
  return insertOne(LAYERS.STD, {
    rawId,
    procVersion: maxVersion + 1,
    isCurrent: false,
    params: snapshotParams(it),
    content: typeof it.content === 'string' ? it.content : '',
    sections: Array.isArray(it.sections) ? it.sections : [],
    processLog: Array.isArray(it.processLog) ? it.processLog : [],
    qualityScore: it.qualityScore || null,
    reviewedBy: it.reviewedBy || null,
    reviewedAt: it.reviewedAt || null,
    reviewNote: it.reviewNote || null,
    publishedAt: null,
    // M3: 血缘字段
    documentId: it.documentId || raw.documentId || null,
    versionId: it.versionId || raw.versionId || null,
    // M3: 继承 raw 的完整元数据（需求第 32 节 元数据继承链）。
    // raw.metadata 是源（可能含 knowledgeType 业务文档类型 / bizDomain / validUntil 等）。
    // 若 metadata 未含知识类型，则回退取 raw 顶层的 processing knowledgeType。
    // securityLevel 是从 raw 顶层冗余继承的权限判据，一并并入元数据链。
    metadata: (() => {
      const base = { ...(raw.metadata || {}), securityLevel: raw.securityLevel };
      if (base.knowledgeType == null) base.knowledgeType = raw.knowledgeType || 'other';
      return base;
    })(),
    // ↓ 权限判据一律继承 raw，input 里的同名字段被忽略（不变量 I3）
    bizLine: raw.bizLine,
    securityLevel: raw.securityLevel,
    status: STD_STATUS.DRAFT,
    createdAt: ts,
    updatedAt: ts,
  });
}

/** 校验流转合法性，非法直接抛 409（"当前状态下这个动作不成立"，不是参数错误） */
function assertTransition(std, next) {
  if (!Object.values(STD_STATUS).includes(next)) {
    throw fail(`未知的标准化文档状态: ${next}`, 400);
  }
  const allowed = TRANSITIONS[std.status] || [];
  if (!allowed.includes(next)) {
    throw fail(
      `状态流转非法: ${std.status} → ${next}` +
      (allowed.length ? `（当前只允许转为 ${allowed.join(' / ')}）` : '（当前已是终态）'),
      409
    );
  }
}

/**
 * 同步下游两层的 status（不变量 I4）。
 *
 * 契约只点名了 publishStd / archiveStd 要同步，但 I4 要求
 * "chunk / vector 的 status 必须等于其 std 的值"是**始终**成立的，
 * 所以这里做成"任何一次 std 状态变化都同步"，不留例外分支。
 * 少同步一次，就是一个 status 不一致的片段，就是第 7 步那个事故的复现。
 */
function syncDownstreamStatus(stdId, status) {
  const chunkIds = listAll(LAYERS.CHUNK).filter((c) => c.stdId === stdId).map((c) => c.id);
  const chunkCount = patchWhere(LAYERS.CHUNK, (c) => c.stdId === stdId, { status });
  const idSet = new Set(chunkIds);
  const vectorCount = patchWhere(LAYERS.VECTOR, (v) => idSet.has(v.chunkId) || v.stdId === stdId, { status });
  return { chunkCount, vectorCount };
}

/** 只改 std 自己 + 同步下游，不做发布/归档的额外副作用 */
function writeStdStatus(stdId, next, extra) {
  const updated = store.update(TABLES[LAYERS.STD].table, stdId, {
    status: next,
    updatedAt: now(),
    ...(extra || {}),
  });
  syncDownstreamStatus(stdId, next);
  return updated;
}

/**
 * 按 TRANSITIONS 校验后改状态。非法流转抛 409。
 *
 * published / archived 两个目标状态有额外副作用（生效切换、下游归档），
 * 一律转交 publishStd / archiveStd —— 只留一条写路径，避免绕过不变量。
 *
 * @param {Object} [meta] { reviewedBy, reviewNote }
 */
function setStdStatus(stdId, next, meta) {
  const std = getStd(stdId);
  if (!std) throw fail('标准化文档不存在', 404);
  assertTransition(std, next);

  if (next === STD_STATUS.PUBLISHED) return publishStd(stdId);
  if (next === STD_STATUS.ARCHIVED) return archiveStd(stdId);

  const extra = {};
  const m = meta || {};
  // 审核动作留痕
  if (next === STD_STATUS.APPROVED || next === STD_STATUS.REJECTED) {
    extra.reviewedBy = m.reviewedBy || null;
    extra.reviewedAt = m.reviewedAt || now();
    extra.reviewNote = m.reviewNote || null;
  }
  return writeStdStatus(stdId, next, extra);
}

/**
 * 让某个 std 版本生效并发布：
 *   1. 同 raw 下其他 isCurrent 的 std → isCurrent=false，
 *      且若为 published / need_review 则连带下游一起归档
 *   2. 本 std → isCurrent=true, status=published, publishedAt=now
 *   3. 同步其 chunks 与 vectors 的 status（不变量 I4）
 *   4. 更新 raw.currentStdId
 * 保证不变量 I1。
 */
function publishStd(stdId) {
  const std = getStd(stdId);
  if (!std) throw fail('标准化文档不存在', 404);
  assertTransition(std, STD_STATUS.PUBLISHED);

  // 1. 让位：同 raw 下原来的生效版本退下
  const siblings = listAll(LAYERS.STD)
    .filter((s) => s.rawId === std.rawId && s.id !== stdId && s.isCurrent);
  for (const old of siblings) {
    if (RETRIEVABLE.includes(old.status)) {
      // published / need_review → archived 是合法流转，连带下游一起归档
      writeStdStatus(old.id, STD_STATUS.ARCHIVED, { isCurrent: false });
    } else {
      store.update(TABLES[LAYERS.STD].table, old.id, { isCurrent: false, updatedAt: now() });
    }
  }

  // 2 + 3. 本版本生效并发布，下游状态跟随
  const ts = now();
  const updated = store.update(TABLES[LAYERS.STD].table, stdId, {
    status: STD_STATUS.PUBLISHED,
    isCurrent: true,
    publishedAt: ts,
    updatedAt: ts,
  });
  syncDownstreamStatus(stdId, STD_STATUS.PUBLISHED);

  // 4. raw 上冗余一个快查指针
  store.update(TABLES[LAYERS.RAW].table, std.rawId, { currentStdId: stdId, updatedAt: ts });
  return updated;
}

/** 归档：std 自己 + 下游两层同步 archived，并让出生效位 */
function archiveStd(stdId) {
  const std = getStd(stdId);
  if (!std) throw fail('标准化文档不存在', 404);
  assertTransition(std, STD_STATUS.ARCHIVED);

  const updated = writeStdStatus(stdId, STD_STATUS.ARCHIVED, { isCurrent: false });
  const raw = getRaw(std.rawId);
  if (raw && raw.currentStdId === stdId) {
    store.update(TABLES[LAYERS.RAW].table, raw.id, { currentStdId: null, updatedAt: now() });
  }
  return updated;
}

/** 有效期到了：published → need_review。仍可检索，但答案里要标注可能过期 */
function markNeedReview(stdId) {
  const std = getStd(stdId);
  if (!std) throw fail('标准化文档不存在', 404);
  assertTransition(std, STD_STATUS.NEED_REVIEW);
  return writeStdStatus(stdId, STD_STATUS.NEED_REVIEW);
}

/**
 * 从某个历史版本回滚：复制 srcStdId 的 content / params / sections 创建新版本。
 *
 * 为什么不让旧版本复活（也就是去掉 archived 终态、加 archived→published 流转）：
 *   审计。版本号只增不减，永远能一眼看出"当前是第几版""这一版活过哪段时间"。
 *   如果让 v1 复活，历史上就出现"v1 发布过两次"，中间那段时间某个答案是哪一版
 *   给出的会说不清。这也是 git 用 revert 而不是 reset 的理由。
 *   代价只是版本号会涨，无所谓。
 *
 * 新版本是 draft —— 走完整审核发布流程，绝不直接生效。
 * src 本身保持原状态不动。
 */
function rollbackToVersion(srcStdId) {
  const src = getStd(srcStdId);
  if (!src) throw fail('源版本不存在', 404);

  return createStdVersion(src.rawId, {
    content: src.content,
    sections: src.sections,
    params: src.params,
    qualityScore: src.qualityScore,
    processLog: (src.processLog || []).concat([{
      step: 'rollback', action: 'rollbackToVersion',
      fromStdId: srcStdId, procVersion: src.procVersion, at: now(),
    }]),
  });
}

function getStd(stdId) {
  return findById(LAYERS.STD, stdId);
}

/** 同 raw 下的全部版本，按 procVersion 降序（最新的在最前面） */
function listStdByRaw(rawId) {
  return listAll(LAYERS.STD)
    .filter((s) => s.rawId === rawId)
    .sort((a, b) => (Number(b.procVersion) || 0) - (Number(a.procVersion) || 0));
}

// ============================================================
// 4. 第三层：chunks
// ============================================================

/**
 * 批量创建片段。
 * bizLine / securityLevel / status 强制从 std 继承（不变量 I4），
 * rawId 自动从 std 带出，seq 在该 std 内连续递增（追加时接着上次的号，不从 1 重来）。
 */
function createChunks(stdId, chunkInputs) {
  const std = getStd(stdId);
  if (!std) throw fail('标准化文档不存在', 404);
  // 守卫：已发布 / 复审中 / 已驳回 / 已归档 不能再追加片段。
  // 想要改动？重新加工出一个新版本（createStdVersion），那是干净的版本号，
  // 走完整审核 —— 绝不覆盖已发布的内容。
  if (!CHUNK_APPENDABLE.includes(std.status)) {
    throw fail(
      `当前状态 ${std.status} 不允许追加片段（要改动已发布/已归档内容请创建新版本重新加工）`,
      409
    );
  }
  const inputs = Array.isArray(chunkInputs) ? chunkInputs : [];
  if (inputs.length === 0) return [];

  const existing = listAll(LAYERS.CHUNK).filter((c) => c.stdId === stdId);
  let seq = existing.reduce((m, c) => Math.max(m, Number(c.seq) || 0), 0);

  const ts = now();
  const records = inputs.map((it) => {
    const content = typeof it.content === 'string' ? it.content : '';
    seq += 1;
    return {
      stdId,
      rawId: std.rawId,
      // M3: 血缘字段
      documentId: std.documentId || null,
      versionId: std.versionId || null,
      // M3: 继承 std 的完整元数据
      metadata: std.metadata ? { ...std.metadata } : null,
      seq,
      heading: it.heading || null,
      sectionPath: Array.isArray(it.sectionPath) ? it.sectionPath : [],
      content,
      charCount: typeof it.charCount === 'number' ? it.charCount : content.length,
      fingerprint: it.fingerprint || fingerprint(content),
      keywords: Array.isArray(it.keywords) ? it.keywords : [],
      qualityScore: it.qualityScore || null,
      embeddingStatus: 'pending',
      // ↓ 权限判据一律继承 std，input 里的同名字段被忽略（不变量 I4）
      bizLine: std.bizLine,
      securityLevel: std.securityLevel,
      status: std.status,
      createdAt: ts,
      updatedAt: ts,
    };
  });
  return insertMany(LAYERS.CHUNK, records);
}

function getChunk(chunkId) {
  return findById(LAYERS.CHUNK, chunkId);
}

/** 某个 std 下的片段，按 seq 升序（就是文档里的先后顺序） */
function listChunksByStd(stdId) {
  return listAll(LAYERS.CHUNK)
    .filter((c) => c.stdId === stdId)
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

// ============================================================
// 5. 第四层：vectors
// ============================================================

/**
 * 为片段创建向量。
 * - 同 chunkId + 同 model 已有 isCurrent 的向量时，旧的置 false（不变量 I2）
 *   —— 换模型重算不删旧向量，留着做效果对比，但只有一份参与检索
 * - bizLine / securityLevel / status 强制从 chunk 继承
 */
function createVector(chunkId, input) {
  const chunk = getChunk(chunkId);
  if (!chunk) throw fail('知识片段不存在', 404);
  // 守卫：所属版本已归档则不允许建向量（终态版本的向量永不参与检索，建出来是垃圾）。
  // published / need_review 允许 —— 补建漏向量、换 Embedding 模型重算都是合法运维动作。
  // 找到所属 std 来判（chunk 上有 stdId，冗余但本表不存 stdId→status 反查表）
  const parentStd = getStd(chunk.stdId);
  if (parentStd && VECTOR_DENIED.includes(parentStd.status)) {
    throw fail(
      `所属版本 ${chunk.stdId} 已归档，不能再建向量（终态版本永不参与检索）`,
      409
    );
  }
  const it = input || {};
  if (!it.model || typeof it.model !== 'string') throw fail('请提供向量模型名 model', 400);
  const vec = Array.isArray(it.vec) ? it.vec : [];

  // 同 chunk + 同 model 的旧向量退位
  patchWhere(
    LAYERS.VECTOR,
    (v) => v.chunkId === chunkId && v.model === it.model && v.isCurrent,
    { isCurrent: false }
  );

  const ts = now();
  const encoding = it.encoding || 'dense';
  if (encoding !== 'dense' && encoding !== 'sparse') {
    throw fail(`向量编码非法: ${encoding}（只接受 dense / sparse）`, 400);
  }
  return insertOne(LAYERS.VECTOR, {
    chunkId,
    stdId: chunk.stdId,
    rawId: chunk.rawId,
    // M3: 血缘字段
    documentId: chunk.documentId || null,
    versionId: chunk.versionId || null,
    model: it.model,
    dim: typeof it.dim === 'number' ? it.dim : vec.length,
    vec,
    encoding,
    indexName: it.indexName || 'default',
    isCurrent: true,
    // ↓ 权限判据一律继承 chunk，input 里的同名字段被忽略（不变量 I4）
    bizLine: chunk.bizLine,
    securityLevel: chunk.securityLevel,
    status: chunk.status,
    createdAt: ts,
    updatedAt: ts,
  });
}

function listVectorsByChunk(chunkId) {
  return listAll(LAYERS.VECTOR).filter((v) => v.chunkId === chunkId);
}

/**
 * 参与检索的向量：status ∈ RETRIEVABLE 且 isCurrent（不变量 I6）。
 * 这是 RAG 引擎唯一该用的入口 —— 状态过滤在这里做一次，
 * 而不是等各调用方自己判断（那就又回到第 7 步的事故模式了）。
 */
function listRetrievableVectors() {
  return listAll(LAYERS.VECTOR).filter((v) => v.isCurrent === true && RETRIEVABLE.includes(v.status));
}

/**
 * 为一个片段批量创建向量。
 *
 * 一次落盘：所有 input 合一条 SQL 一次写回。第 12 步真建向量时
 * 373 个片段 × N 个模型 = 数千条逐条调用会写数千次盘，分钟级耗时；
 * 用这个批量接口只是一次写。
 *
 * 同 chunkId + 同 model 的旧向量在批量中最后一条生效的设为 isCurrent（I2）。
 * 权限判据一律继承 chunk（I4）。
 *
 * @param {string} chunkId
 * @param {Array<{model, dim?, vec, indexName?, encoding?}>} inputs
 */
function createVectors(chunkId, inputs) {
  const chunk = getChunk(chunkId);
  if (!chunk) throw fail('知识片段不存在', 404);
  const list = Array.isArray(inputs) ? inputs : [];
  if (list.length === 0) return [];

  // 守卫：所属版本已归档则不允许建向量（参考 createVector）
  const parentStd = getStd(chunk.stdId);
  if (parentStd && VECTOR_DENIED.includes(parentStd.status)) {
    throw fail(
      `所属版本 ${chunk.stdId} 已归档，不能再建向量`,
      409
    );
  }

  const ts = now();
  const records = list.map((it) => buildVectorRecord(chunk, it, ts));
  // 批量里同 chunk + 同 model 多条时：保留最后一条为 isCurrent，其余置 false（I2）
  const seen = new Map(); // key = chunkId|model -> 最后一条的临时 id
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const key = `${r.chunkId}|${r.model}`;
    if (seen.has(key)) {
      records[seen.get(key)].isCurrent = false;
    }
    seen.set(key, i);
  }
  return insertMany(LAYERS.VECTOR, records);
}

/** 跨片段批量建向量。失败回滚已插入的（半截插入会让 checkInvariants 报 I5）。 */
function createVectorsBatch(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const allRecords = [];
  const ts = now();
  for (const item of list) {
    // 两种调用形式都支持：
    //   旧：[{ chunkId, model, vec, ... }, ...]               —— 直接一条 record
    //   新：[{ chunkId, vectors: [{ model, vec, ... }] }, ...] —— 多个 vector 归一个 chunk
    // 形式判断：看 item.vectors 是否存在
    if (item && Array.isArray(item.vectors)) {
      const chunk = getChunk(item.chunkId);
      if (!chunk) throw fail(`知识片段不存在: ${item.chunkId}`, 404);
      const parentStd = getStd(chunk.stdId);
      if (parentStd && VECTOR_DENIED.includes(parentStd.status)) {
        throw fail(`所属版本 ${chunk.stdId} 已归档，不能再建向量`, 409);
      }
      for (const v of item.vectors) {
        allRecords.push(buildVectorRecord(chunk, v, ts));
      }
    } else if (item && item.chunkId) {
      // 简写形式：item 本身就含 model/vec
      const chunk = getChunk(item.chunkId);
      if (!chunk) throw fail(`知识片段不存在: ${item.chunkId}`, 404);
      const parentStd = getStd(chunk.stdId);
      if (parentStd && VECTOR_DENIED.includes(parentStd.status)) {
        throw fail(`所属版本 ${chunk.stdId} 已归档，不能再建向量`, 409);
      }
      allRecords.push(buildVectorRecord(chunk, item, ts));
    } else {
      throw fail('createVectorsBatch 的每条 item 必须有 chunkId', 400);
    }
  }
  // I2 批量内去重：同 chunkId+model 的最后一条生效
  const seen = new Map();
  for (let i = 0; i < allRecords.length; i += 1) {
    const r = allRecords[i];
    const key = `${r.chunkId}|${r.model}`;
    if (seen.has(key)) allRecords[seen.get(key)].isCurrent = false;
    seen.set(key, i);
  }
  return insertMany(LAYERS.VECTOR, allRecords);
}

function buildVectorRecord(chunk, it, ts) {
  if (!it || !it.model) throw fail('请提供向量模型名 model', 400);
  const vec = Array.isArray(it.vec) ? it.vec : [];
  const encoding = it.encoding || 'dense';
  if (encoding !== 'dense' && encoding !== 'sparse') {
    throw fail(`向量编码非法: ${encoding}（只接受 dense / sparse）`, 400);
  }
  return {
    chunkId: chunk.id,
    stdId: chunk.stdId,
    rawId: chunk.rawId,
    // M3: 血缘字段
    documentId: chunk.documentId || null,
    versionId: chunk.versionId || null,
    model: it.model,
    dim: typeof it.dim === 'number' ? it.dim : vec.length,
    vec,
    encoding,
    indexName: it.indexName || 'default',
    isCurrent: true,
    // ↓ 权限判据一律继承 chunk（I4）
    bizLine: chunk.bizLine,
    securityLevel: chunk.securityLevel,
    status: chunk.status,
    createdAt: ts,
    updatedAt: ts,
  };
}

/**
 * 标记 chunks 的 embeddingStatus 为 'done'（向量化完成）。
 * 在 createVectorsBatch 之后调用，更新 chunk 的元数据状态。
 */
function markChunksEmbedded(chunkIds) {
  const ts = now();
  for (const id of chunkIds) {
    store.update(TABLES[LAYERS.CHUNK].table, id, { embeddingStatus: 'done', updatedAt: ts });
  }
}

// ============================================================
// 6. 级联删除
// ============================================================

/** 删除原始文档 → 连带其所有 std / chunk / vector。返回删除计数 */
function deleteRawCascade(rawId) {
  const raw = getRaw(rawId);
  if (!raw) return { rawCount: 0, stdCount: 0, chunkCount: 0, vectorCount: 0 };

  const stdIds = new Set(listAll(LAYERS.STD).filter((s) => s.rawId === rawId).map((s) => s.id));
  const chunkIds = new Set(
    listAll(LAYERS.CHUNK).filter((c) => c.rawId === rawId || stdIds.has(c.stdId)).map((c) => c.id)
  );

  const counts = {
    rawCount: 0,
    stdCount: 0,
    chunkCount: 0,
    vectorCount: 0,
  };
  // 自下而上删，任何一步中断都不会留下"上层没了、下层还在"的孤儿
  counts.vectorCount = removeWhere(LAYERS.VECTOR,
    (v) => chunkIds.has(v.chunkId) || stdIds.has(v.stdId) || v.rawId === rawId);
  counts.chunkCount = removeWhere(LAYERS.CHUNK, (c) => chunkIds.has(c.id));
  counts.stdCount = removeWhere(LAYERS.STD, (s) => stdIds.has(s.id));
  counts.rawCount = removeWhere(LAYERS.RAW, (r) => r.id === rawId);
  return counts;
}

/** 删除某个 std 版本 → 连带其 chunk / vector */
function deleteStdCascade(stdId) {
  const std = getStd(stdId);
  if (!std) return { stdCount: 0, chunkCount: 0, vectorCount: 0 };

  const chunkIds = new Set(listAll(LAYERS.CHUNK).filter((c) => c.stdId === stdId).map((c) => c.id));
  const counts = { stdCount: 0, chunkCount: 0, vectorCount: 0 };
  counts.vectorCount = removeWhere(LAYERS.VECTOR, (v) => chunkIds.has(v.chunkId) || v.stdId === stdId);
  counts.chunkCount = removeWhere(LAYERS.CHUNK, (c) => chunkIds.has(c.id));
  counts.stdCount = removeWhere(LAYERS.STD, (s) => s.id === stdId);

  const raw = getRaw(std.rawId);
  if (raw && raw.currentStdId === stdId) {
    store.update(TABLES[LAYERS.RAW].table, raw.id, { currentStdId: null, updatedAt: now() });
  }
  return counts;
}

function removeWhere(layer, cond) {
  const { table } = tableOf(layer);
  const list = listAll(layer);
  const next = list.filter((r) => !cond(r));
  const removed = list.length - next.length;
  if (removed > 0) store.write(table, next);
  return removed;
}

// ============================================================
// 6b. [M4] 处理链路（异步处理引擎的各阶段实现）
//     阶段顺序：standardize → chunking → meta_recognize → embedding
// ============================================================

const dp = require('./document-processor');
const vs = require('./vector-store');
const ap = require('./async-processor');
const { tokenize, STOP_WORDS } = require('./tokenize');

/** 按 versionId 找 raw（一个版本对应一份原始文档） */
function getRawByVersionId(versionId) {
  if (!versionId) return null;
  return listAll(LAYERS.RAW).find((r) => r.versionId === versionId) || null;
}

/** 按 versionId 找最新一个 std（同一版本号下可能多次重加工，procVersion 最大者） */
function getStdByVersionId(versionId) {
  if (!versionId) return null;
  return listAll(LAYERS.STD)
    .filter((s) => s.versionId === versionId)
    .sort((a, b) => (Number(b.procVersion) || 0) - (Number(a.procVersion) || 0))[0] || null;
}

/**
 * 阶段 1：标准化处理。
 * - 找到 versionId 对应的 raw
 * - 对 raw.content 做归一化（frontmatter 剥离 + 大小写/全角处理）
 * - 创建一份 std（createStdVersion）
 * - 返回 { rawId, stdId, content }
 */
function standardizeDocument(versionId, opts = {}) {
  const version = getDocumentVersion(versionId);
  if (!version) throw fail(`文档版本不存在: ${versionId}`, 404);
  const raw = getRawByVersionId(versionId);
  if (!raw) throw fail(`版本 ${versionId} 缺少原始文档，无法标准化`, 400);

  // 文本归一化（去 frontmatter + 全角转半角 + 统一换行等）
  const { body } = dp.parseFrontmatter(raw.content);
  const normalized = dp.normalize(body);

  // 创建一个新的 std 版本（永远不覆盖旧的，便于审计）
  const std = createStdVersion(raw.id, {
    content: normalized,
    documentId: version.document_id,
    versionId: version.version_id,
    sections: [],
    processLog: [{
      step: 'standardize',
      action: 'auto_standardize',
      rawId: raw.id,
      versionId: version.version_id,
      at: now(),
    }],
  });

  return { rawId: raw.id, stdId: std.id, content: normalized, charCount: normalized.length };
}

/**
 * 阶段 2：按 Markdown 标题切分 Chunk（需求第 13 节）。
 * - 找到 versionId 对应的最新 std
 * - 用 splitToChunksByHeading 按标题切分
 * - 调 createChunks 批量入库
 * - 返回 { stdId, chunkCount, chunks }
 */
function chunkingDocument(versionId, opts = {}) {
  const std = getStdByVersionId(versionId);
  if (!std) throw fail(`版本 ${versionId} 缺少标准化文档，请先执行标准化`, 400);
  if (!std.content || std.content.length === 0) {
    throw fail(`版本 ${versionId} 标准化内容为空，无法切分`, 400);
  }

  const sections = dp.splitToChunksByHeading(std.content);
  if (sections.length === 0) {
    return { stdId: std.id, chunkCount: 0, chunks: [] };
  }

  // 把 splitToChunksByHeading 的结果映射成 createChunks 的入参
  // 注意：此处 append 到现有 std 上前需要校验 std.status（draft/pending/approved 允许）
  // 由于我们刚 standardize 出来，std.status 一定是 draft，所以必能通过守卫
  const chunkInputs = sections.map((s) => ({
    content: s.content,
    heading: s.heading,
    sectionPath: s.heading ? [s.heading] : [],
    charCount: s.content.length,
  }));
  const created = createChunks(std.id, chunkInputs);
  return { stdId: std.id, chunkCount: created.length, chunks: created };
}

/**
 * 阶段 3：Chunk 元数据 AI 识别（需求第 14 节）。
 * - 给每个 chunk 补充 tags（业务功能、AI 语义判断的简版）
 * - 提取关键词
 * - 写回 chunk.keywords / chunk.metadata.recognizedTags
 *
 * 第一版：基于关键词频次的轻量语义识别（mock LLM）。
 * 真实接入 LLM 时替换 recognizeTagsByText 即可。
 */
function recognizeChunkMeta(versionId, opts = {}) {
  const std = getStdByVersionId(versionId);
  if (!std) throw fail(`版本 ${versionId} 缺少标准化文档`, 400);
  const chunks = listAll(LAYERS.CHUNK).filter((c) => c.stdId === std.id);
  if (chunks.length === 0) return { stdId: std.id, recognizedCount: 0 };

  let recognized = 0;
  for (const c of chunks) {
    // 提取关键词（用 document-processor 的 extractKeywords）
    const keywords = dp.extractKeywords(c.content, 6);

    // 轻量语义识别：基于标题 + 内容高频词给出"业务功能"标签
    const recognizedTags = inferBusinessTags(c);

    // 合并元数据：保留原 metadata，补 recognizedTags
    const updatedMeta = {
      ...(c.metadata || {}),
      recognizedTags,
    };

    // 写回 chunk
    store.update(TABLES[LAYERS.CHUNK].table, c.id, {
      keywords,
      metadata: updatedMeta,
      updatedAt: now(),
    });
    recognized += 1;
  }

  return { stdId: std.id, recognizedCount: recognized };
}

/** 简版业务功能识别：基于 chunk 标题与文本中的常见业务关键词打标 */
function inferBusinessTags(chunk) {
  const text = `${chunk.heading || ''}\n${chunk.content || ''}`;
  const tags = [];
  const TAG_RULES = [
    { tag: '订单', keys: ['订单', 'order', '退款', '支付'] },
    { tag: '会员', keys: ['会员', 'membership', '等级', '积分'] },
    { tag: '商品', keys: ['商品', 'sku', '库存', '上架'] },
    { tag: '权限', keys: ['权限', '角色', '授权', 'role'] },
    { tag: '接口', keys: ['接口', 'api', 'rest', 'endpoint'] },
    { tag: '测试', keys: ['测试', 'test', '用例', '断言'] },
    { tag: '数据', keys: ['数据', 'database', 'sql', '统计'] },
  ];
  for (const r of TAG_RULES) {
    if (r.keys.some((k) => text.toLowerCase().includes(k.toLowerCase()))) {
      tags.push(r.tag);
    }
  }
  return tags;
}

/**
 * 阶段 4：向量化（需求第 16 节）。
 * - 找到 versionId 对应的所有 chunk
 * - 用 vector-store.embedChunks 生成向量
 * - 用 createVectorsBatch 批量入库
 * - 调 markChunksEmbedded 更新 chunk.embeddingStatus
 */
function embedChunksForVersion(versionId, opts = {}) {
  const std = getStdByVersionId(versionId);
  if (!std) throw fail(`版本 ${versionId} 缺少标准化文档`, 400);
  const chunks = listAll(LAYERS.CHUNK)
    .filter((c) => c.stdId === std.id)
    .sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  if (chunks.length === 0) return { stdId: std.id, vectorCount: 0 };

  const model = (opts && opts.model) || 'tfidf-v1';
  const indexName = (opts && opts.indexName) || 'main';

  // 计算向量
  const vecs = vs.embedChunks(chunks, { model, indexName });

  // 批量入库
  const items = vecs.map((v, i) => ({
    chunkId: chunks[i].id,
    model: v.model,
    dim: v.dim,
    vec: v.vec,
    indexName: v.indexName,
    encoding: 'dense',
  }));
  const created = createVectorsBatch(items);

  // 标记 chunk 为已嵌入
  const chunkIds = created.map((v) => v.chunkId);
  markChunksEmbedded(chunkIds);

  return { stdId: std.id, vectorCount: created.length };
}

// ============================================================
// 6c. [M4] 异步处理编排
// ============================================================

/**
 * 触发生成向量数据（需求第 11 节 —— 唯一入口）。
 *
 * 行为：
 *   1. 校验 version.review_status === approved（前置条件）
 *   2. 创建异步任务（ap.createTask）
 *   3. 立即返回 taskId（不阻塞）
 *   4. 用 setImmediate 把 runTask 推到下一个事件循环，后台异步执行
 *   5. 任务完成后自动 markVersionProcessingComplete 形成正式版本号
 *
 * @returns {Object} task 对象（status=queued，taskId 已可用）
 */
function generateVectors(versionId, opts = {}) {
  const version = getDocumentVersion(versionId);
  if (!version) throw fail(`文档版本不存在: ${versionId}`, 404);
  if (version.review_status !== REVIEW_STATUS.APPROVED) {
    throw fail(
      `当前审核状态为 ${version.review_status}，仅审核通过的版本可生成向量`,
      409
    );
  }

  const ap_opts = {
    triggeredBy: (opts && opts.triggeredBy) || null,
  };
  const task = ap.createTask({
    versionId,
    documentId: version.document_id,
    triggeredBy: ap_opts.triggeredBy,
  });

  // 异步执行：推到下一个事件循环，HTTP 响应可立即返回
  setImmediate(() => {
    try {
      ap.runTask(task.task_id, klPipeline);
      // 全部成功后形成正式版本号
      const final = ap.getTask(task.task_id);
      if (final && final.status === 'success') {
        markVersionProcessingComplete(versionId);
        updateDocumentVersion(versionId, {
          processing_status: PROCESSING_STATUS.SUCCESS,
        });
      } else if (final && final.status === 'failed') {
        updateDocumentVersion(versionId, {
          processing_status: PROCESSING_STATUS.FAILED,
        });
      }
    } catch (e) {
      // runTask 内部已经处理，这里只兜底
      console.error('[generateVectors] 任务执行异常:', e.message);
    }
  });

  return task;
}

/** 给 async-processor.runTask 提供的"四阶段函数集"对象 */
const klPipeline = {
  standardizeDocument,
  chunkingDocument,
  recognizeChunkMeta,
  embedChunksForVersion,
};

/**
 * 获取某 versionId 的当前处理状态。
 * 返回：
 *   {
 *     versionId,
 *     reviewStatus, processingStatus, onlineStatus,
 *     status: 'not_started' | 'processing' | 'success' | 'failed',
 *     progress, currentPhase, phases, taskId, error
 *   }
 */
function getProcessingStatus(versionId) {
  const version = getDocumentVersion(versionId);
  if (!version) {
    return { versionId, status: 'not_found', error: '版本不存在' };
  }

  const task = ap.getLatestTaskByVersion(versionId);
  if (!task) {
    return {
      versionId,
      reviewStatus: version.review_status,
      processingStatus: version.processing_status,
      onlineStatus: version.online_status,
      status: 'not_started',
      progress: 0,
      currentPhase: null,
      phases: [],
      taskId: null,
    };
  }

  return {
    versionId,
    reviewStatus: version.review_status,
    processingStatus: version.processing_status,
    onlineStatus: version.online_status,
    status: task.status,
    progress: task.progress,
    currentPhase: task.currentPhase,
    phases: task.phases.map((p) => ({
      name: p.name,
      status: p.status,
      startedAt: p.startedAt,
      finishedAt: p.finishedAt,
      error: p.error,
    })),
    taskId: task.task_id,
    error: task.error,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

/**
 * 从失败阶段重试（需求第 18 节）。
 *
 * 行为：
 *   1. 找到该 versionId 对应的最新失败任务
 *   2. 找到失败阶段
 *   3. 创建新任务，从失败阶段开始执行（上游已成功阶段保持 success 不重跑）
 *   4. 异步执行
 *
 * @param {string} versionId
 * @param {string} [phase] 从哪个阶段开始；不传则自动定位第一个失败阶段
 * @returns {Object} 新任务对象
 */
function retryFromPhase(versionId, phase) {
  const last = ap.getLatestTaskByVersion(versionId);
  if (!last) throw fail(`版本 ${versionId} 没有可重试的任务`, 404);
  if (last.status !== 'failed') throw fail(`最新任务状态为 ${last.status}，仅 failed 任务可重试`, 409);

  // 定位失败阶段
  let fromPhase = phase;
  if (!fromPhase) {
    const failedPhase = last.phases.find((p) => p.status === 'failed');
    if (!failedPhase) throw fail(`未找到失败阶段`, 400);
    fromPhase = failedPhase.name;
  }

  const task = ap.createTask({
    versionId,
    documentId: last.document_id,
    triggeredBy: last.triggeredBy,
  });

  setImmediate(() => {
    try {
      ap.runTask(task.task_id, klPipeline, { fromPhase });
      const final = ap.getTask(task.task_id);
      if (final && final.status === 'success') {
        markVersionProcessingComplete(versionId);
        updateDocumentVersion(versionId, { processing_status: PROCESSING_STATUS.SUCCESS });
      } else if (final && final.status === 'failed') {
        updateDocumentVersion(versionId, { processing_status: PROCESSING_STATUS.FAILED });
      }
    } catch (e) {
      console.error('[retryFromPhase] 任务执行异常:', e.message);
    }
  });

  return task;
}

/** 同步版 generateVectors（用于测试，不走 setImmediate） */
function generateVectorsSync(versionId, opts = {}) {
  const version = getDocumentVersion(versionId);
  if (!version) throw fail(`文档版本不存在: ${versionId}`, 404);
  if (version.review_status !== REVIEW_STATUS.APPROVED) {
    throw fail(`当前审核状态为 ${version.review_status}，仅审核通过的版本可生成向量`, 409);
  }
  const task = ap.createTask({
    versionId,
    documentId: version.document_id,
    triggeredBy: (opts && opts.triggeredBy) || null,
  });
  ap.runTask(task.task_id, klPipeline);
  const final = ap.getTask(task.task_id);
  if (final && final.status === 'success') {
    markVersionProcessingComplete(versionId);
    updateDocumentVersion(versionId, { processing_status: PROCESSING_STATUS.SUCCESS });
  } else if (final && final.status === 'failed') {
    updateDocumentVersion(versionId, { processing_status: PROCESSING_STATUS.FAILED });
  }
  return final;
}



/** 孤儿检测：指向不存在上层记录的记录（不变量 I5） */
function findOrphans() {
  const rawIds = new Set(listAll(LAYERS.RAW).map((r) => r.id));
  const stdIds = new Set(listAll(LAYERS.STD).map((s) => s.id));
  const chunkIds = new Set(listAll(LAYERS.CHUNK).map((c) => c.id));
  const out = [];

  for (const s of listAll(LAYERS.STD)) {
    if (!rawIds.has(s.rawId)) {
      out.push({ layer: LAYERS.STD, id: s.id, missingLayer: LAYERS.RAW, missingId: s.rawId || null });
    }
  }
  for (const c of listAll(LAYERS.CHUNK)) {
    if (!stdIds.has(c.stdId)) {
      out.push({ layer: LAYERS.CHUNK, id: c.id, missingLayer: LAYERS.STD, missingId: c.stdId || null });
    } else if (!rawIds.has(c.rawId)) {
      // stdId 在但冗余的 rawId 断了 —— 一步回溯会失败
      out.push({ layer: LAYERS.CHUNK, id: c.id, missingLayer: LAYERS.RAW, missingId: c.rawId || null });
    }
  }
  for (const v of listAll(LAYERS.VECTOR)) {
    if (!chunkIds.has(v.chunkId)) {
      out.push({ layer: LAYERS.VECTOR, id: v.id, missingLayer: LAYERS.CHUNK, missingId: v.chunkId || null });
    } else if (!stdIds.has(v.stdId)) {
      // chunkId 在但冗余的 stdId 断了 —— 一步回溯到 raw 会失败
      out.push({ layer: LAYERS.VECTOR, id: v.id, missingLayer: LAYERS.STD, missingId: v.stdId || null });
    } else if (!rawIds.has(v.rawId)) {
      // stdId 在但冗余的 rawId 断了 —— 一步回溯到原始文档会失败
      out.push({ layer: LAYERS.VECTOR, id: v.id, missingLayer: LAYERS.RAW, missingId: v.rawId || null });
    }
  }
  return out;
}

/**
 * 检查全部不变量，返回违反项列表（空数组 = 一切正常）。
 * 用于测试与运维自检 —— 迁移脚本跑完也要过这一关。
 * @returns {Array<{code, message, ids}>}
 */
function checkInvariants() {
  const violations = [];
  const raws = listAll(LAYERS.RAW);
  const stds = listAll(LAYERS.STD);
  const chunks = listAll(LAYERS.CHUNK);
  const vectors = listAll(LAYERS.VECTOR);
  const rawById = new Map(raws.map((r) => [r.id, r]));
  const stdById = new Map(stds.map((s) => [s.id, s]));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));

  // I1：同一 rawId 下 isCurrent 的 std 最多 1 条
  const currentByRaw = new Map();
  for (const s of stds) {
    if (!s.isCurrent) continue;
    if (!currentByRaw.has(s.rawId)) currentByRaw.set(s.rawId, []);
    currentByRaw.get(s.rawId).push(s.id);
  }
  for (const [rawId, ids] of currentByRaw) {
    if (ids.length > 1) {
      violations.push({
        code: 'I1',
        message: `原始文档 ${rawId} 下有 ${ids.length} 个生效版本（应最多 1 个），检索会同时命中多个版本`,
        ids,
      });
    }
  }

  // I2：同一 chunkId + model 下 isCurrent 的 vector 最多 1 条
  const currentByChunkModel = new Map();
  for (const v of vectors) {
    if (!v.isCurrent) continue;
    const key = `${v.chunkId}|${v.model}`;
    if (!currentByChunkModel.has(key)) currentByChunkModel.set(key, []);
    currentByChunkModel.get(key).push(v.id);
  }
  for (const [key, ids] of currentByChunkModel) {
    if (ids.length > 1) {
      violations.push({
        code: 'I2',
        message: `片段+模型 ${key} 下有 ${ids.length} 份生效向量（应最多 1 份），同一片段会被召回多次`,
        ids,
      });
    }
  }

  // I3：std 的 bizLine / securityLevel 必须等于其 raw
  for (const s of stds) {
    const raw = rawById.get(s.rawId);
    if (!raw) continue; // 孤儿由 I5 负责报
    for (const f of ['bizLine', 'securityLevel']) {
      if (s[f] !== raw[f]) {
        violations.push({
          code: 'I3',
          message: `标准化文档 ${s.id} 的 ${f}=${s[f]} 与原始文档 ${raw.id} 的 ${raw[f]} 不一致，权限判据不一致等于越权`,
          ids: [s.id],
        });
      }
    }
  }

  // I4：chunk / vector 的 bizLine / securityLevel / status 必须等于其 std
  for (const c of chunks) {
    const std = stdById.get(c.stdId);
    if (!std) continue;
    for (const f of ['bizLine', 'securityLevel', 'status']) {
      if (c[f] !== std[f]) {
        violations.push({
          code: 'I4',
          message: `片段 ${c.id} 的 ${f}=${c[f]} 与标准化文档 ${std.id} 的 ${std[f]} 不一致`,
          ids: [c.id],
        });
      }
    }
  }
  for (const v of vectors) {
    const chunk = chunkById.get(v.chunkId);
    if (!chunk) continue;
    for (const f of ['bizLine', 'securityLevel', 'status']) {
      if (v[f] !== chunk[f]) {
        violations.push({
          code: 'I4',
          message: `向量 ${v.id} 的 ${f}=${v[f]} 与片段 ${chunk.id} 的 ${chunk[f]} 不一致`,
          ids: [v.id],
        });
      }
    }
  }

  // I5：孤儿
  for (const o of findOrphans()) {
    violations.push({
      code: 'I5',
      message: `${o.layer} ${o.id} 指向不存在的${o.missingLayer}记录 ${o.missingId}（溯源断链）`,
      ids: [o.id],
    });
  }

  // I6（自下往上核对）：可检索集合里每条向量，其所属 std 必须是 RETRIEVABLE 且 isCurrent。
  // 旧实现是恒真死代码：listRetrievableVectors() 已经按同样的谓词过滤过，
  // 再断言谓词永远为真，所以 I6 实际上从未被自检覆盖。
  // 现在改成"列表里有，但上游已经下架"才报 —— 这才是真实会失败的检查。
  for (const v of listRetrievableVectors()) {
    const chunk = chunkById.get(v.chunkId);
    if (!chunk) continue; // 孤儿由 I5 报
    const std = stdById.get(chunk.stdId);
    if (!std) continue;
    if (!RETRIEVABLE.includes(std.status) || !std.isCurrent) {
      violations.push({
        code: 'I6',
        message: `向量 ${v.id} 仍在检索池，但所属版本 ${std.id} 状态=${std.status}, isCurrent=${!!std.isCurrent}（已下架/已让位的版本不应再有可检索向量）`,
        ids: [v.id],
      });
    }
  }

  // I7：raw.currentStdId 必须等于该 raw 下 isCurrent 的 std 的 id，或两者同时为空
  for (const raw of raws) {
    const current = stds.find((s) => s.rawId === raw.id && s.isCurrent);
    const currentId = current ? current.id : null;
    if ((raw.currentStdId || null) !== currentId) {
      violations.push({
        code: 'I7',
        message: `原始文档 ${raw.id} 的 currentStdId=${raw.currentStdId || 'null'} 与实际生效版本 ${currentId || 'null'} 不一致（影响预览、reprocess 路由都会出错）`,
        ids: [raw.id],
      });
    }
  }

  return violations;
}

module.exports = {
  // 常量
  LAYERS,
  TABLES,
  RAW_STATUS,
  STD_STATUS,
  RETRIEVABLE,
  TRANSITIONS,
  // M3: 三元状态常量
  REVIEW_STATUS,
  PROCESSING_STATUS,
  ONLINE_STATUS,
  // M3: Document / DocumentVersion 实体
  createDocument,
  getDocument,
  listDocuments,
  createDocumentVersion,
  getDocumentVersion,
  listVersionsByDocument,
  listVersionsByReviewStatus,
  updateDocumentVersion,
  markVersionProcessingComplete,
  // 第一层
  createRaw,
  markParseFailed,
  markReady,
  getRaw,
  // 第二层
  createStdVersion,
  setStdStatus,
  publishStd,
  archiveStd,
  markNeedReview,
  rollbackToVersion,
  getStd,
  listStdByRaw,
  // 第三层
  createChunks,
  getChunk,
  listChunksByStd,
  // 第四层
  createVector,
  createVectors,
  createVectorsBatch,
  listVectorsByChunk,
  listRetrievableVectors,
  markChunksEmbedded,
  // 级联
  deleteRawCascade,
  deleteStdCascade,
  // 自检
  findOrphans,
  checkInvariants,
  // 别名 / 便捷读取
  listRaws: () => listAll(LAYERS.RAW),
  listStds: () => listAll(LAYERS.STD),
  listChunks: () => listAll(LAYERS.CHUNK),
  listVectors: () => listAll(LAYERS.VECTOR),
  // 内部读取（traceability 与迁移脚本用，不建议业务代码直接调）
  listAll,
  // M4: 异步处理链路
  getRawByVersionId,
  getStdByVersionId,
  standardizeDocument,
  chunkingDocument,
  recognizeChunkMeta,
  embedChunksForVersion,
  generateVectors,
  generateVectorsSync,
  getProcessingStatus,
  retryFromPhase,
};
