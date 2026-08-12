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

/** 字符串类必填字段 —— 必须是 string */
const STRING_REQUIRED = ['id', 'sessionId', 'type', 'role', 'bizLine', 'userId'];

/** type 枚举 */
const VALID_TYPE = new Set(['user', 'ai']);

/** feedback 枚举 */
const VALID_FEEDBACK = new Set([null, 'up', 'down']);

/**
 * 校验 1 条 record 字段类型 + 必填（B1 amend：先类型校验后空校验）。
 * 校验失败抛 Error（fail fast），不落盘。
 * - STRING_REQUIRED：typeof === 'string'，且非空
 * - turn：Number.isInteger
 * - type：枚举 user / ai
 * - content / timestamp：非空字符串（允许多行文本 / ISO 格式）
 * - 可选 qualityScore：0-10 整数
 * - 可选 feedback：null / 'up' / 'down'
 * - 可选 ragChunks：数组
 * - 可选 latencyMs：正整数
 * - 可选 workflowId：字符串或 null
 */
function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('record 必须是对象');
  }
  // 1) 必填字符串字段
  for (const f of STRING_REQUIRED) {
    const v = record[f];
    if (typeof v !== 'string' || v === '') {
      throw new Error(`record 字段 ${f} 必须是非空字符串`);
    }
  }
  // 2) turn
  if (!Number.isInteger(record.turn)) {
    throw new Error('record 字段 turn 必须是整数');
  }
  // 3) type 枚举
  if (!VALID_TYPE.has(record.type)) {
    throw new Error(`record 字段 type 必须是 ${[...VALID_TYPE].join(' 或 ')}`);
  }
  // 4) content / timestamp 必填 + 非空字符串
  if (typeof record.content !== 'string' || record.content === '') {
    throw new Error('record 字段 content 必须是非空字符串');
  }
  if (typeof record.timestamp !== 'string' || record.timestamp === '') {
    throw new Error('record 字段 timestamp 必须是非空字符串（ISO 格式）');
  }
  // 5) 可选字段
  if (record.qualityScore !== undefined && record.qualityScore !== null) {
    if (!Number.isInteger(record.qualityScore) || record.qualityScore < 0 || record.qualityScore > 10) {
      throw new Error('record 字段 qualityScore 必须是 0-10 整数');
    }
  }
  if (record.feedback !== undefined && !VALID_FEEDBACK.has(record.feedback)) {
    throw new Error('record 字段 feedback 必须是 null / up / down');
  }
  if (record.ragChunks !== undefined && record.ragChunks !== null) {
    if (!Array.isArray(record.ragChunks)) {
      throw new Error('record 字段 ragChunks 必须是数组或 null');
    }
  }
  if (record.latencyMs !== undefined && record.latencyMs !== null) {
    if (!Number.isInteger(record.latencyMs) || record.latencyMs <= 0) {
      throw new Error('record 字段 latencyMs 必须是正整数');
    }
  }
  if (record.workflowId !== undefined && record.workflowId !== null) {
    if (typeof record.workflowId !== 'string' || record.workflowId === '') {
      throw new Error('record 字段 workflowId 必须是字符串或 null');
    }
  }
}

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
 * 频次种子（B2）—— 首次启动时写入 data/qa-frequency.json。
 * 4 角色 × 共 30 条：
 *   product   8 条：PRD/需求类
 *   test      8 条：测试用例/边界类
 *   frontend  7 条：组件/页面/响应式类
 *   cs        7 条：客服咨询（退款/物流/优惠券）类
 * - text 已归一化（无空白）
 * - count 范围 1-15
 * - lastAsked 用近 30 天**写死**日期（避免每次跑测试日期漂移）
 * - 30 条归一化后 unique
 */
const FREQUENCY_SEED = {
  product: [
    { text: '退款流程prd',     count: 12, lastAsked: '2026-08-08' },
    { text: '订单管理需求',    count: 9,  lastAsked: '2026-08-09' },
    { text: '用户画像字段',    count: 7,  lastAsked: '2026-08-10' },
    { text: '优惠券规则',      count: 6,  lastAsked: '2026-08-11' },
    { text: '支付方式对接',    count: 5,  lastAsked: '2026-08-12' },
    { text: '物流跟踪prd',     count: 4,  lastAsked: '2026-08-06' },
    { text: '会员等级体系',    count: 3,  lastAsked: '2026-08-07' },
    { text: '数据看板指标',    count: 2,  lastAsked: '2026-08-05' },
  ],
  test: [
    { text: '退款流程边界',    count: 11, lastAsked: '2026-08-09' },
    { text: '支付异常case',    count: 8,  lastAsked: '2026-08-10' },
    { text: '登录鉴权测试',    count: 7,  lastAsked: '2026-08-11' },
    { text: '接口幂等性',      count: 6,  lastAsked: '2026-08-12' },
    { text: '并发抢券测试',    count: 5,  lastAsked: '2026-08-08' },
    { text: '数据一致性',      count: 4,  lastAsked: '2026-08-07' },
    { text: '风控规则验证',    count: 3,  lastAsked: '2026-08-06' },
    { text: '兼容性测试用例',  count: 2,  lastAsked: '2026-08-05' },
  ],
  frontend: [
    { text: '响应式布局',      count: 10, lastAsked: '2026-08-09' },
    { text: '列表组件封装',    count: 8,  lastAsked: '2026-08-10' },
    { text: '表单校验组件',    count: 6,  lastAsked: '2026-08-11' },
    { text: '弹窗组件',        count: 5,  lastAsked: '2026-08-12' },
    { text: '移动端适配',      count: 4,  lastAsked: '2026-08-08' },
    { text: '图表组件对接',    count: 3,  lastAsked: '2026-08-07' },
    { text: '路由权限控制',    count: 2,  lastAsked: '2026-08-06' },
  ],
  cs: [
    { text: '退款进度查询',    count: 13, lastAsked: '2026-08-10' },
    { text: '物流多久到',      count: 9,  lastAsked: '2026-08-11' },
    { text: '优惠券使用规则',  count: 7,  lastAsked: '2026-08-12' },
    { text: '订单修改地址',    count: 5,  lastAsked: '2026-08-09' },
    { text: '发票申请流程',    count: 4,  lastAsked: '2026-08-08' },
    { text: '会员积分兑换',    count: 3,  lastAsked: '2026-08-07' },
    { text: '售后退换货',      count: 2,  lastAsked: '2026-08-06' },
  ],
};

/** 算 FREQUENCY_SEED 全部 record 总数（用于 seedIfEmpty 返回值） */
function totalSeedRecords() {
  return Object.values(FREQUENCY_SEED).reduce((sum, list) => sum + list.length, 0);
}

/**
 * 追加 1 条 record 到 data/qa-history.json。缺必填字段抛 Error（fail fast）。
 * @param {object} record 必填：id, sessionId, turn, type, content, timestamp, role, bizLine, userId
 * @returns {object} 原 record（未做字段裁剪，由调用方决定形状）
 */
function appendRecord(record) {
  validateRecord(record);
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
  // 按 lastTimestamp 倒序排 session；lastTimestamp 平局时按 sessionId 字典序（确定性）
  const sortedSessions = [...lastTs.entries()]
    .sort((a, b) => String(b[1]).localeCompare(String(a[1])) || a[0].localeCompare(b[0]))
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

/**
 * 获取该 session 的下一个 turn 号（确定递增，不随机）。
 * 算法：读该 session 全部 record，取 turn 的最大值，+1 返回。
 * 空 session 返回 1。
 * @param {string} sessionId
 * @returns {number}
 */
function getNextTurn(sessionId) {
  const records = listBySession(sessionId);
  if (records.length === 0) return 1;
  const maxTurn = Math.max(...records.map((r) => r.turn || 0));
  return maxTurn + 1;
}

/**
 * 首次启动种子（B2）：空频次时写入 30 条预置数据。
 * 判空用 byRole 全部 record 总数（不依赖文件存在性 —— `readFrequency` 默认值是空 byRole）。
 * 已存在数据时**不**覆盖，直接返回 seeded: false。
 *
 * 健壮性（B2 amend）：writeFrequency 写盘失败（如 EACCES 只读盘）时**不**冒泡，
 * 仅 console.error 留痕后返回 seeded: false、count: 0。避免 server.js 启动崩。
 * @returns {{seeded: boolean, count: number}}
 */
function seedIfEmpty() {
  const data = readFrequency();
  const total = Object.values(data.byRole).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0,
  );
  if (total > 0) return { seeded: false, count: 0 };
  // 不 mutate data（否则 writeFrequency 失败时缓存脏、磁盘空，重启后种子消失）
  // 构造新对象，缓存与磁盘严格一致
  const newData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    byRole: JSON.parse(JSON.stringify(FREQUENCY_SEED)),
  };
  try {
    // 走 module.exports.writeFrequency 而非本地 writeFrequency —— 让测试可 mock
    module.exports.writeFrequency(newData);
    return { seeded: true, count: totalSeedRecords() };
  } catch (err) {
    console.error('[qa-store] 种子写入失败:', err.message);
    return { seeded: false, count: 0 };
  }
}

module.exports = {
  appendRecord,
  listBySession,
  listSessions,
  trim,
  incrementFrequency,
  getTopFrequency,
  getNextTurn,
  seedIfEmpty,
  normalize,
  writeFrequency,
  FREQUENCY_SEED,
};
