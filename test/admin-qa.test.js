/**
 * QA 审计页 API 单元测试（需求 1）
 *
 * 测试 qa-store 的 listSessions 和 listBySession 逻辑
 * 由于测试需要隔离，这里使用单元测试方式直接测试函数
 */

const test = require('node:test');
const assert = require('node:assert');
const qa = require('../lib/qa-store');

// 辅助函数：创建测试数据
function createTestSession(sessionId, userName, role, bizLine, timestamp, content) {
  qa.appendRecord({
    id: `qa_u_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userId: `user_${Date.now()}`,
    userName,
    sessionId,
    turn: 1,
    type: 'user',
    content,
    timestamp,
    role,
    bizLine,
    workflowId: null,
    ragChunks: [],
    qualityScore: null,
    feedback: null,
    latencyMs: null,
  });

  qa.appendRecord({
    id: `qa_a_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    userId: `user_${Date.now()}`,
    userName,
    sessionId,
    turn: 1,
    type: 'ai',
    content: '这是 AI 的回答',
    timestamp: new Date(new Date(timestamp).getTime() + 2000).toISOString(),
    role,
    bizLine,
    workflowId: `wf_${Date.now()}`,
    ragChunks: [
      {
        chunkId: 'chunk_001',
        content: '知识库内容...',
        source: '示例文件.md',
        sourceDocId: 'raw_001',
        stdId: 'std_001',
        similarity: 0.87,
        matchedKeywords: ['关键词'],
        sectionPath: '第1章',
      },
    ],
    qualityScore: 8,
    feedback: null,
    latencyMs: 2341,
  });
}

test('T1: listSessions 返回 session 列表（倒序）', () => {
  // 使用当前时间（保证数据在 listSessions 列表顶部）
  const now = Date.now();
  const t1 = new Date(now).toISOString();
  const t2 = new Date(now + 1000).toISOString(); // t2 比 t1 新

  const sid1 = `s_test1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sid2 = `s_test2_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  createTestSession(sid1, '用户A', 'product', 'trade', t1, '问题1');
  createTestSession(sid2, '用户B', 'test', 'membership', t2, '问题2');

  // 清缓存确保读到最新数据
  const store = require('../lib/store');
  store.clearCache();

  // 用大 limit，且过滤出我们刚创建的 session
  const sessions = qa.listSessions(500);
  const s1 = sessions.find((s) => s.sessionId === sid1);
  const s2 = sessions.find((s) => s.sessionId === sid2);

  assert(s1, `应找到 session ${sid1}`);
  assert(s2, `应找到 session ${sid2}`);

  // 验证倒序（最新的在前）
  const idx1 = sessions.indexOf(s1);
  const idx2 = sessions.indexOf(s2);
  assert(idx2 < idx1, '最新的 session 应在前面');
});

test('T2: listBySession 返回该 session 的所有 record', () => {
  const sid = `s_detail_${Date.now()}`;
  const timestamp = new Date().toISOString();

  createTestSession(sid, '测试用户', 'product', 'trade', timestamp, '我的问题');

  const records = qa.listBySession(sid);
  assert(records.length >= 2, '应至少有 2 条 record（user + ai）');

  const userRecord = records.find((r) => r.type === 'user');
  const aiRecord = records.find((r) => r.type === 'ai');

  assert(userRecord, '应有 user record');
  assert(aiRecord, '应有 ai record');

  assert.strictEqual(userRecord.content, '我的问题');
  assert.strictEqual(aiRecord.content, '这是 AI 的回答');
  assert.strictEqual(aiRecord.ragChunks.length, 1);
  assert.strictEqual(aiRecord.ragChunks[0].similarity, 0.87);
  assert.strictEqual(aiRecord.qualityScore, 8);
});

test('T3: listBySession 对不存在的 session 返回空数组', () => {
  const records = qa.listBySession('nonexistent_session_id');
  assert.deepStrictEqual(records, [], '不存在的 session 应返回空数组');
});

test('T4: appendRecord 校验必填字段', () => {
  assert.throws(
    () => {
      qa.appendRecord({
        userId: 'user1',
        userName: '用户',
        sessionId: 's_1',
        turn: 1,
        type: 'user',
        content: '内容',
        timestamp: '2026-08-12T10:00:00Z',
        role: 'product',
        bizLine: 'trade',
        // 缺少 id 字段
        workflowId: null,
        ragChunks: [],
        qualityScore: null,
        feedback: null,
        latencyMs: null,
      });
    },
    /必须是非空字符串/,
    '缺少必填字段应抛错'
  );
});

test('T5: listSessions 的 summary 截断到 50 字', () => {
  const sid = `s_summary_${Date.now()}`;
  const longContent = '这是一个很长很长的问题'.repeat(10);

  createTestSession(sid, '用户', 'product', 'trade', new Date().toISOString(), longContent);

  const sessions = qa.listSessions(100);
  const session = sessions.find((s) => s.sessionId === sid);

  assert(session, '应找到 session');
  assert(session.summary.length <= 50, 'summary 应截断到 50 字以内');
});
