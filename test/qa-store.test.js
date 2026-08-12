/**
 * 聊天历史 + 常用问题频次 — 数据层（B1 / B2）
 *
 * 覆盖（对应《技术方案-聊天控制台.md》第 1.1 / 1.2 / 5 节）：
 *   T1. append + listBySession 基础 + 必填字段校验
 *   T2. 一次问答两条 record（user + ai）→ listBySession 返回 2 条按 turn 升序
 *   T3. listSessions 倒序 + summary 取首条 user content
 *   T4. trim 整 session 删：旧 session 全部 record 一起删，剩 10 条
 *   T5. frequency 归一化："退款流程 PRD" + "退款流程prd" 算同一条
 *   T6. frequency top 10 排序：count desc, lastAsked desc
 *   T11. seedIfEmpty 空文件 → 写入 30 条种子（4 角色总和 = 30）
 *   T12. seedIfEmpty 不会覆盖已有数据
 *   T13. 每个角色 getTopFrequency(role, 10) 返回对应角色种子数
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

// ============================================================
// T7. listSessions 在 session 只有 type='ai' record（无 user）时 summary 应为 ''
// ============================================================

test("T7：listSessions session 只有 type='ai' record → summary 应是 ''（不 crash、不 null）", () => {
  withTempDataDir(() => {
    // 造 1 个 session，只有 1 条 type='ai' record（合法：type 枚举是 user/ai）
    qa.appendRecord(makeRecord({
      id: 'qa_ai_only_1', sessionId: 's_ai_only', turn: 1, type: 'ai',
      content: '这是 AI 回答（没有 user 问题）', timestamp: '2026-08-13T10:00:00Z',
      role: 'product', bizLine: 'trade', userId: 'u',
    }));

    const sessions = qa.listSessions();
    assert.strictEqual(sessions.length, 1, '应返回 1 个 session');
    assert.strictEqual(sessions[0].sessionId, 's_ai_only');
    assert.strictEqual(sessions[0].summary, '', 'summary 缺首条 user content 时应是空字符串');
    assert.strictEqual(sessions[0].recordCount, 1);
  });
});

// ============================================================
// T8. trim 在 lastTimestamp 平局时按 sessionId 字典序确定结果
// ============================================================

test('T8：trim 3 个 session lastTimestamp 完全相同 → 保留按 sessionId 字典序前 2 个（确定）', () => {
  withTempDataDir(() => {
    // 3 个 session，每个 1 条 record，timestamp 完全相同
    const sameTs = '2026-08-13T10:00:00Z';
    for (const sid of ['s_zeta', 's_alpha', 's_mid']) {
      qa.appendRecord(makeRecord({
        id: `qa_${sid}_1`, sessionId: sid, turn: 1, type: 'user',
        content: `${sid} 的问题`, timestamp: sameTs,
        role: 'product', bizLine: 'trade', userId: 'u',
      }));
    }
    assert.strictEqual(qa.listBySession('s_alpha').length, 1);
    assert.strictEqual(qa.listBySession('s_mid').length, 1);
    assert.strictEqual(qa.listBySession('s_zeta').length, 1);

    // 全部 timestamp 一样 → lastTimestamp 平局
    qa.trim({ sessionCap: 2 });

    // 字典序：alpha < mid < zeta
    // 保留 alpha + mid，删 zeta
    const after = store.read('qa-history', { records: [] });
    const kept = after.records.map((r) => r.sessionId).sort();
    assert.deepStrictEqual(kept, ['s_alpha', 's_mid'],
      '平局时按 sessionId 字典序保留前 2 个，应是 alpha + mid（确定）');
    assert.strictEqual(after.records.length, 2, '剩 2 条 record');
  });
});

// ============================================================
// T9. appendRecord 缺类型字段应抛 Error（fail fast，不落盘）
// ============================================================

test('T9：appendRecord 字段类型错应抛 Error（fail fast，不落盘）', () => {
  withTempDataDir(() => {
    const cases = [
      { over: { turn: '1' },          label: 'turn 是字符串' },
      { over: { turn: 1.5 },          label: 'turn 是浮点' },
      { over: { sessionId: 123 },     label: 'sessionId 是数字' },
      { over: { type: 'unknown' },    label: 'type 非法枚举' },
      { over: { qualityScore: 11 },   label: 'qualityScore 越界（>10）' },
      { over: { qualityScore: 0.5 },  label: 'qualityScore 是浮点' },
      { over: { feedback: 'unknown' },label: 'feedback 非法枚举' },
      { over: { ragChunks: 'not array' }, label: 'ragChunks 非数组' },
      { over: { id: 123 },            label: 'id 是数字' },
      { over: { content: 123 },       label: 'content 是数字' },
      { over: { timestamp: 123 },     label: 'timestamp 是数字' },
    ];

    for (const { over, label } of cases) {
      assert.throws(
        () => qa.appendRecord(makeRecord(over)),
        /record/,
        `${label} 应抛 Error`,
      );
    }

    // 校验失败时不应落盘 —— 整个文件应是 empty（从没成功 append 过）
    const persisted = store.read('qa-history', { records: [] });
    assert.deepStrictEqual(persisted.records, [],
      'T9 全部 case 失败后 qa-history.json 应仍是空 records');
  });
});

// ============================================================
// T10. 频次文件被破坏时 read 应 fallback 不 crash
// ============================================================

test('T10：data/qa-frequency.json 被破坏 → getTopFrequency 不 crash，返回 []', () => {
  withTempDataDir(() => {
    // 先正常写一条，让 store 把合法数据写进缓存
    qa.incrementFrequency('product', '正常条目');

    // 清理缓存后，覆写为残缺 JSON
    store.clearCache();
    const fp = path.join(config.paths.data, 'qa-frequency.json');
    fs.writeFileSync(fp, '{"version": 1, "byRole": `{', 'utf8');

    // 不应 crash；getTopFrequency 应返回 []
    const top = qa.getTopFrequency('product');
    assert.deepStrictEqual(top, [], '文件残缺时 getTopFrequency 应返回 [] 而非 crash');

    // 同样：incrementFrequency 应还能正常工作（read 走 fallback、write 覆盖坏文件）
    assert.doesNotThrow(() => qa.incrementFrequency('product', '坏文件后写入的条目'));
    const top2 = qa.getTopFrequency('product');
    assert.ok(top2.length >= 1, '坏文件后能正常写入新条目');
    assert.strictEqual(top2[0].text, '坏文件后写入的条目');
  });
});

// ============================================================
// T11. seedIfEmpty 空文件 → 写入 30 条种子（4 角色总和 = 30）
// ============================================================

test('T11：seedIfEmpty 空文件 → 写入 30 条种子（product 8 / test 8 / frontend 7 / cs 7）', () => {
  withTempDataDir(() => {
    // 空数据目录
    const fp = path.join(config.paths.data, 'qa-frequency.json');
    assert.ok(!fs.existsSync(fp), '起始 qa-frequency.json 应不存在');

    // 执行 seed
    const result = qa.seedIfEmpty();
    assert.strictEqual(result.seeded, true, '空时 seedIfEmpty 应返回 seeded: true');
    assert.strictEqual(result.count, 30, '应返回写入 30 条');

    // 文件应落盘
    assert.ok(fs.existsSync(fp), 'seed 后 qa-frequency.json 应被创建');
    const persisted = JSON.parse(fs.readFileSync(fp, 'utf8'));
    assert.strictEqual(persisted.version, 1);
    assert.ok(persisted.updatedAt, 'updatedAt 应写入');

    // 4 角色总和 = 30
    const byRole = persisted.byRole || {};
    const total = Object.values(byRole).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    assert.strictEqual(total, 30, `4 角色总和应 = 30（实际 ${total}）`);

    // 各角色数
    assert.strictEqual((byRole.product || []).length, 8, 'product 应 8 条');
    assert.strictEqual((byRole.test || []).length, 8, 'test 应 8 条');
    assert.strictEqual((byRole.frontend || []).length, 7, 'frontend 应 7 条');
    assert.strictEqual((byRole.cs || []).length, 7, 'cs 应 7 条');

    // 每条 entry 形状
    for (const role of ['product', 'test', 'frontend', 'cs']) {
      for (const e of byRole[role]) {
        assert.ok(typeof e.text === 'string' && e.text.length > 0, `${role} entry.text 应是非空字符串`);
        assert.ok(Number.isInteger(e.count) && e.count >= 1 && e.count <= 15, `${role} entry.count 应是 1-15 整数`);
        assert.ok(typeof e.lastAsked === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.lastAsked), `${role} entry.lastAsked 应是 YYYY-MM-DD`);
      }
    }

    // 30 条归一化后 unique
    const allText = [].concat(...Object.values(byRole)).map((e) => e.text);
    assert.strictEqual(new Set(allText).size, 30, '30 条 text 归一化后应 unique');
  });
});

// ============================================================
// T12. seedIfEmpty 不会覆盖已有数据
// ============================================================

test('T12：seedIfEmpty 不会覆盖已有数据 —— 先 incrementFrequency 1 条 → 再 seedIfEmpty → 仍只有 1 条', () => {
  withTempDataDir(() => {
    // 先写 1 条用户数据
    qa.incrementFrequency('product', '用户实际问的');
    const before = store.read('qa-frequency', { byRole: {} });
    assert.strictEqual(before.byRole.product.length, 1, '起始应是 1 条');
    assert.strictEqual(before.byRole.product[0].text, '用户实际问的');

    // 再 seed
    const result = qa.seedIfEmpty();
    assert.strictEqual(result.seeded, false, '已有数据时 seedIfEmpty 应返回 seeded: false');
    assert.strictEqual(result.count, 0, '已存在时不应再写');

    // 数据应不变 —— 仍是 1 条
    const after = store.read('qa-frequency', { byRole: {} });
    assert.strictEqual(after.byRole.product.length, 1, '已有 1 条 + seed 后仍应 1 条');
    assert.strictEqual(after.byRole.product[0].text, '用户实际问的', '原条目应完整保留');
    // 其他角色应仍是空（**不**被种子填充）
    assert.strictEqual((after.byRole.test || []).length, 0, 'test 不应被种子填');
    assert.strictEqual((after.byRole.frontend || []).length, 0, 'frontend 不应被种子填');
    assert.strictEqual((after.byRole.cs || []).length, 0, 'cs 不应被种子填');
  });
});

// ============================================================
// T13. 每个角色 getTopFrequency(role, 10) 返回对应角色种子数
// ============================================================

test('T13：seedIfEmpty 后 getTopFrequency(role, 10) 返回对应角色种子数（product 8 / test 8 / frontend 7 / cs 7）', () => {
  withTempDataDir(() => {
    qa.seedIfEmpty();

    // 各角色 top 10 应返回全部种子（都不超过 10）
    assert.strictEqual(qa.getTopFrequency('product', 10).length, 8, 'product 种子 8 条');
    assert.strictEqual(qa.getTopFrequency('test', 10).length, 8, 'test 种子 8 条');
    assert.strictEqual(qa.getTopFrequency('frontend', 10).length, 7, 'frontend 种子 7 条');
    assert.strictEqual(qa.getTopFrequency('cs', 10).length, 7, 'cs 种子 7 条');

    // 排序：top 1 应是该角色 count 最大的
    const topP = qa.getTopFrequency('product', 1);
    const allP = store.read('qa-frequency', { byRole: {} }).byRole.product;
    const maxP = Math.max(...allP.map((e) => e.count));
    assert.strictEqual(topP[0].count, maxP, 'product top 1 应是 count 最大的');

    // 未知 role 应返回 []（**不** crash）
    assert.deepStrictEqual(qa.getTopFrequency('unknown_role', 10), [],
      '未知 role 应返回空数组');
  });
});

// ============================================================
// T14. seedIfEmpty 写盘失败时静默 return，不 throw 冒泡（防 server.js 启动崩）
// ============================================================

test('T14：seedIfEmpty 写盘失败时静默 return 不抛（不阻断 server.js 启动）', () => {
  withTempDataDir(() => {
    // 验证：writeFrequency 已被 export（供 mock 用）
    assert.strictEqual(typeof qa.writeFrequency, 'function', 'writeFrequency 应被 export（用于测试 mock）');

    // mock writeFrequency 让它抛错
    const origWrite = qa.writeFrequency;
    let callCount = 0;
    qa.writeFrequency = (data) => {
      callCount += 1;
      throw new Error('EACCES simulated');
    };

    let result;
    try {
      // 不应 throw —— 即使 writeFrequency 抛错也应静默
      result = qa.seedIfEmpty();
    } finally {
      // 恢复原 writeFrequency（其他测试可能用得到）
      qa.writeFrequency = origWrite;
    }

    assert.ok(result, 'seedIfEmpty 应正常返回（不 throw）');
    assert.strictEqual(result.seeded, false, '写盘失败应返回 seeded: false');
    assert.strictEqual(result.count, 0, '写盘失败应 count: 0');
    assert.strictEqual(callCount, 1, '应调用 writeFrequency 一次');

    // 恢复原 writeFrequency 后清缓存，确保恢复路径从干净状态开始
    // （注：B2 amend-2 后 seedIfEmpty 不再 mutate 缓存，但清缓存仍是无害的兜底）
    store.clearCache();
    // 再次调用，验证种子真能写（系统能恢复）
    const recover = qa.seedIfEmpty();
    assert.strictEqual(recover.seeded, true, '写盘恢复后应能写入');
    assert.strictEqual(recover.count, 30, '恢复后应写入 30 条');
  });
});
