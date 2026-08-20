/**
 * M4: 知识中心异步处理路由测试
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const ap = require('../lib/async-processor');

function withData(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-m4-route-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    ap.resetForTest();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    ap.resetForTest();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

let server;
let baseUrl;
let adminToken;

function startServer() {
  return new Promise((resolve) => {
    const app = require('../server');
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = 'http://127.0.0.1:' + port;
      const loginBody = JSON.stringify({ username: 'admin', password: '123456' });
      const req = http.request(baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            adminToken = j.token;
            resolve();
          } catch (e) { resolve(); }
        });
      });
      req.write(loginBody);
      req.end();
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (server) { server.close(() => resolve()); } else { resolve(); }
  });
}

function httpReq(method, urlPath, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-token'] = token;
    const url = new URL(urlPath, baseUrl);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test('M4-R1: setup', async () => {
  await startServer();
  assert.ok(baseUrl);
  assert.ok(adminToken);
});

test('M4-R2: POST /generate-vectors 返回 taskId 不阻塞', { skip: !baseUrl }, async () => {
  await withData(async () => {
    const doc = kl.createDocument({ documentName: '路由测试文档' });
    const version = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'raw_001', metadata: {} });
    kl.updateDocumentVersion(version.version_id, { review_status: 'approved' });
    kl.createRaw({
      title: '测试', fileName: 't.md',
      content: '# 标题\n\n这是足够长的内容用于测试异步处理流程。'.repeat(5),
      bizLine: 'trade', securityLevel: 'internal',
      documentId: doc.document_id, versionId: version.version_id,
    });

    const res = await httpReq('POST', '/api/processing/knowledge/' + version.version_id + '/generate-vectors', {}, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.taskId, '应返回 taskId');
    assert.strictEqual(res.body.status, 'queued');
    assert.deepStrictEqual(res.body.phases, ['standardize', 'chunking', 'meta_recognize', 'embedding']);
  });
});

test('M4-R3: GET /tasks/:taskId 返回完整进度', { skip: !baseUrl }, async () => {
  await withData(async () => {
    const task = ap.createTask({ versionId: 'ver_test', triggeredBy: 'admin' });
    const res = await httpReq('GET', '/api/processing/knowledge/tasks/' + task.task_id, null, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.taskId, task.task_id);
    assert.strictEqual(res.body.status, 'queued');
    assert.strictEqual(res.body.progress, 0);
    assert.strictEqual(res.body.phases.length, 4);
  });
});

test('M4-R4: POST /tasks/:taskId/retry 拒绝非 failed 任务', { skip: !baseUrl }, async () => {
  await withData(async () => {
    const task = ap.createTask({ versionId: 'ver_test' });
    const res = await httpReq('POST', '/api/processing/knowledge/tasks/' + task.task_id + '/retry', {}, adminToken);
    assert.strictEqual(res.status, 409, 'queued 任务应返回 409');
  });
});

test('M4-R5: POST /batch-generate 一个失败不影响其他', { skip: !baseUrl }, async () => {
  await withData(async () => {
    const doc = kl.createDocument({ documentName: 'batch' });
    const v2 = kl.createDocumentVersion(doc.document_id, { sourceFileId: 'r1', metadata: {} });
    kl.updateDocumentVersion(v2.version_id, { review_status: 'approved' });
    kl.createRaw({
      title: 't', fileName: 't.md', content: '# 标题\n\n内容足够长。'.repeat(5),
      bizLine: 'trade', securityLevel: 'internal',
      documentId: doc.document_id, versionId: v2.version_id,
    });

    const res = await httpReq('POST', '/api/processing/knowledge/batch-generate', {
      versionIds: ['ver_nonexistent', v2.version_id],
    }, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.total, 2);
    assert.strictEqual(res.body.successCount, 1);
    assert.strictEqual(res.body.failCount, 1);
    assert.strictEqual(res.body.results[0].ok, false);
    assert.strictEqual(res.body.results[1].ok, true);
  });
});

test('M4-R6: GET /tasks/list 支持 versionId 过滤', { skip: !baseUrl }, async () => {
  await withData(async () => {
    ap.createTask({ versionId: 'ver_a' });
    ap.createTask({ versionId: 'ver_a' });
    ap.createTask({ versionId: 'ver_b' });

    const all = await httpReq('GET', '/api/processing/knowledge/tasks/list', null, adminToken);
    assert.strictEqual(all.body.total, 3);

    const a = await httpReq('GET', '/api/processing/knowledge/tasks/list?versionId=ver_a', null, adminToken);
    assert.strictEqual(a.body.total, 2);
  });
});

test('M4-R7: GET /status/:versionId 查处理状态', { skip: !baseUrl }, async () => {
  await withData(async () => {
    const res = await httpReq('GET', '/api/processing/knowledge/status/ver_nostart', null, adminToken);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'not_started');
  });
});

test('M4-R8: 未登录返回 401', { skip: !baseUrl }, async () => {
  const res = await httpReq('GET', '/api/processing/knowledge/tasks/list');
  assert.strictEqual(res.status, 401);
});

test('M4-R9: 任务不存在返回 404', { skip: !baseUrl }, async () => {
  const res = await httpReq('GET', '/api/processing/knowledge/tasks/task_nonexistent', null, adminToken);
  assert.strictEqual(res.status, 404);
});

test('M4-R10: teardown', async () => {
  await stopServer();
});
