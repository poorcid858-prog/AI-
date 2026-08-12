/**
 * routes/documents.js 路由层测试 —— 阶段 5
 *
 * 覆盖：
 *   GET /api/documents/:id          —— 走 docs.getDocumentView（不再 store.read('documents')）
 *   GET /api/documents/:id/chunks   —— 走 docs.getDocumentView.chunks
 *
 * 设计：
 *   - 启动真实 Express server，用 Node 24 内置 fetch 打 HTTP（不引入 supertest）
 *   - before/after 钩子管理 server 生命周期（一次性启动/关闭）
 *   - 每个 test 用 withTempDataDirAsync 隔离数据（不污染真实 data/）
 *   - 与其他 test 文件并行（node:test 默认每个文件一个进程），端口用 0 让 OS 选
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');

// ============================================================
// 隔离夹具
// ============================================================

async function withTempDataDirAsync(fn) {
  const tmpDir = path.join(
    os.tmpdir(),
    `ai-assistant-rt-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  );
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    return await fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ============================================================
// server 生命周期 + HTTP 工具
// ============================================================

let server;
let baseUrl;

before(async () => {
  const app = require('../server');
  server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve(s)));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  if (server) server.close();
});

async function login(username) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: '123456' }),
  });
  if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.token;
}

async function upload(token, input) {
  const r = await fetch(`${baseUrl}/api/documents/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: JSON.stringify(input),
  });
  return { status: r.status, body: await r.json() };
}

async function getDoc(token, id) {
  const r = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(id)}`, {
    headers: { 'x-token': token },
  });
  return { status: r.status, body: await r.json() };
}

async function getChunks(token, id) {
  const r = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(id)}/chunks`, {
    headers: { 'x-token': token },
  });
  return { status: r.status, body: await r.json() };
}

// ============================================================
// 1. admin 上传 + GET /:id → 200 + view 形状
// ============================================================

test('GET /:id：admin 上传后取详情，200 + view 形状（含 status/lifecycleStatus/chunks）', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const up = await upload(adminToken, {
      title: '阶段 5 测试文档',
      fileName: 'p5.md',
      content: '# 阶段 5\n\n这是一段足够长的内容用于验证 GET /:id 端点的 view 形状返回。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });
    assert.ok(up.body.ok, 'upload 应成功');
    const id = up.body.document.id;
    assert.match(id, /^raw_/, 'id 应为 raw_ 前缀（阶段 2 改造后的形态）');

    const r = await getDoc(adminToken, id);
    assert.strictEqual(r.status, 200, 'admin 应能 200 取到详情');
    assert.ok(r.body.ok);
    const doc = r.body.document;
    assert.strictEqual(doc.id, id, '返回的 id 应与上传时一致');
    assert.strictEqual(doc.title, '阶段 5 测试文档');
    assert.strictEqual(doc.status, 'pending', '新上传 status 应映射到旧 3 值 pending');
    assert.strictEqual(doc.lifecycleStatus, 'pending', 'lifecycleStatus 应为 pending');
    assert.ok(doc.chunkCount > 0, '应至少有 1 个 chunk');
    // admin 看到完整 view（含 chunks 和 content）
    assert.ok(Array.isArray(doc.chunks), 'admin 应保留 chunks');
    assert.ok(doc.chunks.length > 0);
    assert.strictEqual(typeof doc.chunks[0].content, 'string', 'admin 应保留 chunks[].content');
  });
});

// ============================================================
// 2. admin 上传 + GET /:id/chunks → 200 + chunks 数组
// ============================================================

test('GET /:id/chunks：admin 上传后取切片，200 + 数组每项含 id/seq/heading/keywords/content', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const up = await upload(adminToken, {
      title: '切片测试',
      fileName: 'chunks.md',
      content: '# 切片\n\n这是一段足够长的内容用于验证 GET /:id/chunks 端点的切片形状返回。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });
    const id = up.body.document.id;

    const r = await getChunks(adminToken, id);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.docId, id);
    assert.ok(r.body.chunkCount > 0, '应至少有 1 个 chunk');
    assert.ok(Array.isArray(r.body.chunks));
    assert.strictEqual(r.body.chunks.length, r.body.chunkCount, 'chunks 数组长度应等于 chunkCount');
    // 切片形状：id/seq/heading/keywords/content
    const c0 = r.body.chunks[0];
    assert.ok(c0.id, 'chunk 应有 id');
    assert.strictEqual(typeof c0.seq, 'number', 'chunk 应有 seq');
    assert.ok('heading' in c0, 'chunk 应有 heading 字段（即便为 null）');
    assert.ok(Array.isArray(c0.keywords), 'chunk 应有 keywords 数组');
    assert.strictEqual(typeof c0.content, 'string', 'admin 应能看 content');
  });
});

// ============================================================
// 3. 不存在的 docId → 404（GET /:id）
// ============================================================

test('GET /:id：不存在的 docId → 404', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const r = await getDoc(adminToken, 'raw_不存在的id');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.ok, false);
    assert.strictEqual(r.body.error, '文档不存在');
  });
});

// ============================================================
// 4. readonly 用户取 GET /:id → view 形状但 chunks 被剥
// ============================================================

test('GET /:id：readonly 用户取详情，view 形状保留但 chunks 被剥', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest'); // readonly=true
    const up = await upload(adminToken, {
      title: 'readonly 测试',
      fileName: 'ro.md',
      content: '这是一段足够长的内容用于验证 readonly 用户取详情时 chunks 被剥。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });
    const id = up.body.document.id;

    const r = await getDoc(guestToken, id);
    assert.strictEqual(r.status, 200);
    const doc = r.body.document;
    // 元信息保留
    assert.strictEqual(doc.id, id);
    assert.strictEqual(doc.title, 'readonly 测试');
    assert.strictEqual(doc.status, 'pending');
    assert.strictEqual(doc.lifecycleStatus, 'pending');
    // chunks 被剥（publicView 拒绝给非 admin/reviewer）
    assert.strictEqual(doc.chunks, undefined, 'chunks 应被剥（防按段落切好的原文泄漏）');
  });
});

// ============================================================
// 5. 非 admin/reviewer 调 GET /:id/chunks → 403
// ============================================================

test('GET /:id/chunks：非 admin/reviewer 角色 → 403', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const productToken = await login('zhangsan'); // role: product（无权看切片）
    const up = await upload(adminToken, {
      title: '权限测试',
      fileName: 'perm.md',
      content: '这是一段足够长的内容用于验证非 admin/reviewer 角色调切片接口被拒。'.repeat(20),
      bizLine: 'trade',
      securityLevel: 'internal',
    });
    const id = up.body.document.id;

    const r = await getChunks(productToken, id);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.ok, false);
  });
});
