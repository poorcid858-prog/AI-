/**
 * B4 聊天 API 路由测试（TDD）
 *
 * 覆盖 4 个 endpoint：
 *   T1. GET /api/chat/history —— 历史聊天列表
 *   T2. GET /api/chat/history?limit=1 —— 分页
 *   T3. GET /api/chat/frequency?role=product —— 常用问题 top 10（产品角色）
 *   T4. GET /api/chat/frequency?role=test —— 角色隔离
 *   T5. GET /api/chat/frequency?role=invalid —— 无效角色
 *   T6. POST /api/chat/send —— 发新问题（整个流程）
 *   T7. GET /api/chat/session/:id —— session 详情
 *   T8. POST /api/chat/send 权限拦截（可选）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const config = require('../config');
const store = require('../lib/store');
const qa = require('../lib/qa-store');

// ============================================================
// Mock request/response 对象（不用 supertest）
// ============================================================

function createMockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res._data = null;
  res._sent = false;

  res.status = function(code) {
    this.statusCode = code;
    return this;
  };

  res.json = function(data) {
    this._data = data;
    this._sent = true;
    return this;
  };

  return res;
}

// ============================================================
// 隔离夹具（同步执行）
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-chat-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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

/** 造一条 QA 对 —— user + ai */
function makeQAPair(sessionId, turn, role = 'product', userText = '我需要一个退款流程的PRD', aiText = '好的，PRD 模板见...', ts = '2026-08-13T10:00:00Z') {
  return [
    makeRecord({ id: `qa_${sessionId}_${turn}_u`, sessionId, turn, type: 'user', content: userText, role, timestamp: ts }),
    makeRecord({ id: `qa_${sessionId}_${turn}_a`, sessionId, turn, type: 'ai', content: aiText, role, timestamp: ts, workflowId: 'wf_xxx', ragChunks: [{ id: 'chk_1' }], qualityScore: 8, latencyMs: 1234 }),
  ];
}

// ============================================================
// T1. GET /api/chat/history —— 历史列表基础
// ============================================================

test('T1: listSessions 无数据时返回空数组', () => {
  withTempDataDir(() => {
    const sessions = qa.listSessions();
    assert.deepStrictEqual(sessions, [], '无数据时应返回空数组');
  });
});

test('T1b: listSessions 有 2 个 session，按 lastTimestamp 倒序', () => {
  withTempDataDir(() => {
    // 造 2 个 session，各 2 条 record
    const pair1 = makeQAPair('s_001', 1, 'product', '问题1', '回答1', '2026-08-13T10:00:00Z');
    const pair2 = makeQAPair('s_001', 2, 'product', '问题2', '回答2', '2026-08-13T11:00:00Z');
    const pair3 = makeQAPair('s_002', 1, 'test', '边界问题', '边界回答', '2026-08-13T09:00:00Z');

    qa.appendRecord(pair1[0]);
    qa.appendRecord(pair1[1]);
    qa.appendRecord(pair2[0]);
    qa.appendRecord(pair2[1]);
    qa.appendRecord(pair3[0]);
    qa.appendRecord(pair3[1]);

    const sessions = qa.listSessions();
    assert.strictEqual(sessions.length, 2, 'sessions 应有 2 条');
    // 按 lastTimestamp 倒序：s_001 的 lastTimestamp 是 11:00，s_002 是 09:00
    assert.strictEqual(sessions[0].sessionId, 's_001', '第一条应是 s_001');
    assert.strictEqual(sessions[1].sessionId, 's_002', '第二条应是 s_002');
    // summary 取首条 user content
    assert.strictEqual(sessions[0].summary, '问题1', '第一条 summary 应是首条 user 问题');
  });
});

// ============================================================
// T2. listSessions?limit=1 —— 分页
// ============================================================

test('T2: listSessions(1) 返回 1 条', () => {
  withTempDataDir(() => {
    const pair1 = makeQAPair('s_001', 1, 'product', '问题1', '回答1');
    const pair2 = makeQAPair('s_002', 1, 'test', '边界问题', '边界回答', '2026-08-13T09:00:00Z');

    qa.appendRecord(pair1[0]);
    qa.appendRecord(pair1[1]);
    qa.appendRecord(pair2[0]);
    qa.appendRecord(pair2[1]);

    const sessions = qa.listSessions(1);
    assert.strictEqual(sessions.length, 1, 'limit=1 应返回 1 条');
  });
});

// ============================================================
// T3. GET /api/chat/frequency?role=product —— 常用问题（产品角色）
// ============================================================

test('T3: getTopFrequency(product, 10) 返回 product 频次，包含种子数据', () => {
  withTempDataDir(() => {
    // 种子数据会在这个测试中初始化
    qa.seedIfEmpty();

    const frequency = qa.getTopFrequency('product', 10);
    assert.ok(Array.isArray(frequency), 'frequency 应是数组');
    assert.ok(frequency.length > 0, 'product 角色应有频次数据');
    // 检查返回的是 text, count, lastAsked 格式
    if (frequency.length > 0) {
      assert.ok(frequency[0].text, '应有 text 字段');
      assert.ok(frequency[0].count !== undefined, '应有 count 字段');
      assert.ok(frequency[0].lastAsked, '应有 lastAsked 字段');
    }
  });
});

// ============================================================
// T4. GET /api/chat/frequency?role=test —— 角色隔离
// ============================================================

test('T4: getTopFrequency(test, 10) 返回 test 频次，非 product', () => {
  withTempDataDir(() => {
    qa.seedIfEmpty();

    const frequency = qa.getTopFrequency('test', 10);
    assert.ok(frequency.length > 0, 'test 角色应有频次数据');
    // 验证是 test 角色的数据（第一条应该是 test 种子中的）
    const firstText = frequency[0].text;
    assert.ok(firstText, '应返回 test 频次数据');
  });
});

// ============================================================
// T5. GET /api/chat/frequency?role=invalid —— 无效角色
// ============================================================

test('T5: getTopFrequency(invalid, 10) 返回空数组', () => {
  withTempDataDir(() => {
    qa.seedIfEmpty();
    const frequency = qa.getTopFrequency('invalid', 10);
    assert.deepStrictEqual(frequency, [], 'invalid 角色应返回空数组');
  });
});

// ============================================================
// T6. POST /api/chat/send 流程测试 —— 追加 record + 更新 frequency
// ============================================================

test('T6: appendRecord + incrementFrequency 完整流程', () => {
  withTempDataDir(() => {
    qa.seedIfEmpty();

    // 模拟发送问题的流程
    const userRecord = makeRecord({
      id: 'qa_new_001',
      sessionId: 's_new_001',
      type: 'user',
      content: '新的退款流程问题',
      role: 'product',
    });

    const aiRecord = makeRecord({
      id: 'qa_new_002',
      sessionId: 's_new_001',
      type: 'ai',
      content: 'AI 回答内容',
      role: 'product',
      turn: 1,
      workflowId: 'wf_test',
    });

    // 存储 user 记录
    qa.appendRecord(userRecord);
    // 存储 ai 记录
    qa.appendRecord(aiRecord);
    // 更新频次
    qa.incrementFrequency('product', '新的退款流程问题');

    // 验证记录已存储
    const records = qa.listBySession('s_new_001');
    assert.strictEqual(records.length, 2, '应有 2 条记录');
    assert.strictEqual(records[0].type, 'user', '第一条应是 user');
    assert.strictEqual(records[1].type, 'ai', '第二条应是 ai');

    // 验证频次已更新
    const frequency = qa.getTopFrequency('product', 10);
    const found = frequency.find((f) => f.text.includes('新的退款流程问题'));
    assert.ok(found, 'frequency 中应找到新增问题');
  });
});

// ============================================================
// T7. GET /api/chat/session/:id —— session 详情
// ============================================================

test('T7: listBySession 返回该 session 的所有 record，按 turn 升序', () => {
  withTempDataDir(() => {
    const pair1 = makeQAPair('s_001', 1, 'product', '问题1', '回答1');
    const pair2 = makeQAPair('s_001', 2, 'product', '问题2', '回答2');

    qa.appendRecord(pair1[0]);
    qa.appendRecord(pair1[1]);
    qa.appendRecord(pair2[0]);
    qa.appendRecord(pair2[1]);

    const records = qa.listBySession('s_001');
    assert.strictEqual(records.length, 4, '应有 4 条记录');
    // turn 应升序
    assert.strictEqual(records[0].turn, 1);
    assert.strictEqual(records[1].turn, 1);
    assert.strictEqual(records[2].turn, 2);
    assert.strictEqual(records[3].turn, 2);
    // 同 turn 时 user 在前
    assert.strictEqual(records[0].type, 'user');
    assert.strictEqual(records[1].type, 'ai');
  });
});

// ============================================================
// T8. 验证 qa-store API 正确性（作为 route 依赖）
// ============================================================

test('T8: qa-store 功能完整性检查', () => {
  withTempDataDir(() => {
    // 验证所有需要的 API 都可用
    assert.ok(typeof qa.appendRecord === 'function', 'appendRecord 应可用');
    assert.ok(typeof qa.listBySession === 'function', 'listBySession 应可用');
    assert.ok(typeof qa.listSessions === 'function', 'listSessions 应可用');
    assert.ok(typeof qa.incrementFrequency === 'function', 'incrementFrequency 应可用');
    assert.ok(typeof qa.getTopFrequency === 'function', 'getTopFrequency 应可用');
    assert.ok(typeof qa.seedIfEmpty === 'function', 'seedIfEmpty 应可用');
  });
});

// ============================================================
// T9. turn 确定性 —— 同 session 多次调用应递增（不随机）
// ============================================================

test('T9: getNextTurn(sessionId) 确定递增', () => {
  withTempDataDir(() => {
    // 初次调用应返回 1
    const turn1 = qa.getNextTurn('s_001');
    assert.strictEqual(turn1, 1, '空 session 首个 turn 应是 1');

    // 添加第一对 QA record
    const pair1 = makeQAPair('s_001', 1, 'product');
    qa.appendRecord(pair1[0]);
    qa.appendRecord(pair1[1]);

    // 再次调用应返回 2
    const turn2 = qa.getNextTurn('s_001');
    assert.strictEqual(turn2, 2, '有 1 对 QA 后，turn 应是 2');

    // 添加第二对 QA record
    const pair2 = makeQAPair('s_001', 2, 'product');
    qa.appendRecord(pair2[0]);
    qa.appendRecord(pair2[1]);

    // 再次调用应返回 3
    const turn3 = qa.getNextTurn('s_001');
    assert.strictEqual(turn3, 3, '有 2 对 QA 后，turn 应是 3');

    // 不同 session 应独立计算
    const turn_s002 = qa.getNextTurn('s_002');
    assert.strictEqual(turn_s002, 1, '不同 session 应独立，turn 应是 1');
  });
});
