/**
 * QA 审计页 API 测试（需求 1）
 *
 * T1. 空库时返回空列表
 * T2. 有数据时返回 session 列表倒序
 * T3. 非 admin 角色 403
 * T4. 未登录 401
 * T5. 查看详情返回完整 record
 * T6. 不存在的 sessionId 返回 404
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');

const config = require('../config');
const app = require('../server');
const auth = require('../lib/auth');
const qa = require('../lib/qa-store');

// 创建临时数据目录以隔离测试
function withTempDataDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-test-'));
  const originalDir = config.paths.data;

  try {
    config.paths.data = tempDir;
    // 初始化 qa-store 使用新的数据目录
    return fn(tempDir);
  } finally {
    config.paths.data = originalDir;
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  }
}

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: config.port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: data ? JSON.parse(data) : null,
          });
        });
      }
    );

    req.on('error', (err) => {
      resolve({ status: 0, error: err.message });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function createMockToken(role = 'admin') {
  return Buffer.from(JSON.stringify({ id: 'user1', name: '测试用户', role })).toString('base64');
}

test('T1: 空库时返回空列表', async () => {
  return withTempDataDir(() => {
    const token = createMockToken('admin');
    return makeRequest('GET', '/api/admin/qa-history', { Authorization: `Bearer ${token}` }).then((res) => {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.deepStrictEqual(res.body.sessions, []);
      assert.strictEqual(res.body.total, 0);
    });
  });
});

test('T2: 有数据时返回 session 列表倒序', async () => {
  return withTempDataDir(() => {
    // 插入测试数据
    const session1 = 's_001';
    const session2 = 's_002';

    qa.appendRecord({
      id: 'qa_1',
      userId: 'user1',
      userName: '张三',
      sessionId: session1,
      turn: 1,
      type: 'user',
      content: '退款流程怎么写',
      timestamp: '2026-08-13T10:00:00Z',
      role: 'product',
      bizLine: 'trade',
      workflowId: null,
      ragChunks: [],
      qualityScore: null,
      feedback: null,
      latencyMs: null,
    });

    qa.appendRecord({
      id: 'qa_2',
      userId: 'user2',
      userName: '李四',
      sessionId: session2,
      turn: 1,
      type: 'user',
      content: '测试用例生成',
      timestamp: '2026-08-13T09:00:00Z',
      role: 'test',
      bizLine: 'membership',
      workflowId: null,
      ragChunks: [],
      qualityScore: null,
      feedback: null,
      latencyMs: null,
    });

    const token = createMockToken('admin');
    return makeRequest('GET', '/api/admin/qa-history', { Authorization: `Bearer ${token}` }).then((res) => {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert(res.body.sessions.length >= 2);
      assert.strictEqual(res.body.sessions[0].sessionId, session1); // 最新的在前（倒序）
      assert.strictEqual(res.body.sessions[0].userName, '张三');
      assert.strictEqual(res.body.sessions[0].role, 'product');
    });
  });
});

test('T3: 非 admin 角色 403', async () => {
  return withTempDataDir(() => {
    const token = createMockToken('product');
    return makeRequest('GET', '/api/admin/qa-history', { Authorization: `Bearer ${token}` }).then((res) => {
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.ok, false);
    });
  });
});

test('T4: 未登录 401', async () => {
  return withTempDataDir(() => {
    return makeRequest('GET', '/api/admin/qa-history').then((res) => {
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.ok, false);
    });
  });
});

test('T5: 查看详情返回完整 record', async () => {
  return withTempDataDir(() => {
    const sessionId = 's_detail';

    qa.appendRecord({
      id: 'qa_u1',
      userId: 'user1',
      userName: '张三',
      sessionId,
      turn: 1,
      type: 'user',
      content: '退款流程怎么写',
      timestamp: '2026-08-13T10:00:00Z',
      role: 'product',
      bizLine: 'trade',
      workflowId: null,
      ragChunks: [],
      qualityScore: null,
      feedback: null,
      latencyMs: null,
    });

    qa.appendRecord({
      id: 'qa_a1',
      userId: 'user1',
      userName: '张三',
      sessionId,
      turn: 1,
      type: 'ai',
      content: '退款流程 PRD 应包含 7 要素',
      timestamp: '2026-08-13T10:00:02Z',
      role: 'product',
      bizLine: 'trade',
      workflowId: 'wf_001',
      ragChunks: [
        {
          chunkId: 'chunk_017',
          content: '退款流程：用户在订单页面发起退款申请...',
          source: '退款规则.md',
          sourceDocId: 'raw_001',
          stdId: 'std_001_v2',
          similarity: 0.87,
          matchedKeywords: ['退款', '流程'],
          sectionPath: '第3章 退款流程 > 3.1 用户发起退款',
        },
      ],
      qualityScore: 8,
      feedback: null,
      latencyMs: 2341,
    });

    const token = createMockToken('admin');
    return makeRequest('GET', `/api/admin/qa-history/${sessionId}`, { Authorization: `Bearer ${token}` }).then((res) => {
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.session.sessionId, sessionId);
      assert.strictEqual(res.body.session.records.length, 2);

      const aiRecord = res.body.session.records[1];
      assert.strictEqual(aiRecord.type, 'ai');
      assert.strictEqual(aiRecord.qualityScore, 8);
      assert.strictEqual(aiRecord.ragChunks.length, 1);
      assert.strictEqual(aiRecord.ragChunks[0].similarity, 0.87);
      assert.strictEqual(aiRecord.latencyMs, 2341);
    });
  });
});

test('T6: 不存在的 sessionId 返回 404', async () => {
  return withTempDataDir(() => {
    const token = createMockToken('admin');
    return makeRequest('GET', '/api/admin/qa-history/nonexistent', { Authorization: `Bearer ${token}` }).then((res) => {
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.ok, false);
      assert(res.body.error.includes('session 不存在'));
    });
  });
});
