/**
 * AI 能力中心可编辑 —— Task 1：能力存储引擎（lib/capability-engine.js）
 *
 * 覆盖（TDD，先红后绿）：
 *   T1. 初始化默认能力列表（4 个 skill：product/test/frontend/cs）
 *   T2. listCapabilitySummaries 不含草稿细节
 *   T3. getCapability / getPublished 读取
 *   T4. editDraft 保存草稿，生效版不变，版本号 = published.version + 1
 *   T5. getDraft 获取草稿
 *   T6. discardDraft 弃稿，生效版不变
 *   T7. publishDraft 发布：草稿→生效版，旧版→history
 *   T8. rollbackToVersion 用目标版本内容创建新草稿
 *   T9. getVersionHistory 版本历史（含 published/draft/history）
 *   T10. getAuditLog 记录所有操作，支持按 capId 过滤
 *   T11. trialRun 返回草稿版 + 生效版两个结果
 *   T12. diffTexts 文本差异
 *   T13. 边界：能力不存在抛 404 / 无草稿可发布抛 400
 *
 * 隔离：withTempDataDir —— 同步执行（finally 改回 config.paths.data）。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');

// ============================================================
// 隔离夹具（同步执行！异步会破坏隔离）
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-cap-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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
// T1. 初始化默认能力列表
// ============================================================

test('T1：首次调用初始化 4 个默认 skill（product/test/frontend/cs）', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const caps = cap.listCapabilities();
    assert.strictEqual(caps.length, 4, '应有 4 个默认能力');
    const ids = caps.map((c) => c.id).sort();
    assert.deepStrictEqual(ids, ['skill_cs', 'skill_frontend', 'skill_product', 'skill_test']);

    const p = caps.find((c) => c.id === 'skill_product');
    assert.strictEqual(p.type, 'skill');
    assert.strictEqual(p.published.version, 1, '首个生效版本号应为 1');
    assert.strictEqual(p.published.content.role, 'product');
    assert.ok(p.published.content.title, '应含 title');
    assert.ok(p.published.content.description, '应含 description');
    assert.ok(p.published.content.outputFormat, '应含 outputFormat');
    assert.strictEqual(p.draft, null, '初始无草稿');
    assert.strictEqual(p.history.length, 0, '初始无历史');
    assert.strictEqual(p.maxHistory, 10, '默认 maxHistory 应为 10');
    assert.ok(p.createdAt, '应记录创建时间');
    assert.ok(p.updatedAt, '应记录更新时间');
  });
});

// ============================================================
// T2. listCapabilitySummaries 含草稿状态，不含草稿细节
// ============================================================

test('T2：listCapabilitySummaries 返回摘要（不含 published/draft 内容细节）', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const summaries = cap.listCapabilitySummaries();
    assert.strictEqual(summaries.length, 4);
    for (const s of summaries) {
      assert.ok(s.id, '应含 id');
      assert.ok(s.type, '应含 type');
      assert.ok(s.name, '应含 name');
      assert.ok(s.description, '应含 description');
      assert.strictEqual(s.hasDraft, false, '初始无草稿');
      assert.strictEqual(s.publishedVersion, 1);
      assert.strictEqual(s.draftVersion, null);
      assert.ok(!s.published, '摘要不应含生效版内容');
      assert.ok(!s.draft, '摘要不应含草稿内容');
    }
  });
});

// ============================================================
// T3. getCapability / getPublished
// ============================================================

test('T3：getCapability 读取单个；getPublished 读取生效版', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const c = cap.getCapability('skill_product');
    assert.ok(c, '应能读到 capability');
    assert.strictEqual(c.id, 'skill_product');
    assert.strictEqual(cap.getCapability('not_exist'), null, '不存在返回 null');

    const pub = cap.getPublished('skill_product');
    assert.strictEqual(pub.version, 1);
    assert.strictEqual(pub.content.role, 'product');
  });
});

// ============================================================
// T4. editDraft
// ============================================================

test('T4：editDraft 保存草稿，生效版不变，版本号 = published.version + 1', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const newContent = {
      role: 'product',
      title: '产品经理（新版）',
      description: '自定义角色设定',
      outputFormat: '自定义输出格式',
    };
    const result = cap.editDraft('skill_product', newContent, 'admin');
    assert.ok(result.draft, '应有草稿');
    assert.strictEqual(result.draft.version, 2, '草稿版本号应为 published.version+1 = 2');
    assert.deepStrictEqual(result.draft.content, newContent);
    assert.strictEqual(result.published.version, 1, '生效版 version 应保持 1');
    assert.strictEqual(result.published.content.role, 'product', '生效版内容应不变');

    // 生效版内容确实未被改动（深拷贝隔离）
    assert.notStrictEqual(result.published.content.description, '自定义角色设定');
  });
});

// ============================================================
// T5. getDraft
// ============================================================

test('T5：getDraft 获取草稿；无草稿返回 null', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    assert.strictEqual(cap.getDraft('skill_product'), null, '无草稿时返回 null');
    cap.editDraft('skill_product', { title: 'x' }, 'admin');
    const draft = cap.getDraft('skill_product');
    assert.ok(draft, '应有草稿');
    assert.strictEqual(draft.content.title, 'x');
  });
});

// ============================================================
// T6. discardDraft
// ============================================================

test('T6：discardDraft 弃稿，生效版不变', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    cap.editDraft('skill_product', { title: '待弃稿' }, 'admin');
    assert.ok(cap.getDraft('skill_product'), '弃稿前应有草稿');

    const result = cap.discardDraft('skill_product', 'admin');
    assert.strictEqual(result.draft == null, true, '弃稿后草稿应为 null（或不存在）');
    assert.strictEqual(result.published.version, 1, '生效版应保持不变');
    assert.strictEqual(cap.getDraft('skill_product'), null);
  });
});

// ============================================================
// T7. publishDraft
// ============================================================

test('T7：publishDraft 发布：草稿→生效版，旧版→history', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    cap.editDraft('skill_product', { title: '草稿 v2', role: 'product' }, 'admin');
    const result = cap.publishDraft('skill_product', 'reviewer');

    assert.strictEqual(result.published.version, 2, '发布后生效版版本应为 2');
    assert.strictEqual(result.published.content.title, '草稿 v2');
    assert.strictEqual(result.draft, null, '发布后草稿应清空');
    assert.strictEqual(result.history.length, 1, '历史应有 1 条（旧版 v1）');
    assert.strictEqual(result.history[0].version, 1, '历史第一条应为 v1');
    assert.strictEqual(result.history[0].content.role, 'product', '历史应保留 v1 内容');
  });
});

// ============================================================
// T8. rollbackToVersion
// ============================================================

test('T8：rollbackToVersion 用目标版本内容创建新草稿（不直接生效）', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    // v1（默认）：content.role=product
    // 发布 v2
    cap.editDraft('skill_product', { title: 'v2', role: 'product' }, 'admin');
    cap.publishDraft('skill_product', 'reviewer');
    // 回滚到 v1
    const result = cap.rollbackToVersion('skill_product', 1, 'admin');

    assert.ok(result.draft, '回滚应创建草稿');
    assert.strictEqual(result.draft.version, 3, '新草稿版本号应为当前生效版.version+1 = 3');
    // v1 默认 skill 内容应有 title = '产品经理'
    assert.strictEqual(result.draft.content.title, '产品经理', 'v1 副本应有 title');
    assert.strictEqual(result.draft.content.role, 'product', '草稿内容应等于目标版本 v1 内容');
    assert.strictEqual(result.published.version, 2, '生效版应保持 2（回滚不直接生效）');
  });
});

// ============================================================
// T9. getVersionHistory
// ============================================================

test('T9：getVersionHistory 含生效版、草稿、历史，按版本倒序', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    cap.editDraft('skill_product', { v: 'draft3' }, 'admin');        // draft v2
    cap.publishDraft('skill_product', 'reviewer');                    // published v2
    cap.editDraft('skill_product', { v: 'draft4' }, 'admin');         // 新 draft v3

    const versions = cap.getVersionHistory('skill_product');
    assert.strictEqual(versions.length, 3, '应有 3 条：published v2 + draft v3 + history v1');

    // 按版本倒序：v3 draft > v2 published > v1 history
    assert.strictEqual(versions[0].version, 3);
    assert.strictEqual(versions[0].status, 'draft');
    assert.strictEqual(versions[1].version, 2);
    assert.strictEqual(versions[1].status, 'published');
    assert.strictEqual(versions[2].version, 1);
    assert.strictEqual(versions[2].status, 'history');

    // 每条的 content 字段应存在
    for (const v of versions) assert.ok(v.content !== undefined);
  });
});

// ============================================================
// T10. getAuditLog
// ============================================================

test('T10：getAuditLog 记录所有操作，支持按 capId 过滤', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    cap.editDraft('skill_product', { a: 1 }, 'admin');
    cap.publishDraft('skill_product', 'reviewer');
    cap.editDraft('skill_test', { a: 2 }, 'admin');
    cap.discardDraft('skill_test', 'admin');

    const all = cap.getAuditLog();
    assert.strictEqual(all.length, 4, '应有 4 条审计记录');

    // 按 capId 过滤
    const prodLogs = cap.getAuditLog({ capId: 'skill_product' });
    assert.strictEqual(prodLogs.length, 2, 'skill_product 应有 2 条');
    assert.ok(prodLogs.every((l) => l.capId === 'skill_product'));

    // 每条审计字段完整
    for (const l of all) {
      assert.ok(l.action, '应含 action');
      assert.ok(l.capId, '应含 capId');
      assert.ok(l.editedBy || l.publishedBy, '应含操作人');
      assert.ok(l.timestamp, '应含 timestamp');
    }

    // actions 正确
    const actions = all.map((l) => l.action).sort();
    assert.deepStrictEqual(actions, ['discard_draft', 'edit_draft', 'edit_draft', 'publish']);
  });
});

// ============================================================
// T11. trialRun
// ============================================================

test('T11：trialRun 返回草稿版 + 生效版两个结果', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    cap.editDraft('skill_product', {
      title: '产品经理草稿版',
      description: '草稿描述',
      outputFormat: '草稿格式',
    }, 'admin');

    const run = cap.trialRun('skill_product', '帮我写退款流程PRD', 'product', 'trade');

    assert.ok(run.draft, '应有 draft 结果');
    assert.ok(run.draft.prompt, 'draft 应有 prompt');
    assert.ok(run.draft.result, 'draft 应有 result');
    assert.ok(run.published, '应有 published 结果');
    assert.ok(run.published.prompt, 'published 应有 prompt');
    assert.ok(run.published.result, 'published 应有 result');

    // 两个 prompt 应不同（草稿版 vs 生效版）
    assert.notStrictEqual(run.draft.prompt, run.published.prompt, '草稿与生效版 prompt 应不同');
    // 草稿 prompt 应包含草稿描述
    assert.ok(run.draft.prompt.includes('草稿描述'), '草稿 prompt 应含草稿描述');
    // 生效版 prompt 不应含草稿描述
    assert.ok(!run.published.prompt.includes('草稿描述'), '生效版 prompt 不应含草稿描述');
    // 生效版 prompt 应含原始生效版描述（"专业的产品经理"）
    assert.ok(run.published.prompt.includes('专业的产品经理'), '生效版 prompt 应含默认描述');

    assert.ok(Array.isArray(run.ragChunks), '应返回 ragChunks 数组');
  });
});

// ============================================================
// T12. diffTexts
// ============================================================

test('T12：diffTexts 文本差异', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const a = 'line1\nsame\nline3';
    const b = 'line1\nsame modified\nline3';
    const diff = cap.diffTexts(a, b);
    assert.ok(diff, '应返回差异对象');
    assert.ok(typeof diff.removed === 'string', '应有 removed');
    assert.ok(typeof diff.added === 'string', '应有 added');

    // 空参数边界
    const empty = cap.diffTexts('', 'x');
    assert.strictEqual(empty.added, 'x');
    const empty2 = cap.diffTexts('x', '');
    assert.strictEqual(empty2.removed, 'x');
  });
});

// ============================================================
// T13. 边界：能力不存在 / 无草稿可发布
// ============================================================

test('T13：边界 —— 能力不存在抛 404；无草稿可发布抛 400', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');

    // 编辑不存在的能力
    assert.throws(
      () => cap.editDraft('not_exist', { a: 1 }, 'admin'),
      (e) => e.status === 404,
      '编辑不存在的能力应抛 404'
    );

    // 无草稿就发布
    assert.throws(
      () => cap.publishDraft('skill_product', 'admin'),
      (e) => e.status === 400,
      '无草稿发布应抛 400'
    );

    // 无草稿试跑
    assert.throws(
      () => cap.trialRun('skill_product', 'q', 'product', 'trade'),
      (e) => e.status === 400,
      );
  });
});

// ============================================================
// API 路由测试（Task 2）
// ============================================================
// 启动真实 Express server，用内置 fetch 打 HTTP
// 使用 withTempDataDirAsync 隔离数据

const { test: test2, before, after } = require('node:test');

let server;
let baseUrl;

async function withTempDataDirAsync(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-cap-api-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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

async function api(method, path, token, body) {
  const opts = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (token) opts.headers['x-token'] = token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${baseUrl}${path}`, opts);
  return { status: r.status, body: await r.json() };
}

// ============================================================
// T14. GET /api/capabilities 列表
// ============================================================

test2('T14：GET /api/capabilities → 200 + 4 个摘要', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('GET', '/api/capabilities', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.total, 4);
    assert.ok(Array.isArray(r.body.capabilities));
    for (const s of r.body.capabilities) {
      assert.ok(s.id);
      assert.ok(s.name);
      assert.strictEqual(s.hasDraft, false);
      assert.strictEqual(s.publishedVersion, 1);
      assert.strictEqual(s.draftVersion, null);
    }
  });
});

// ============================================================
// T15. GET /api/capabilities/:id 详情
// ============================================================

test2('T15：GET /api/capabilities/:id → 200 + 完整能力对象', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('GET', '/api/capabilities/skill_product', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.capability.id, 'skill_product');
    assert.strictEqual(r.body.capability.published.version, 1);
    assert.strictEqual(r.body.capability.draft, null);
  });
});

// ============================================================
// T16. GET /api/capabilities/:id 不存在 → 404
// ============================================================

test2('T16：GET /api/capabilities/:id 不存在 → 404', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('GET', '/api/capabilities/not_exist', token);
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T17. POST /api/capabilities/:id/draft 编辑草稿
// ============================================================

test2('T17：POST /api/capabilities/:id/draft → 200 + 草稿创建成功', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const newContent = { title: '新版产品经理', description: '自定义描述', outputFormat: '自定义格式' };
    const r = await api('POST', '/api/capabilities/skill_product/draft', token, { content: newContent });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.capability.draft.version, 2);
    assert.deepStrictEqual(r.body.capability.draft.content, newContent);
    assert.strictEqual(r.body.capability.published.version, 1);
  });
});

// ============================================================
// T18. GET /api/capabilities/:id/draft 获取草稿
// ============================================================

test2('T18：GET /api/capabilities/:id/draft → 200 + 草稿内容', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: 'xxx' } });
    const r = await api('GET', '/api/capabilities/skill_product/draft', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.draft.content.title, 'xxx');
  });
});

// ============================================================
// T19. DELETE /api/capabilities/:id/draft 弃稿
// ============================================================

test2('T19：DELETE /api/capabilities/:id/draft → 200 + 草稿清空', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: '待弃稿' } });
    const r = await api('DELETE', '/api/capabilities/skill_product/draft', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(!r.body.capability.draft, '弃稿后草稿应为空');
    assert.strictEqual(r.body.capability.published.version, 1);
  });
});

// ============================================================
// T20. DELETE /api/capabilities/:id/draft 无草稿可弃 → 400
// ============================================================

test2('T20：DELETE /api/capabilities/:id/draft 无草稿 → 400', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('DELETE', '/api/capabilities/skill_product/draft', token);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T21. POST /api/capabilities/:id/publish 发布
// ============================================================

test2('T21：POST /api/capabilities/:id/publish → 200 + 草稿→生效版', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: '草稿 v2', role: 'product' } });
    const r = await api('POST', '/api/capabilities/skill_product/publish', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.capability.published.version, 2);
    assert.strictEqual(r.body.capability.published.content.title, '草稿 v2');
    assert.strictEqual(r.body.capability.draft, null);
    assert.strictEqual(r.body.capability.history.length, 1);
  });
});

// ============================================================
// T22. POST /api/capabilities/:id/publish 无草稿 → 400
// ============================================================

test2('T22：POST /api/capabilities/:id/publish 无草稿 → 400', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('POST', '/api/capabilities/skill_product/publish', token);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T23. POST /api/capabilities/:id/rollback 回滚
// ============================================================

test2('T23：POST /api/capabilities/:id/rollback → 200 + 新草稿', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: 'v2', role: 'product' } });
    await api('POST', '/api/capabilities/skill_product/publish', token);
    const r = await api('POST', '/api/capabilities/skill_product/rollback', token, { version: 1 });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.capability.draft.version, 3);
    assert.strictEqual(r.body.capability.published.version, 2);
    assert.ok(r.body.capability.draft.content.title);
  });
});

// ============================================================
// T24. POST /api/capabilities/:id/rollback 缺少 version → 400
// ============================================================

test2('T24：POST /api/capabilities/:id/rollback 缺少 version → 400', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('POST', '/api/capabilities/skill_product/rollback', token, {});
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T25. GET /api/capabilities/:id/versions 版本历史
// ============================================================

test2('T25：GET /api/capabilities/:id/versions → 200 + 版本列表', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { v: 'draft2' } });
    await api('POST', '/api/capabilities/skill_product/publish', token);
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { v: 'draft3' } });
    const r = await api('GET', '/api/capabilities/skill_product/versions', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.versions.length, 3);
    assert.strictEqual(r.body.versions[0].version, 3);
    assert.strictEqual(r.body.versions[0].status, 'draft');
    assert.strictEqual(r.body.versions[1].version, 2);
    assert.strictEqual(r.body.versions[1].status, 'published');
    assert.strictEqual(r.body.versions[2].version, 1);
    assert.strictEqual(r.body.versions[2].status, 'history');
  });
});

// ============================================================
// T26. GET /api/capabilities/audit 审计日志
// ============================================================

test2('T26：GET /api/capabilities/audit → 200 + 审计日志', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: 'x' } });
    await api('POST', '/api/capabilities/skill_product/publish', token);
    const r = await api('GET', '/api/capabilities/audit', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.total >= 2);
    assert.ok(Array.isArray(r.body.logs));
    for (const l of r.body.logs) {
      assert.ok(l.action);
      assert.ok(l.capId);
      assert.ok(l.timestamp);
    }
  });
});

// ============================================================
// T27. GET /api/capabilities/audit?capId= 过滤
// ============================================================

test2('T27：GET /api/capabilities/audit?capId=skill_product → 过滤', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: 'x' } });
    await api('POST', '/api/capabilities/skill_test/draft', token, { content: { title: 'y' } });
    const r = await api('GET', '/api/capabilities/audit?capId=skill_product', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.logs.every((l) => l.capId === 'skill_product'));
  });
});

// ============================================================
// T28. POST /api/capabilities/:id/trial 试跑
// ============================================================

test2('T28：POST /api/capabilities/:id/trial → 200 + 草稿+生效版结果', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    await api('POST', '/api/capabilities/skill_product/draft', token, {
      content: { title: '产品经理草稿版', description: '草稿描述', outputFormat: '草稿格式' },
    });
    const r = await api('POST', '/api/capabilities/skill_product/trial', token, {
      testQuestion: '帮我写退款流程PRD',
      role: 'product',
      bizLine: 'trade',
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.draft, '应有 draft 结果');
    assert.ok(r.body.draft.prompt, 'draft 应有 prompt');
    assert.ok(r.body.draft.result, 'draft 应有 result');
    assert.ok(r.body.published, '应有 published 结果');
    assert.ok(Array.isArray(r.body.ragChunks), '应有 ragChunks');
  });
});

// ============================================================
// T29. POST /api/capabilities/:id/trial 无草稿 → 400
// ============================================================

test2('T29：POST /api/capabilities/:id/trial 无草稿 → 400', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('POST', '/api/capabilities/skill_product/trial', token, {
      testQuestion: '测试问题',
    });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T30. POST /api/capabilities/diff 文本差异
// ============================================================

test2('T30：POST /api/capabilities/diff → 200 + 差异对象', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('POST', '/api/capabilities/diff', token, {
      a: 'line1\nsame\nline3',
      b: 'line1\nsame modified\nline3',
    });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.ok(r.body.diff);
    assert.ok(typeof r.body.diff.removed === 'string');
    assert.ok(typeof r.body.diff.added === 'string');
  });
});

// ============================================================
// T31. GET /api/capabilities/:id/published 生效版
// ============================================================

test2('T31：GET /api/capabilities/:id/published → 200 + 生效版', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('GET', '/api/capabilities/skill_product/published', token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.ok);
    assert.strictEqual(r.body.published.version, 1);
    assert.strictEqual(r.body.published.content.role, 'product');
  });
});

// ============================================================
// T32. 未登录 → 401
// ============================================================

test2('T32：未登录调能力接口 → 401', async () => {
  const r = await api('GET', '/api/capabilities', null);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.ok, false);
});

// ============================================================
// T33. guest（只读）调写操作 → 403
// ============================================================

test2('T33：guest 写操作 → 403', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('guest');
    const r = await api('POST', '/api/capabilities/skill_product/draft', token, { content: { title: 'x' } });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.ok, false);
  });
});

// ============================================================
// T36. POST /api/capabilities 创建新能力
// ============================================================

test2('T36：POST /api/capabilities → 201 + 新能力对象', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');
    const r = await api('POST', '/api/capabilities', token, {
      type: 'workflow',
      name: 'API创建的工作流',
      description: 'Via API',
      content: { steps: ['s1', 's2'] },
    });
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.ok);
    assert.ok(r.body.capability, '应返回新创建的能力');
    assert.ok(r.body.capability.id.startsWith('cap_workflow_'));
    assert.strictEqual(r.body.capability.type, 'workflow');
    assert.strictEqual(r.body.capability.name, 'API创建的工作流');
    assert.strictEqual(r.body.capability.published.version, 1);
  });
});

// ============================================================
// T37. DELETE /api/capabilities/:id 删除能力
// ============================================================

test2('T37：DELETE /api/capabilities/:id → 200 + 删除成功', async () => {
  await withTempDataDirAsync(async () => {
    const token = await login('admin');

    // 先创建一个能力
    const createRes = await api('POST', '/api/capabilities', token, {
      type: 'reference',
      name: '待删除的参考资料',
      description: 'To be deleted',
      content: {},
    });
    assert.strictEqual(createRes.status, 201);
    const capId = createRes.body.capability.id;

    // 验证能力存在
    let getRes = await api('GET', `/api/capabilities/${capId}`, token);
    assert.strictEqual(getRes.status, 200, '删除前能力应存在');

    // 删除能力
    const deleteRes = await api('DELETE', `/api/capabilities/${capId}`, token);
    assert.strictEqual(deleteRes.status, 200);
    assert.ok(deleteRes.body.ok);

    // 验证能力已删除
    getRes = await api('GET', `/api/capabilities/${capId}`, token);
    assert.strictEqual(getRes.status, 404, '删除后能力应不存在');
  });
});

// ============================================================
// T34. createCapability 创建新能力
// ============================================================

test('T34：createCapability 创建 workflow 类型的新能力', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const newCap = cap.createCapability(
      'workflow',
      '代码审查工作流',
      '自动执行代码审查',
      { steps: ['分析', '输出报告'] },
      'admin'
    );

    assert.ok(newCap.id, '应生成 ID');
    assert.ok(newCap.id.startsWith('cap_workflow_'), '应以 cap_workflow_ 开头');
    assert.strictEqual(newCap.type, 'workflow', '类型应为 workflow');
    assert.strictEqual(newCap.name, '代码审查工作流', '名称应匹配');
    assert.strictEqual(newCap.description, '自动执行代码审查', '描述应匹配');
    assert.ok(newCap.published, '应有生效版');
    assert.strictEqual(newCap.published.version, 1, '首版本应为 1');
    assert.deepStrictEqual(newCap.published.content, { steps: ['分析', '输出报告'] }, '内容应匹配');
    assert.strictEqual(newCap.published.publishedBy, 'admin', '发布者应为 admin');
    assert.strictEqual(newCap.draft, null, '初始无草稿');
    assert.ok(Array.isArray(newCap.history), '应有历史数组');
    assert.strictEqual(newCap.history.length, 0, '初始无历史');
    assert.ok(newCap.createdAt, '应记录创建时间');
    assert.ok(newCap.updatedAt, '应记录更新时间');

    // 验证能力已保存到列表
    const all = cap.listCapabilities();
    const found = all.find(c => c.id === newCap.id);
    assert.ok(found, '能力应在列表中');
    assert.strictEqual(found.type, 'workflow');
    assert.strictEqual(found.name, '代码审查工作流');
  });
});

// ============================================================
// T35. deleteCapability 删除能力
// ============================================================

test('T35：deleteCapability 删除创建的能力', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const newCap = cap.createCapability('reference', '参考资料库', '公司文档库', {}, 'admin');
    const capId = newCap.id;

    // 验证能力存在
    let found = cap.getCapability(capId);
    assert.ok(found, '创建后能力应存在');

    // 删除能力
    const result = cap.deleteCapability(capId, 'admin');
    assert.strictEqual(result, true, '删除应返回 true');

    // 验证能力已删除
    found = cap.getCapability(capId);
    assert.strictEqual(found, null, '删除后能力应不存在');

    // 验证能力从列表中移除
    const all = cap.listCapabilities();
    const inList = all.some(c => c.id === capId);
    assert.strictEqual(inList, false, '能力应从列表中移除');
  });
});