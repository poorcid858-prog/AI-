/**
 * AI 能力中心可编辑 —— 能力存储引擎（Skill / Prompt）
 *
 * 职责：
 *   - 用 lib/store.js 存能力定义（data/capabilities.json）与审计日志（data/capability-audit.json）
 *   - 每个能力含生效版（published）+ 草稿版（draft）+ 历史版本（history）
 *   - 草稿可编辑、试跑、发布、弃稿；历史可回滚（回滚生成新草稿，需手动发布）
 *   - 全部写操作记录审计日志
 *
 * 设计要点：
 *   - 复用 lib/prompt-engine.js 的 SKILLS 做首次初始化默认能力（4 个角色 skill）
 *   - 复用 lib/rag-engine.js 做试跑时的 RAG 检索（mock 环境无数据时静默降级到 []）
 *   - 复用 lib/prompt-engine.js 的 assemblePrompt 思路做试跑 prompt 组装，
 *     但不强绑定 —— 用能力 content 自身字段组装，兼容 skill 与 prompt 两种形态
 *   - 版本号 = 生效版.version + 1（连续单调递增，不因回滚重置）
 *   - 全部异常路径（能力不存在 / 无草稿）抛带 status 的错误，由路由层转 HTTP 码
 *
 * 零新依赖：仅用 store / prompt-engine / rag-engine。
 */

"use strict";

const store = require("./store");
const promptEngine = require("./prompt-engine");

const CAPABILITIES_FILE = "capabilities";
const AUDIT_FILE = "capability-audit";
const DEFAULT_MAX_HISTORY = 10;

// ============================================================
// 1. 默认能力初始化
// ============================================================

/**
 * 首次启动时，从 prompt-engine.SKILLS 生成 4 个默认 skill 能力。
 * 每个 skill 的内容就是 SKILLS[role] 对象（role/title/description/outputFormat）。
 * @returns {Object[]} 默认能力数组
 */
function getDefaultCapabilities() {
  const skills = promptEngine.SKILLS || {};
  const now = new Date().toISOString();
  return Object.entries(skills).map(([role, skill]) => ({
    id: `skill_${role}`,
    type: "skill",
    name: `${skill.title} Skill`,
    description: `${skill.title}的角色设定与任务指令`,
    published: {
      version: 1,
      content: JSON.parse(JSON.stringify(skill)),
      publishedAt: now,
      publishedBy: "system",
    },
    draft: null,
    history: [],
    maxHistory: DEFAULT_MAX_HISTORY,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * 读取所有能力。文件为空时初始化默认能力并写盘。
 * @returns {Object[]} 能力数组
 */
function listCapabilities() {
  const caps = store.read(CAPABILITIES_FILE, []);
  if (!Array.isArray(caps) || caps.length === 0) {
    const defaults = getDefaultCapabilities();
    store.write(CAPABILITIES_FILE, defaults);
    return defaults;
  }
  return caps;
}

/** 写回能力数组（内部辅助） */
function saveCapabilities(caps) {
  store.write(CAPABILITIES_FILE, caps);
}

/** 写回审计日志（内部辅助） */
function appendAuditLog(entry) {
  const logs = store.read(AUDIT_FILE, []);
  logs.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  store.write(AUDIT_FILE, logs);
}

/**
 * 能力列表摘要（给前端用，不含生效版/草稿的内容细节）。
 * @returns {Object[]} 摘要数组
 */
function listCapabilitySummaries() {
  return listCapabilities().map((c) => ({
    id: c.id,
    type: c.type,
    name: c.name,
    description: c.description,
    hasDraft: c.draft !== null && c.draft !== undefined,
    publishedVersion: c.published ? c.published.version : null,
    draftVersion: c.draft ? c.draft.version : null,
    updatedAt: c.updatedAt,
  }));
}

/**
 * 读取单个能力。
 * @param {string} id 能力 ID（如 skill_product）
 * @returns {Object|null} 能力对象；不存在返回 null
 */
function getCapability(id) {
  const caps = listCapabilities();
  if (!Array.isArray(caps)) return null;
  return caps.find((c) => c && c.id === id) || null;
}

/** 抛带 HTTP status 的错误（供路由层转码） */
function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

// ============================================================
// 2. 草稿管理
// ============================================================

/**
 * 编辑草稿：有则更新，无则创建。版本号 = 生效版.version + 1。
 * 记录审计日志。
 * @param {string} capId
 * @param {object} content 新草稿内容
 * @param {string} editedBy 操作人标识
 * @returns {Object} 更新后的能力
 */
function editDraft(capId, content, editedBy) {
  const caps = listCapabilities();
  const idx = (Array.isArray(caps) ? caps : []).findIndex((c) => c && c.id === capId);
  if (idx === -1) throw fail("能力不存在", 404);

  const cap = caps[idx];
  const newVersion = cap.published ? cap.published.version + 1 : 1;
  cap.draft = {
    version: newVersion,
    content: JSON.parse(JSON.stringify(content)), // 深拷贝，避免外部引用串改
    updatedAt: new Date().toISOString(),
  };
  cap.updatedAt = new Date().toISOString();
  saveCapabilities(caps);

  appendAuditLog({
    action: "edit_draft",
    capId,
    editedBy,
    version: newVersion,
    detail: "保存草稿",
  });
  return cap;
}

/**
 * 获取草稿内容。能力不存在抛 404；无草稿返回 null。
 * @param {string} capId
 * @returns {object|null}
 */
function getDraft(capId) {
  const cap = getCapability(capId);
  if (!cap) throw fail("能力不存在", 404);
  return cap.draft || null;
}

/**
 * 获取生效版内容。能力不存在抛 404。
 * @param {string} capId
 * @returns {object}
 */
function getPublished(capId) {
  const cap = getCapability(capId);
  if (!cap) throw fail("能力不存在", 404);
  return cap.published;
}

/**
 * 弃稿：删除草稿，生效版不变。记录审计日志。
 * @param {string} capId
 * @param {string} editedBy
 * @returns {Object} 更新后的能力
 */
function discardDraft(capId, editedBy) {
  const caps = listCapabilities();
  const idx = (Array.isArray(caps) ? caps : []).findIndex((c) => c && c.id === capId);
  if (idx === -1) throw fail("能力不存在", 404);
  if (!caps[idx].draft) throw fail("没有草稿可弃", 400);

  delete caps[idx].draft;
  caps[idx].updatedAt = new Date().toISOString();
  saveCapabilities(caps);

  appendAuditLog({
    action: "discard_draft",
    capId,
    editedBy,
    detail: "弃稿",
  });
  return caps[idx];
}

// ============================================================
// 3. 发布与版本管理
// ============================================================

/**
 * 发布：草稿 → 生效版，旧生效版 → 历史（截断到 maxHistory）。
 * 记录审计日志。
 * @param {string} capId
 * @param {string} publishedBy
 * @returns {Object} 更新后的能力
 */
function publishDraft(capId, publishedBy) {
  const caps = listCapabilities();
  const idx = (Array.isArray(caps) ? caps : []).findIndex((c) => c && c.id === capId);
  if (idx === -1) throw fail("能力不存在", 404);
  if (!caps[idx].draft) throw fail("没有草稿可发布", 400);

  const cap = caps[idx];
  const oldVersion = cap.published ? cap.published.version : 0;
  const now = new Date().toISOString();

  // 旧生效版 → 历史
  const history = Array.isArray(cap.history) ? cap.history : [];
  if (cap.published) history.push({ ...cap.published });
  while (history.length > (cap.maxHistory || DEFAULT_MAX_HISTORY)) history.shift();

  // 草稿 → 生效版
  cap.published = {
    version: cap.draft.version,
    content: JSON.parse(JSON.stringify(cap.draft.content)),
    publishedAt: now,
    publishedBy,
  };
  cap.draft = null;
  cap.history = history;
  cap.updatedAt = now;
  saveCapabilities(caps);

  appendAuditLog({
    action: "publish",
    capId,
    publishedBy,
    version: cap.published.version,
    oldVersion,
    detail: "发布生效",
  });
  return cap;
}

/**
 * 回滚：用目标版本内容创建新草稿（不直接生效，需手动发布）。
 * 记录审计日志。
 * @param {string} capId
 * @param {number} targetVersion 回滚到的目标版本号
 * @param {string} publishedBy
 * @returns {Object} 更新后的能力
 */
function rollbackToVersion(capId, targetVersion, publishedBy) {
  const caps = listCapabilities();
  const idx = (Array.isArray(caps) ? caps : []).findIndex((c) => c && c.id === capId);
  if (idx === -1) throw fail("能力不存在", 404);
  const cap = caps[idx];

  // 在生效版 + 历史里找目标版本内容
  let targetContent = null;
  let targetVer = null;
  if (cap.published && cap.published.version === targetVersion) {
    targetContent = cap.published.content;
    targetVer = cap.published.version;
  }
  if (!targetContent && Array.isArray(cap.history)) {
    const found = cap.history.find((h) => h.version === targetVersion);
    if (found) {
      targetContent = found.content;
      targetVer = found.version;
    }
  }
  if (targetContent === null) throw fail("目标版本不存在", 404);

  const newVersion = cap.published ? cap.published.version + 1 : 1;
  cap.draft = {
    version: newVersion,
    content: JSON.parse(JSON.stringify(targetContent)),
    updatedAt: new Date().toISOString(),
    rollbackFrom: targetVer,
  };
  cap.updatedAt = new Date().toISOString();
  saveCapabilities(caps);

  appendAuditLog({
    action: "rollback",
    capId,
    publishedBy,
    rollbackToVersion: targetVer,
    draftVersion: newVersion,
    detail: `回滚到 v${targetVer}`,
  });
  return cap;
}

/**
 * 获取审计日志，支持按 capId 过滤 + limit 截断（最新的在前）。
 * @param {object} [options]
 * @param {string} [options.capId]
 * @param {number} [options.limit=50]
 * @returns {Object[]}
 */
function getAuditLog(options = {}) {
  const logs = store.read(AUDIT_FILE, []);
  const { capId, limit = 50 } = options;
  let filtered = Array.isArray(logs) ? logs : [];
  if (capId) filtered = filtered.filter((l) => l && l.capId === capId);
  return filtered.slice(-limit).reverse();
}

/**
 * 获取版本历史：生效版 + 草稿 + 历史，按版本号倒序。
 * @param {string} capId
 * @returns {Object[]}
 */
function getVersionHistory(capId) {
  const cap = getCapability(capId);
  if (!cap) throw fail("能力不存在", 404);

  const versions = [];
  if (cap.published) {
    versions.push({
      version: cap.published.version,
      status: "published",
      content: cap.published.content,
      publishedAt: cap.published.publishedAt,
      publishedBy: cap.published.publishedBy,
    });
  }
  if (cap.draft) {
    versions.push({
      version: cap.draft.version,
      status: "draft",
      content: cap.draft.content,
      updatedAt: cap.draft.updatedAt,
    });
  }
  if (Array.isArray(cap.history)) {
    for (const h of cap.history) {
      versions.push({
        version: h.version,
        status: "history",
        content: h.content,
        publishedAt: h.publishedAt,
        publishedBy: h.publishedBy,
      });
    }
  }
  return versions.sort((a, b) => (b.version || 0) - (a.version || 0));
}

// ============================================================
// 4. 试跑
// ============================================================

/**
 * 用某份能力 content 组装 prompt（与 prompt-engine.assemblePrompt 思路一致，
 * 但基于能力 content 自身字段，兼容 skill 与 prompt 两种形态）。
 * @param {object} content 能力内容
 * @param {string} question 试跑问题
 * @param {string} role 角色
 * @param {string} bizLine 业务线
 * @param {Array} ragChunks RAG 召回
 * @returns {string} prompt 字符串
 */
function assemblePromptFromCap(content, question, role, bizLine, ragChunks) {
  const title = (content && content.title) || role;
  const description = (content && content.description) || "";
  const outputFormat = (content && content.outputFormat) || "";
  const sections = [
    `[角色与业务线] 你是一名${title}，服务于${bizLine}业务线。`,
    ``,
    `[角色设定] ${description}`.trim(),
    ``,
    `[输出格式要求]`,
    outputFormat || "（无格式要求）",
    ``,
    `[RAG 召回的知识]`,
    ragChunks && ragChunks.length > 0
      ? ragChunks.map((c, i) => `[${i + 1}] ${(c && c.heading) || ""}\n${(c && c.content) || ""}`).join("\n\n")
      : "（无 RAG 召回）",
    ``,
    `[用户问题]`,
    question || "",
  ];
  return sections.join("\n");
}

/**
 * 生成 mock 模式下的模拟输出。
 * @param {string} _prompt 未实际用到（mock），保留签名一致性
 * @param {string} role 角色
 * @param {string} question 用户问题
 * @returns {object}
 */
function generateMockResult(_prompt, role, question) {
  const now = new Date().toISOString();
  return {
    content:
      `## 模拟输出（${role}）\n\n基于您的需求：${question}\n\n` +
      `> 这是 mock 模式下的模拟生成结果。\n\n` +
      `### 1. 需求分析\n\n根据您的问题，以下是初步分析...\n\n` +
      `### 2. 详细方案\n\n（此处为模拟内容，实际部署到真实 LLM 后会生成真实结果）\n\n` +
      `---\n*生成时间：${now}*`,
    mock: true,
    generatedAt: now,
  };
}

/**
 * 试跑：用草稿版 + 生效版各组装 prompt 并生成 mock 结果，供并排对比。
 * RAG 检索走 lib/rag-engine（无数据/异常时静默降级到 []，与项目原则一致）。
 * @param {string} capId
 * @param {string} testQuestion
 * @param {string} role
 * @param {string} bizLine
 * @returns {{draft: {prompt:string, result:object}, published: {prompt:string, result:object}|null, ragChunks: Array}}
 */
function trialRun(capId, testQuestion, role, bizLine) {
  const cap = getCapability(capId);
  if (!cap) throw fail("能力不存在", 404);
  if (!cap.draft) throw fail("没有草稿可试跑", 400);

  // RAG 检索：mock 环境可能无数据，静默降级到 []
  const rag = (() => {
    try { return require("./rag-engine"); } catch (_) { return null; }
  })();
  const ragChunks = (() => {
    if (!rag || !rag.loadApprovedIndex || !rag.retrieve) return [];
    try {
      const index = rag.loadApprovedIndex();
      const results = rag.retrieve({ role: "admin", accessibleBizLines: ["trade", "membership", "all"], maxSecurityLevel: 3, isAdmin: true }, testQuestion, index, 5);
      if (!Array.isArray(results)) return [];
      return results.map((r) => ({ heading: r.heading, content: r.content, score: r.score }));
    } catch (_) {
      return [];
    }
  })();

  const draftPrompt = assemblePromptFromCap(cap.draft.content, testQuestion, role, bizLine, ragChunks);
  const draftResult = generateMockResult(draftPrompt, role, testQuestion);

  const publishedPrompt = cap.published
    ? assemblePromptFromCap(cap.published.content, testQuestion, role, bizLine, ragChunks)
    : null;
  const publishedResult = publishedPrompt
    ? generateMockResult(publishedPrompt, role, testQuestion)
    : null;

  return {
    draft: { prompt: draftPrompt, result: draftResult },
    published: publishedPrompt ? { prompt: publishedPrompt, result: publishedResult } : null,
    ragChunks,
  };
}

// ============================================================
// 5. 文本差异
// ============================================================

/**
 * 简单行级文本差异比较（只标记增删行，不逐词对比）。
 * @param {string} [a]
 * @param {string} [b]
 * @returns {{added:string, removed:string, common?:string}}
 */
function diffTexts(a, b) {
  if (!a && !b) return { added: "", removed: "" };
  if (!a) return { added: b || "", removed: "" };
  if (!b) return { added: "", removed: a || "" };

  const aLines = String(a).split("\n");
  const bLines = String(b).split("\n");
  const added = [];
  const removed = [];
  const common = [];

  let i = 0;
  let j = 0;
  while (i < aLines.length || j < bLines.length) {
    if (i < aLines.length && j < bLines.length && aLines[i] === bLines[j]) {
      common.push(aLines[i]);
      i++;
      j++;
    } else {
      if (i < aLines.length && j < bLines.length) {
        // 两端都有但不等：各自各取一行
        removed.push(aLines[i++]);
        added.push(bLines[j++]);
      } else if (i < aLines.length) {
        removed.push(aLines[i++]);
      } else {
        added.push(bLines[j++]);
      }
    }
  }

  return {
    added: added.join("\n"),
    removed: removed.join("\n"),
    common: common.join("\n"),
  };
}

module.exports = {
  listCapabilities,
  listCapabilitySummaries,
  getCapability,
  editDraft,
  getDraft,
  getPublished,
  discardDraft,
  publishDraft,
  rollbackToVersion,
  getVersionHistory,
  getAuditLog,
  trialRun,
  diffTexts,
  // 辅助导出（便于测试可注入/复用）
  assemblePromptFromCap,
  generateMockResult,
  getDefaultCapabilities,
};