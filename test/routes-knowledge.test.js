/**
 * routes/knowledge.js 路由测试 —— 知识库四层架构 API
 *
 * 覆盖：
 *   GET /:layer                    —— 文档/标准化/chunks/embeddings 列表
 *   GET /:layer/:id                —— 单条详情
 *   GET /trace/:layer/:id          —— 追踪链路
 *   GET /raw/:docId/layers         —— 完整四层数据
 *   permissions                    —— 标准化/chunks/embeddings 层仅 admin/reviewer
 *
 * 设计：
 *   - 与 routes-documents.test.js 共享 server + 夹具 + fetch 模式
 *   - before/after 钩子管理 server 生命周期
 *   - 每个 test 用 withTempDataDirAsync 隔离数据
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const docs = require('../lib/documents');
const kl = require('../lib/knowledge-layers');

// ============================================================
// 隔离夹具
// ============================================================

async function withTempDataDirAsync(fn) {
  const tmpDir = path.join(
    os.tmpdir(),
    `ai-assistant-kn-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
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

async function review(token, docId, decision) {
  const r = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': token },
    body: JSON.stringify({ decision }),
  });
  return { status: r.status, body: await r.json() };
}

async function publish(token, docId) {
  const r = await fetch(`${baseUrl}/api/documents/${encodeURIComponent(docId)}/publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-token': token },
  });
  return { status: r.status, body: await r.json() };
}

async function getKnowledge(token, layer, q) {
  let url = `${baseUrl}/api/knowledge/${encodeURIComponent(layer)}`;
  if (q) url += `?q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { 'x-token': token } });
  return { status: r.status, body: await r.json() };
}

async function getKnowledgeDetail(token, layer, id) {
  const r = await fetch(
    `${baseUrl}/api/knowledge/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`,
    { headers: { 'x-token': token } }
  );
  return { status: r.status, body: await r.json() };
}

async function getTrace(token, layer, id) {
  const r = await fetch(
    `${baseUrl}/api/knowledge/trace/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`,
    { headers: { 'x-token': token } }
  );
  return { status: r.status, body: await r.json() };
}

async function getRawLayers(token, docId) {
  const r = await fetch(
    `${baseUrl}/api/knowledge/raw/${encodeURIComponent(docId)}/layers`,
    { headers: { 'x-token': token } }
  );
  return { status: r.status, body: await r.json() };
}

// 辅助：创建一个已发布的文档
async function createPublishedDoc(token) {
  const up = await upload(token, {
    title: '知识库测试文档',
    fileName: 'kb.md',
    content: '退款流程：用户在购买商品后14天内可以申请退款，退款将在7个工作日内原路返回。',
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: ['退款', '售后'],
  });
  const docId = up.body.document.id;
  await review(token, docId, 'approved');
  await publish(token, docId);
  return docId;
}

// ============================================================
// 1. documents 层列表
// ============================================================

test('GET /api/knowledge/documents：admin 应看到已上传文档（含字段映射）', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const docId = await createPublishedDoc(adminToken);

    const r = await getKnowledge(adminToken, 'documents');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.items));
    assert.ok(r.body.items.length > 0, '应有文档');

    const item = r.body.items.find(i => i.id === docId);
    assert.ok(item, '应找到刚创建的文档');
    assert.ok(item.filename, '应有 filename');
    assert.ok(item.file_type, '应有 file_type');
    assert.ok(item.uploader, '应有 uploader');
    assert.ok(item.upload_time, '应有 upload_time');
    assert.ok(item.review_status, '应有 review_status');
    assert.ok(item.created_at, '应有 created_at');
  });
});

test('GET /api/knowledge/documents：只读用户也能查看文档列表', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(guestToken, 'documents');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.items));
  });
});

test('GET /api/knowledge/documents：关键词搜索过滤', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    await createPublishedDoc(adminToken);

    // 搜索"退款"应命中
    const r = await getKnowledge(adminToken, 'documents', '退款');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.items.length > 0, '搜索"退款"应有结果');
  });
});

// ============================================================
// 2. standardized 层（仅 admin/reviewer）
// ============================================================

test('GET /api/knowledge/standardized：admin 可访问', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(adminToken, 'standardized');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.items));
  });
});

test('GET /api/knowledge/standardized：非 admin/reviewer 返回 403', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(guestToken, 'standardized');
    assert.strictEqual(r.status, 403);
  });
});

// ============================================================
// 3. chunks 层（仅 admin/reviewer）
// ============================================================

test('GET /api/knowledge/chunks：admin 可访问', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(adminToken, 'chunks');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.items));
  });
});

test('GET /api/knowledge/chunks：非 admin/reviewer 返回 403', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(guestToken, 'chunks');
    assert.strictEqual(r.status, 403);
  });
});

// ============================================================
// 4. embeddings 层（仅 admin/reviewer）
// ============================================================

test('GET /api/knowledge/embeddings：admin 可访问', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(adminToken, 'embeddings');
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.items));
  });
});

test('GET /api/knowledge/embeddings：非 admin/reviewer 返回 403', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest');
    await createPublishedDoc(adminToken);

    const r = await getKnowledge(guestToken, 'embeddings');
    assert.strictEqual(r.status, 403);
  });
});

// ============================================================
// 5. 单条详情
// ============================================================

test('GET /api/knowledge/documents/:id：admin 取详情', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const docId = await createPublishedDoc(adminToken);

    const r = await getKnowledgeDetail(adminToken, 'documents', docId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.data);
    assert.strictEqual(r.body.data.id, docId);
  });
});

test('GET /api/knowledge/documents/:id：不存在的 id 返回 404', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');

    const r = await getKnowledgeDetail(adminToken, 'documents', 'raw_不存在的id');
    assert.strictEqual(r.status, 404);
  });
});

// ============================================================
// 6. 追踪链路
// ============================================================

test('GET /api/knowledge/trace/documents/:id：从原始文档上溯应只有一层', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const docId = await createPublishedDoc(adminToken);

    const r = await getTrace(adminToken, 'documents', docId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(Array.isArray(r.body.path));
    // 从原始文档上溯只有自己一层
    assert.strictEqual(r.body.path.length, 1);
    assert.strictEqual(r.body.path[0].layer, 'documents');
  });
});

test('GET /api/knowledge/trace/chunks/:id：从 chunk 到原始文档的完整链路', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const docId = await createPublishedDoc(adminToken);

    // 获取 chunks 列表
    const chunks = await getKnowledge(adminToken, 'chunks');
    assert.ok(chunks.body.items.length > 0);
    const chunkId = chunks.body.items[0].id;

    // 追踪
    const r = await getTrace(adminToken, 'chunks', chunkId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    // 应至少有 2 层：documents + standardized + chunk
    assert.ok(r.body.path.length >= 2, 'chunk 追踪应至少有 2 层');
    const layers = r.body.path.map(p => p.layer);
    assert.ok(layers.includes('documents'), '应包含 documents 层');
    assert.ok(layers.includes('standardized'), '应包含 standardized 层');
    assert.ok(layers.includes('chunks'), '应包含 chunks 层');
  });
});

test('GET /api/knowledge/trace/embeddings/:id：从向量到原始文档的完整四层链路', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    await createPublishedDoc(adminToken);

    // 获取 embeddings 列表
    const embs = await getKnowledge(adminToken, 'embeddings');
    assert.ok(embs.body.items.length > 0, '已发布文档应有向量记录');
    const embId = embs.body.items[0].id;

    // 追踪完整链路
    const r = await getTrace(adminToken, 'embeddings', embId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    // 应包含完整的四层
    const layers = r.body.path.map(p => p.layer);
    assert.ok(layers.includes('documents'), '应包含 documents 层');
    assert.ok(layers.includes('standardized'), '应包含 standardized 层');
    assert.ok(layers.includes('chunks'), '应包含 chunks 层');
    assert.ok(layers.includes('embeddings'), '应包含 embeddings 层');
  });
});

test('GET /api/knowledge/trace/:layer/:id：不存在的 id 返回 404', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const r = await getTrace(adminToken, 'chunks', 'chk_不存在的id');
    assert.strictEqual(r.status, 404);
  });
});

// ============================================================
// 7. 完整四层数据
// ============================================================

test('GET /api/knowledge/raw/:docId/layers：admin 可看到完整四层', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const docId = await createPublishedDoc(adminToken);

    const r = await getRawLayers(adminToken, docId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.raw, '应有 raw 层');
    assert.ok(Array.isArray(r.body.standardized), 'standardized 应为数组');
    assert.ok(Array.isArray(r.body.chunks), 'chunks 应为数组');
    assert.ok(Array.isArray(r.body.embeddings), 'embeddings 应为数组');
    assert.ok(r.body.standardized.length > 0, '应有标准化文档');
    assert.ok(r.body.chunks.length > 0, '应有 chunk');
    assert.ok(r.body.embeddings.length > 0, '应有向量');
  });
});

test('GET /api/knowledge/raw/:docId/layers：guest 看不到 standardized/chunks/embeddings', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const guestToken = await login('guest');
    const docId = await createPublishedDoc(adminToken);

    const r = await getRawLayers(guestToken, docId);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.raw, 'guest 应看到 raw 层');
    assert.strictEqual(r.body.standardized.length, 0, 'guest 不应看到 standardized 层');
    assert.strictEqual(r.body.chunks.length, 0, 'guest 不应看到 chunks 层');
    assert.strictEqual(r.body.embeddings.length, 0, 'guest 不应看到 embeddings 层');
  });
});

test('GET /api/knowledge/raw/:docId/layers：不存在的 docId 返回 404', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const r = await getRawLayers(adminToken, 'raw_不存在的id');
    assert.strictEqual(r.status, 404);
  });
});

// ============================================================
// 8. 非法 layer 参数
// ============================================================

test('GET /api/knowledge/：非法层名返回 400', async () => {
  await withTempDataDirAsync(async () => {
    const adminToken = await login('admin');
    const r = await getKnowledge(adminToken, 'invalid_layer');
    assert.strictEqual(r.status, 400);
  });
});

// ============================================================
// 9. 未认证的请求
// ============================================================

test('GET /api/knowledge/：未登录返回 401', async () => {
  await withTempDataDirAsync(async () => {
    const r = await fetch(`${baseUrl}/api/knowledge/documents`, {});
    assert.strictEqual(r.status, 401);
  });
});