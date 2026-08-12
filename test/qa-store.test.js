/**
 * 聊天历史 + 常用问题频次 — 数据层（B1）
 *
 * 覆盖（对应《技术方案-聊天控制台.md》第 1.1 / 1.2 / 5 节）：
 *   T1. append + listBySession 基础 + 必填字段校验
 *   T2. 一次问答两条 record（user + ai）→ listBySession 返回 2 条按 turn 升序
 *   T3. listSessions 倒序 + summary 取首条 user content
 *   T4. trim 整 session 删：旧 session 全部 record 一起删，剩 10 条
 *   T5. frequency 归一化："退款流程 PRD" + "退款流程prd" 算同一条
 *   T6. frequency top 10 排序：count desc, lastAsked desc
 *
 * 隔离：参考 documents.test.js 的 withTempDataDir —— 同步执行（finally 改 config.paths.data）。
 * 改 async/await 会让 finally 在 promise resolve 前跑，隔离静默失效。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const qa = require('../lib/qa-store');

// ============================================================
// 隔离夹具（同步执行！见文件头警告）
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-qa-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// 夹具工厂
// ============================================================

/** 造一条完整 record（必填字段全给） */
function makeRecord(over = {}) {
  return {
    id: 'qa_001',
    userId: 'u_001',
    userName: '张三',
    role: 'product',
    bizLine: 'trade',
    sessionId: 's_001',
    turn: 1,
    type: 'user',
    content: '我需要一个退款流程的PRD',
    timestamp: '2026-08-13T10:00:00Z',
    workflowId: null,
    ragChunks: null,
    qualityScore: null,
    feedback: null,
    latencyMs: null,
    ...over,
  };
}

/** 造"一次问答"—— user + ai 一对，turn 递增 */
function makeQAPair(sessionId, turn, role = 'product', userText = '我需要一个退款流程的PRD', aiText = '好的，PRD 模板见...', ts = '2026-08-13T10:00:00Z') {
  return [
    makeRecord({ id: `qa_${sessionId}_${turn}_u`, sessionId, turn, type: 'user', content: userText, role, timestamp: ts, workflowId: 'wf_xxx' }),
    makeRecord({ id: `qa_${sessionId}_${turn}_a`, sessionId, turn, type: 'ai', content: aiText, role, timestamp: ts,
      workflowId: 'wf_xxx', ragChunks: [{ id: 'chk_1' }], qualityScore: 8, latencyMs: 1234 }),
  ];
}

// ============================================================
// T1. append + listBySession 基础 + 必填字段校验
// ============================================================

test('T1：appendRecord 追加 1 条，listBySession 读出 1 条；缺必填字段抛 Error（fail fast）', () => {
  withTempDataDir(() => {
    // 基础 append + list
    const r = qa.appendRecord(makeRecord({ id: 'qa_001', sessionId: 's_001', turn: 1, content: '退款流程怎么走' }));
    assert.strictEqual(r.id, 'qa_001', 'appendRecord 应返回原 record');

    const list = qa.listBySession('s_001');
    assert.strictEqual(list.length, 1, 'listBySession 应返回 1 条');
    assert.strictEqual(list[0].id, 'qa_001');
    assert.strictEqual(list[0].sessionId, 's_001');
    assert.strictEqual(list[0].turn, 1);

    // 持久化
    const fp = path.join(config.paths.data, 'qa-history.json');
    assert.ok(fs.existsSync(fp), 'qa-history.json 应落盘');
    const persisted = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.strictEqual(persisted.version, 1);
    assert.strictEqual(persisted.records.length, 1);
    assert.ok(persisted.updatedAt, 'updatedAt 应写入');

    // 必填字段校验：缺一项都抛 Error
    const base = { id: 'q', sessionId: 's', turn: 1, type: 'user', content: 'x', timestamp: 't', role: 'product', bizLine: 'trade', userId: 'u' };
    const required = ['id', 'sessionId', 'turn', 'type', 'content', 'timestamp', 'role', 'bizLine', 'userId'];
    for (const field of required) {
      const bad = { ...base };
      delete bad[field];
      assert.throws(() => qa.appendRecord(bad), new RegExp(field), `缺 ${field} 应抛 Error`);
    }
    // 校验失败时不应落盘（再读仍是 1 条）
    assert.strictEqual(store.read('qa-history', { records: [] }).records.length, 1,
      '校验失败时不应落盘');
  });
});

// ============================================================
// T2. 一次问答两条 record
// ============================================================

test('T2：一次问答两条 record（user + ai）→ listBySession 返回 2 条按 turn 升序', () => {
  withTempDataDir(() => {
    // appendRecord 一次只入一条，2 条分开调
    const [user, ai] = makeQAPair('s_002', 1, 'product', '退款流程的PRD怎么写', '请参考模板 X');
    qa.appendRecord(user);
    qa.appendRecord(ai);

    const list = qa.listBySession('s_002');
    assert.strictEqual(list.length, 2, '应返回 2 条 record');
    assert.ok(list.every((r) => r.id && r.sessionId && r.timestamp && r.role && r.bizLine && r.userId),
      '每条 record 都应有全部必填字段');
    assert.deepStrictEqual(list.map((r) => r.type), ['user', 'ai'], 'user 排在 ai 前');
    assert.ok(list.every((r) => r.sessionId === 's_002'));

    // 跨 session：另一个 session 的 1 轮问答，应只被对应 session 读到
    const [u2, a2] = makeQAPair('s_other', 1, 'test', '另一个 session 的问题', '另一个回答');
    qa.appendRecord(u2);
    qa.appendRecord(a2);
    assert.strictEqual(qa.listBySession('s_002').length, 2, 's_002 仍只 2 条');
    assert.strictEqual(qa.listBySession('s_other').length, 2, 's_other 独立 2 条');
  });
});

// ============================================================
// T3. listSessions 倒序 + summary
// ============================================================

test('T3：listSessions 3 个 session 按最后时间倒序，summary 取首条 user content', () => {
  withTempDataDir(() => {
    // 3 个 session，时间递增
    {
      const [u, a] = makeQAPair('s_oldest', 1, 'product',
        '最早的一条用户问题，作为 summary 取证', 'AI 回答 1', '2026-08-13T09:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    {
      const [u, a] = makeQAPair('s_mid', 1, 'test',
        '中间那条用户问题', 'AI 回答 2', '2026-08-13T11:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    {
      const [u, a] = makeQAPair('s_newest', 1, 'cs',
        '最新那条用户问题', 'AI 回答 3', '2026-08-13T13:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }

    const sessions = qa.listSessions();
    assert.strictEqual(sessions.length, 3, '应返回 3 个 session');
    assert.deepStrictEqual(sessions.map((s) => s.sessionId), ['s_newest', 's_mid', 's_oldest'],
      '应按 lastTimestamp 倒序');
    assert.strictEqual(sessions[0].recordCount, 2);
    assert.strictEqual(sessions[0].summary, '最新那条用户问题', 'summary 应取首条 user 的 content');
    assert.strictEqual(sessions[1].summary, '中间那条用户问题');
    assert.strictEqual(sessions[2].summary, '最早的一条用户问题，作为 summary 取证');
    // 字段形状
    for (const s of sessions) {
      assert.ok(s.lastTimestamp, '每条应含 lastTimestamp');
      assert.ok(typeof s.summary === 'string', '每条应含 summary');
    }

    // limit 截断
    {
      const [u, a] = makeQAPair('s_extra', 1, 'product', '额外一条', '额外回答', '2026-08-13T14:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    const top3 = qa.listSessions(3);
    assert.strictEqual(top3.length, 3, 'limit=3 应只返回 3 个');
    assert.deepStrictEqual(top3.map((s) => s.sessionId), ['s_extra', 's_newest', 's_mid'],
      '取最新 3 个');
  });
});

// ============================================================
// T4. trim 整 session 删
// ============================================================

test('T4：trim 整 session 删 —— 3 session × 5 record → trim({sessionCap:2}) → 剩 10 条', () => {
  withTempDataDir(() => {
    // session A：2 轮问答（4 record）+ 1 ai record = 5
    for (let t = 1; t <= 2; t++) {
      const [u, a] = makeQAPair('s_A', t, 'product', `A Q${t}`, `A A${t}`, '2026-08-13T10:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    qa.appendRecord(makeRecord({ id: 'qa_s_A_3_a', sessionId: 's_A', turn: 3, type: 'ai', content: 'A extra', timestamp: '2026-08-13T10:00:00Z', role: 'product', bizLine: 'trade', userId: 'u' }));
    // session B：5 record
    for (let t = 1; t <= 2; t++) {
      const [u, a] = makeQAPair('s_B', t, 'product', `B Q${t}`, `B A${t}`, '2026-08-13T11:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    qa.appendRecord(makeRecord({ id: 'qa_s_B_3_a', sessionId: 's_B', turn: 3, type: 'ai', content: 'B extra', timestamp: '2026-08-13T11:00:00Z', role: 'product', bizLine: 'trade', userId: 'u' }));
    // session C：5 record
    for (let t = 1; t <= 2; t++) {
      const [u, a] = makeQAPair('s_C', t, 'product', `C Q${t}`, `C A${t}`, '2026-08-13T12:00:00Z');
      qa.appendRecord(u); qa.appendRecord(a);
    }
    qa.appendRecord(makeRecord({ id: 'qa_s_C_3_a', sessionId: 's_C', turn: 3, type: 'ai', content: 'C extra', timestamp: '2026-08-13T12:00:00Z', role: 'product', bizLine: 'trade', userId: 'u' }));

    // 验证 15 条
    const before = store.read('qa-history', { records: [] });
    assert.strictEqual(before.records.length, 15, '3 session × 5 record = 15');

    // 保留 2 个 session（C 和 B），A 整 session 删
    qa.trim({ sessionCap: 2 });

    const after = store.read('qa-history', { records: [] });
    assert.strictEqual(after.records.length, 10, '剩 2 session × 5 record = 10');
    // 关键：旧 session A 的 5 条**全部**一起删，不能切一半
    assert.strictEqual(after.records.filter((r) => r.sessionId === 's_A').length, 0,
      'session A 整 session 删（5 条全删）');
    assert.strictEqual(after.records.filter((r) => r.sessionId === 's_B').length, 5,
      'session B 完整保留 5 条');
    assert.strictEqual(after.records.filter((r) => r.sessionId === 's_C').length, 5,
      'session C 完整保留 5 条');
  });
});

// ============================================================
// T5. frequency 归一化
// ============================================================

test('T5：incrementFrequency 归一化 —— "退款流程 PRD" + "退款流程prd" + 多空白 = 1 条 count=3', () => {
  withTempDataDir(() => {
    qa.incrementFrequency('product', '退款流程 PRD');
    qa.incrementFrequency('product', '退款流程prd');
    qa.incrementFrequency('product', '  退款 流程  prd  ');  // 多种空白混合

    // 持久化校验
    const persisted = JSON.parse(fs.readFileSync(path.join(config.paths.data, 'qa-frequency.json'), 'utf8'));
    assert.strictEqual(persisted.version, 1);
    assert.strictEqual(persisted.byRole.product.length, 1, '3 次写同一条，应只有 1 条');
    assert.strictEqual(persisted.byRole.product[0].text, '退款流程prd', '归一化后 text 形式确定');
    assert.strictEqual(persisted.byRole.product[0].count, 3, 'count 应累加到 3');

    // normalize 导出可用
    assert.strictEqual(qa.normalize('退款流程 PRD'), '退款流程prd');
    assert.strictEqual(qa.normalize('Hello World'), 'helloworld');
    assert.strictEqual(qa.normalize(null), '');
    assert.strictEqual(qa.normalize(undefined), '');

    // 不同 role 互不影响；'退款流程' 归一化后还是 '退款流程'（无空白）
    qa.incrementFrequency('test', '退款流程');
    const topP = qa.getTopFrequency('product');
    const topT = qa.getTopFrequency('test');
    assert.strictEqual(topP[0].count, 3);
    assert.strictEqual(topT[0].count, 1);
  });
});

// ============================================================
// T6. frequency top 10 排序
// ============================================================

test('T6：getTopFrequency 排序：count desc, lastAsked desc；限 top N', () => {
  withTempDataDir(() => {
    // 造 3 条：a(5)/b(5)/c(3)，人为把 b 的 lastAsked 改到比 a 新
    // 注：normalize 会去空白，所以 a/b/c 之间无空白的话原样保留
    for (let i = 0; i < 5; i++) qa.incrementFrequency('product', '问题a');
    for (let i = 0; i < 5; i++) qa.incrementFrequency('product', '问题b');
    for (let i = 0; i < 3; i++) qa.incrementFrequency('product', '问题c');

    // 通过底层 store 精确调 lastAsked
    const fp = path.join(config.paths.data, 'qa-frequency.json');
    const persisted = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const a = persisted.byRole.product.find((e) => e.text === '问题a');
    const b = persisted.byRole.product.find((e) => e.text === '问题b');
    a.lastAsked = '2026-08-10T10:00:00Z';
    b.lastAsked = '2026-08-12T10:00:00Z';
    fs.writeFileSync(fp, JSON.stringify(persisted, null, 2), 'utf8');

    // count desc 优先：a(5) 和 b(5) 并列，b 的 lastAsked 更新 → b 在前
    const top = qa.getTopFrequency('product', 10);
    assert.deepStrictEqual(top.map((e) => e.text), ['问题b', '问题a', '问题c'],
      '排序：count desc, lastAsked desc');
    assert.strictEqual(top[0].count, 5);
    assert.strictEqual(top[1].count, 5);
    assert.strictEqual(top[2].count, 3);

    // top N=2
    const top2 = qa.getTopFrequency('product', 2);
    assert.strictEqual(top2.length, 2);
    assert.deepStrictEqual(top2.map((e) => e.text), ['问题b', '问题a']);
    // 返回形状
    for (const e of top) {
      assert.ok(typeof e.text === 'string');
      assert.ok(typeof e.count === 'number');
      assert.ok(e.lastAsked);
    }
  });
});
