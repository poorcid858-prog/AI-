#!/usr/bin/env node
/**
 * 迁移脚本：旧扁平表 → 四层知识模型
 *
 *   data/documents.json（每条记录内嵌 content 与 chunks）
 *     ↓
 *   1 条 raw_documents  （原文 / 业务线 / 密级 / 标签 / 上传人直接搬）
 *   1 条 std_documents  （procVersion=1，params 取 config.processing 默认值快照）
 *   N 条 chunks         （从旧记录的 chunks 数组搬，补 seq，权限字段由上层继承）
 *   0 条 vectors        （向量在第 12 步统一重建，迁移不生成）
 *     ↓
 *   data/documents.json → data/documents.legacy.json（代码不再读取，留档备查）
 *
 * 依据：docs/技术方案-四层模型.md 第 7 节
 *
 * 三条安全设计：
 *   1. **幂等**：按 fileName（或旧 id）+ createdAt 判重，重复执行不产生重复数据
 *   2. **先自检再改名**：checkInvariants() 有违反项就回滚新建的数据并保留
 *      data/documents.json 不动 —— 旧文件还在，就还能重试
 *   3. 状态一律走 knowledge-layers 的状态机，不直接写 status 字段 ——
 *      直接写就绕过了级联同步，迁移完的片段状态会和版本不一致（不变量 I4）
 *
 * 用法：node scripts/migrate-to-layers.js
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');

const LEGACY_TABLE = 'documents';
const FILE_TYPES = ['md', 'docx', 'pdf', 'pptx', 'txt'];

/** 旧 status → 新 std 状态 + 是否生效 */
const STATUS_MAP = {
  approved: { targetStdStatus: kl.STD_STATUS.PUBLISHED, isCurrent: true },
  pending: { targetStdStatus: kl.STD_STATUS.PENDING, isCurrent: false },
  rejected: { targetStdStatus: kl.STD_STATUS.REJECTED, isCurrent: false },
};

// ============================================================
// 纯函数部分（可单独测试，无副作用）
// ============================================================

/**
 * 判重键。
 * 优先文件名，其次旧记录 id（手工粘贴的内容没有文件名），最后标题。
 * 对"旧记录"和"已迁移出来的 raw 记录"都能算出同一个键 —— 幂等就靠这个对齐。
 */
function legacyKey(rec) {
  const r = rec || {};
  const head = r.fileName || r.legacyId || r.id || r.title || '';
  return `${head}|${r.createdAt || ''}`;
}

/** 从文件名推断文件类型，认不出来按 md 处理（旧表里存的都是 Markdown 正文） */
function inferFileType(fileName) {
  const ext = String(path.extname(fileName || '')).replace('.', '').toLowerCase();
  return FILE_TYPES.includes(ext) ? ext : 'md';
}

/**
 * 一条旧扁平记录 → 四层记录的创建入参（纯函数）。
 *
 * 注意 chunks 里**故意不带** bizLine / securityLevel / status ——
 * 这三个字段由 createChunks 从 std 继承，迁移不许自己填（不变量 I4）。
 *
 * @returns {{raw, std, chunks, targetStdStatus, isCurrent}}
 */
function convertLegacyRecord(old) {
  const doc = old || {};
  const mapped = STATUS_MAP[doc.status] || STATUS_MAP.pending; // 认不出的旧状态兜底为待审核

  return {
    raw: {
      legacyId: doc.id || null,
      title: doc.title || doc.fileName || '未命名文档',
      fileName: doc.fileName || null,
      fileType: inferFileType(doc.fileName),
      fileSize: doc.content ? Buffer.byteLength(String(doc.content), 'utf8') : 0,
      content: typeof doc.content === 'string' ? doc.content : '',
      knowledgeType: 'other',       // 旧表没有知识类型，统一落 other，后续人工归类
      version: null,
      tags: Array.isArray(doc.tags) ? doc.tags : [],
      owner: null,
      validUntil: null,
      uploadedBy: doc.uploadedBy || null,
      bizLine: doc.bizLine,
      securityLevel: doc.securityLevel,
      createdAt: doc.createdAt || null,
    },
    std: {
      // 旧表没有独立的标准化正文，加工版本 v1 就用原文
      content: typeof doc.content === 'string' ? doc.content : '',
      // 契约 7 要求 params 落 config 默认值。这里显式做一份快照（而不是让
      // createStdVersion 兜底），好处是"这批数据是用什么参数迁进来的"在纯函数里就能验证
      params: {
        ...config.processing,
        cleanLevel: { ...config.processing.cleanLevel },
      },
      sections: [],
      processLog: [{
        step: 'migrate',
        action: '从旧扁平表迁入，未重新加工',
        before: doc.id || null,
        after: null,
        at: new Date().toISOString(),
      }],
      qualityScore: null,
      reviewedBy: doc.reviewedBy || null,
      reviewedAt: doc.reviewedAt || null,
      reviewNote: doc.reviewNote || null,
      procVersion: 1,               // 仅作说明，实际由 createStdVersion 计算
    },
    chunks: (Array.isArray(doc.chunks) ? doc.chunks : []).map((c) => ({
      content: c && typeof c.content === 'string' ? c.content : '',
      heading: (c && c.heading) || null,
      sectionPath: (c && Array.isArray(c.sectionPath)) ? c.sectionPath : [],
      keywords: (c && Array.isArray(c.keywords)) ? c.keywords : [],
      fingerprint: (c && c.fingerprint) || undefined,
    })),
    targetStdStatus: mapped.targetStdStatus,
    isCurrent: mapped.isCurrent,
  };
}

// ============================================================
// 落库部分（有副作用）
// ============================================================

/**
 * 把一条旧记录写进四层。返回新建的 raw。
 *
 * 重要：raw id 一旦 createRaw 成功就立刻登记到 createdRawIds（在调用方里做），
 * 后续 createStdVersion/createChunks/状态流转任一步抛错，回滚都会带上这条 raw。
 * 不这么做的话，半截创建的 raw 留在 raw_documents 表里，
 * 判重键会和旧记录撞上，重试时这条被 skip，std 永远停在 draft，片段永远为 0。
 */
function applyOne(old, createdRawIds) {
  const conv = convertLegacyRecord(old);
  const S = kl.STD_STATUS;

  const raw = kl.createRaw(conv.raw);
  // raw 一落地就登记，后续失败回滚就不会漏
  if (Array.isArray(createdRawIds)) createdRawIds.push(raw.id);
  kl.markReady(raw.id);                       // 旧数据已经解析过了

  const std = kl.createStdVersion(raw.id, conv.std);
  kl.createChunks(std.id, conv.chunks);

  const meta = {
    reviewedBy: conv.std.reviewedBy,
    reviewedAt: conv.std.reviewedAt,
    reviewNote: conv.std.reviewNote,
  };
  // 一律沿合法路径推进，不直接写 status —— 这样级联同步才会跑到
  switch (conv.targetStdStatus) {
    case S.PUBLISHED:
      kl.setStdStatus(std.id, S.PENDING);
      kl.setStdStatus(std.id, S.APPROVED, meta);
      kl.publishStd(std.id);
      break;
    case S.REJECTED:
      kl.setStdStatus(std.id, S.PENDING);
      kl.setStdStatus(std.id, S.REJECTED, meta);
      break;
    case S.PENDING:
    default:
      kl.setStdStatus(std.id, S.PENDING);
      break;
  }
  return { raw, std, chunkCount: conv.chunks.length };
}

/**
 * 执行迁移。
 *
 * ⚠️ 闸门：默认 require 不会真的执行迁移。必须显式传 { confirmed: true } 才会落库。
 * 原因是当前 lib/documents.js / routes/* 还全在读旧的 documents 表，
 * 迁移一执行会让运行中的应用立刻变成空知识库。等下一批把上传/审核/检索
 * 接到新结构上后这道闸门才需要拆。
 *
 * @param {Object} [opts] { silent, confirmed }
 * @returns {{total, migrated, skipped, chunkCount, violations, renamed, gated}}
 */
function migrate(opts) {
  const silent = !!(opts && opts.silent);
  const log = (...a) => { if (!silent) console.log(...a); };

  const legacyPath = store.filePath(LEGACY_TABLE);
  const targetPath = path.join(config.paths.data, 'documents.legacy.json');

  // 闸门：未确认则只打警告，什么都不做
  if (!opts || opts.confirmed !== true) {
    log('[迁移] 未确认 — 闸门已拦截');
    log('[迁移] 原因：上传 / 审核 / 检索 三条流程尚未接到新的四层结构，');
    log('[迁移]       执行迁移后应用会读到空知识库（旧表被改名、新表还没人读）。');
    log('[迁移] 如确认要执行，请传 { confirmed: true } 或设环境变量 CONFIRM_MIGRATE=1。');
    return { total: 0, migrated: 0, skipped: 0, chunkCount: 0, violations: [], renamed: false, blocked: true };
  }

  const result = { total: 0, migrated: 0, skipped: 0, chunkCount: 0, violations: [], renamed: false };

  if (!fs.existsSync(legacyPath)) {
    log(`[迁移] 未找到 ${legacyPath}，无需迁移（可能已经迁过了）`);
    return result;
  }

  store.clearCache();
  const legacy = store.read(LEGACY_TABLE, []);
  if (!Array.isArray(legacy)) {
    throw new Error(`[迁移] ${legacyPath} 不是数组，拒绝继续`);
  }
  result.total = legacy.length;

  // 幂等：已迁移过的旧记录（同判重键）跳过
  const existingKeys = new Set(kl.listAll(kl.LAYERS.RAW).map(legacyKey));

  const createdRawIds = [];
  try {
    for (const old of legacy) {
      const key = legacyKey(old);
      if (existingKeys.has(key)) {
        result.skipped += 1;
        log(`[迁移] 跳过已存在: ${key}`);
        continue;
      }
      // raw 一创建成功就在 applyOne 内登记，半截失败回滚时不会漏
      const { raw, std, chunkCount } = applyOne(old, createdRawIds);
      existingKeys.add(key);
      result.migrated += 1;
      result.chunkCount += chunkCount;
      log(`[迁移] ${old.id} → ${raw.id} / ${std.id} / ${chunkCount} 个片段`);
    }
  } catch (err) {
    rollback(createdRawIds, log);
    throw err;
  }

  // 自检：有违反项就回滚，并且**不重命名**旧文件 —— 旧文件还在就能重试
  result.violations = kl.checkInvariants();
  if (result.violations.length > 0) {
    log('[迁移] 完整性自检未通过，已回滚，data/documents.json 保持原样：');
    for (const v of result.violations) log(`  - [${v.code}] ${v.message}`);
    rollback(createdRawIds, log);
    const err = new Error(`[迁移] 完整性自检未通过（${result.violations.length} 项），已回滚`);
    err.violations = result.violations;
    throw err;
  }

  // 只有全绿才动旧文件
  fs.renameSync(legacyPath, targetPath);
  store.clearCache();
  result.renamed = true;
  log(`[迁移] 完成：新增 ${result.migrated} 篇（跳过 ${result.skipped} 篇），${result.chunkCount} 个片段`);
  log(`[迁移] 旧表已改名为 ${targetPath}，代码不再读取`);
  return result;
}

/** 回滚本次新建的数据（级联删除，连带 std / chunk / vector） */
function rollback(rawIds, log) {
  for (const id of rawIds) {
    const c = kl.deleteRawCascade(id);
    log(`[迁移][回滚] 删除 ${id}：${c.stdCount} 版本 / ${c.chunkCount} 片段 / ${c.vectorCount} 向量`);
  }
}

// 只有直接执行（带确认闸门）才跑迁移
if (require.main === module) {
  const confirmed = process.env.CONFIRM_MIGRATE === '1';
  try {
    migrate({ confirmed });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { migrate, convertLegacyRecord, legacyKey, inferFileType, STATUS_MAP };
