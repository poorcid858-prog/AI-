/**
 * 聊天历史 + 常用问题频次 — 数据层（B1）
 *
 * 存档 data/qa-history.json（对话流）+ 频次 data/qa-frequency.json（常用问题 top N）。
 * 集成 lib/store.js（read/write 全量覆盖），不引入新依赖。
 *
 * 设计要点：
 *   - appendRecord：缺必填字段抛 Error（fail fast，不静默）
 *   - listBySession：按 turn 升序，同 turn 时 user 在 ai 前
 *   - listSessions：按 lastTimestamp 倒序，summary = 该 session 第一条 user content 前 50 字
 *   - trim：整 session 删（不切一半），按 lastTimestamp 保留前 sessionCap 个 session
 *   - frequency：归一化（lowerCase + 去所有空白），按 count desc, lastAsked desc 取 top N
 *
 * 数据结构（与《技术方案-聊天控制台.md》1.1 / 1.2 严格一致）：
 *   qa-history.json: { version, updatedAt, records: Record[] }
 *   qa-frequency.json: { version, updatedAt, byRole: { [role]: Entry[] } }
 */

'use strict';

const store = require('./store');

/** 聊天历史 record 必填字段（缺则抛 Error） */
const REQUIRED_FIELDS = ['id', 'sessionId', 'turn', 'type', 'content', 'timestamp', 'role', 'bizLine', 'userId'];

function emptyHistory() {
  return { version: 1, updatedAt: new Date().toISOString(), records: [] };
}

function emptyFrequency() {
  return { version: 1, updatedAt: new Date().toISOString(), byRole: {} };
}

function readHistory() {
  const v = store.read('qa-history', emptyHistory());
  // 兜底：被读到一个不带 records 的对象时也补全形状
  if (!v || !Array.isArray(v.records)) return emptyHistory();
  return v;
}

function writeHistory(data) {
  data.version = 1;
  data.updatedAt = new Date().toISOString();
  return store.write('qa-history', data);
}

function readFrequency() {
  const v = store.read('qa-frequency', emptyFrequency());
  if (!v || typeof v !== 'object' || !v.byRole || typeof v.byRole !== 'object') return emptyFrequency();
  return v;
}

function writeFrequency(data) {
  data.version = 1;
  data.updatedAt = new Date().toISOString();
  return store.write('qa-frequency', data);
}

/**
 * 文本归一化：lowerCase + 去所有空白（空格 / Tab / 换行）。
 * 例："退款流程 PRD" → "退款流程prd"，"退款流程PRD" → "退款流程prd" 视为同一条。
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text == null ? '' : text).toLowerCase().replace(/\s+/g, '');
}

/**
 * 追加 1 条 record 到 data/qa-history.json。缺必填字段抛 Error（fail fast）。
 * @param {object} record 必填：id, sessionId, turn, type, content, timestamp, role, bizLine, userId
 * @returns {object} 原 record（未做字段裁剪，由调用方决定形状）
 */
function appendRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('record 必须是对象');
  }
  for (const f of REQUIRED_FIELDS) {
    if (record[f] === undefined || record[f] === null || record[f] === '') {
      throw new Error(`record 缺少必填字段: ${f}`);
    }
  }
  const data = readHistory();
  data.records.push({ ...record });
  writeHistory(data);
  return record;
}

/**
 * 读一个 session 全部 record，按 turn 升序（同 turn：user 在 ai 前）。
 * @param {string} sessionId
 * @returns {object[]}
 */
function listBySession(sessionId) {
  const data = readHistory();
  return data.records
    .filter((r) => r.sessionId === sessionId)
    .slice()
    .sort((a, b) => {
      if (a.turn !== b.turn) return a.turn - b.turn;
      if (a.type !== b.type) return a.type === 'user' ? -1 : 1; // user 在前
      return String(a.timestamp).localeCompare(String(b.timestamp));
    });
}

/**
 * 读 session 列表（按 lastTimestamp 倒序；返回供侧边栏显示的元信息）。
 * summary = 该 session 第一条 type='user' 的 content 截前 50 字。
 * @param {number} limit 默认 100
 * @returns {Array<{sessionId:string, lastTimestamp:string, recordCount:number, summary:string}>}
 */
function listSessions(limit = 100) {
  const data = readHistory();
  // 一次扫描算每 session 的 lastTimestamp / recordCount / 首条 user content
  // 按时间升序遍历，记录第一条 user
  const grouped = new Map();
  // records 的写入顺序大致就是时间顺序，但仍稳妥按 timestamp 升序排
  const sorted = data.records.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  for (const r of sorted) {
    let g = grouped.get(r.sessionId);
    if (!g) {
      g = { sessionId: r.sessionId, lastTimestamp: r.timestamp, recordCount: 0, firstUserContent: null };
      grouped.set(r.sessionId, g);
    }
    g.recordCount += 1;
    if (String(r.timestamp) > String(g.lastTimestamp)) g.lastTimestamp = r.timestamp;
    if (g.firstUserContent === null && r.type === 'user') g.firstUserContent = r.content;
  }
  return [...grouped.values()]
    .map((g) => ({
      sessionId: g.sessionId,
      lastTimestamp: g.lastTimestamp,
      recordCount: g.recordCount,
      summary: g.firstUserContent == null ? '' : String(g.firstUserContent).slice(0, 50),
    }))
    .sort((a, b) => String(b.lastTimestamp).localeCompare(String(a.lastTimestamp)))
    .slice(0, limit);
}

/**
 * 容量控制：整 session 删（不能切一半）。
 * 算法：
 *   1) 算每 session 的 lastTimestamp（max）
 *   2) 按 lastTimestamp 倒序排 session
 *   3) 保留前 sessionCap 个 session 的全部 record，删其余
 * @param {object} opts
 * @param {number} [opts.sessionCap=100]  保留的 session 数
 * @param {number} [opts.historyCap=1000] 占位（B1 不做 per-session 内裁剪）
 */
function trim({ sessionCap = 100, historyCap = 1000 } = {}) {
  const data = readHistory();
  if (data.records.length === 0) return data;
  // 算每 session 的 lastTimestamp
  const lastTs = new Map();
  for (const r of data.records) {
    const cur = lastTs.get(r.sessionId);
    if (cur === undefined || String(r.timestamp) > String(cur)) {
      lastTs.set(r.sessionId, r.timestamp);
    }
  }
  // 按 lastTimestamp 倒序排 session
  const sortedSessions = [...lastTs.entries()]
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])))
    .map((e) => e[0]);
  // 保留前 sessionCap 个
  const keep = new Set(sortedSessions.slice(0, sessionCap));
  const next = data.records.filter((r) => keep.has(r.sessionId));
  if (next.length === data.records.length) return data;
  const nextData = { ...data, records: next };
  writeHistory(nextData);
  return nextData;
}

/**
 * 频次 +1。归一化后写对应 role 条目。
 * - 同 role + 同 text（已归一化）：count +1，更新 lastAsked
 * - 新条目：count=1，lastAsked=now
 * - 空字符串 / null：静默丢弃（不入库）
 * @param {string} role
 * @param {string} text
 */
function incrementFrequency(role, text) {
  const norm = normalize(text);
  if (!norm) return;
  const data = readFrequency();
  if (!data.byRole[role]) data.byRole[role] = [];
  const list = data.byRole[role];
  const nowIso = new Date().toISOString();
  const exist = list.find((e) => e.text === norm);
  if (exist) {
    exist.count += 1;
    exist.lastAsked = nowIso;
  } else {
    list.push({ text: norm, count: 1, lastAsked: nowIso });
  }
  writeFrequency(data);
}

/**
 * 取 top N（count desc, lastAsked desc）。
 * @param {string} role
 * @param {number} n 默认 10
 * @returns {Array<{text:string, count:number, lastAsked:string}>}
 */
function getTopFrequency(role, n = 10) {
  const data = readFrequency();
  const list = (data.byRole && data.byRole[role]) || [];
  return list
    .slice()
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(b.lastAsked).localeCompare(String(a.lastAsked));
    })
    .slice(0, n)
    .map((e) => ({ text: e.text, count: e.count, lastAsked: e.lastAsked }));
}

module.exports = {
  appendRecord,
  listBySession,
  listSessions,
  trim,
  incrementFrequency,
  getTopFrequency,
  normalize,
};
