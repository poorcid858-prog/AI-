/**
 * 路由 /api/admin/stats 测试 —— 阶段 6
 *
 * 覆盖：
 *   - 空库 → /stats 返 200 + 零值（不 500）
 *   - 上传 3 个 raw（不同 bizLine / 不同状态） → /stats 聚合正确
 *     - 总数 / documentsPending / totalChunks / documentsApproved / documentsRejected
 *     - byStatus (lifecycleStatus) / byBizLine / bySecurityLevel / byUploader
 *   - 现有 admin.html 用的字段（users / documents / documentsPending / totalChunks）必须保留
 *   - 非管理员 → 403；未登录 → 401
 *
 * 隔离（重要 —— 异步用法的坑）：
 *   node:test 并行跑测试时，**不能**让 withTempDataDir 这种"先 setUp、再 return
 *   异步 fn、最后 finally 清理"的写法用在 async 用例上 —— 异步 fn 是 promise，
 *   return promise 后 finally 块会**立即同步执行**，把 config.paths.data 改回去、
 *   临时目录删掉，再等 fn 完成时已经读到真实盘上的 30 条脏数据。
 *
 *   所以本文件所有用例都用**手动 setup / teardown**：
 *     1. 同步 setUp（config.paths.data = tmpDir, store.clearCache()）
 *     2. 启动 server / 跑断言
 *     3. finally 里同步 teardown（关 server, 清缓存, 删 tmpDir, 还原 config）
 *   不再用 withTempDataDir(fn) 包装异步函数。
 *
 * HTTP 端到端：起一个真 server，监听随机端口，用 Node 24 内置 fetch 调 /api/admin/stats。
 * 这样测的是路由层 + 中间件 + lib 串起来的真链路，不是 mock。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const auth = require('../lib/auth');
const kl = require('../lib/knowledge-layers');
const docs = require('../lib/documents');

// ============================================================
// 隔离夹具（手动 setup / teardown —— 见顶部说明）
// ============================================================

/** 起一个真 server，返回 baseUrl + 关闭函数。同步包好异步。 */
function startServer() {
  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      resolve({
        baseUrl,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
    server.on('error', reject);
  });
}

/** 调登录接口拿 token */
async function loginAs(baseUrl, username, password) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`login 失败: ${body.error}`);
  return body.token;
}

/** 直接调 /api/admin/stats 返 JSON */
async function getStats(baseUrl, token) {
  const res = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: token ? { 'x-token': token } : {},
  });
  return { status: res.status, body: await res.json() };
}

/** 同步 setUp：把 config.paths.data 切到独立 tmpDir，清缓存。返 close 闭包 */
function beginIsolation() {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-admin-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const realDataDir = config.paths.data;
  fs.mkdirSync(tmpDir, { recursive: true });
  config.paths.data = tmpDir;
  store.clearCache();
  auth.clearUsersCache();
  return {
    tmpDir,
    realDataDir,
    end() {
      config.paths.data = realDataDir;
      store.clearCache();
      auth.clearUsersCache();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* 已被清 */ }
    },
  };
}

// ============================================================
// 阶段 6 测试
// ============================================================

// ----- t1：空库 → /stats 返 200 + 零值 -----

test('GET /api/admin/stats：空库返 200 + 全零值（不 500）', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const { status, body } = await getStats(baseUrl, token);

      assert.strictEqual(status, 200, '应返 200');
      assert.strictEqual(body.ok, true, '应 ok=true');
      assert.ok(body.stats, '应含 stats 对象');

      // 现有 admin.html 用的字段：全 0
      assert.strictEqual(body.stats.users, 9, '9 个演示账号');
      assert.strictEqual(body.stats.documents, 0, '空库文档数应为 0');
      assert.strictEqual(body.stats.documentsPending, 0, '空库待审应为 0');
      assert.strictEqual(body.stats.documentsApproved, 0);
      assert.strictEqual(body.stats.documentsRejected, 0);
      assert.strictEqual(body.stats.totalChunks, 0, '空库切片数应为 0');

      // 新增聚合字段：全 0（每个状态 / 业务线 / 密级 / 上传者）
      assert.ok(body.stats.byStatus, '应含 byStatus 聚合');
      assert.ok(body.stats.byBizLine, '应含 byBizLine 聚合');
      assert.ok(body.stats.bySecurityLevel, '应含 bySecurityLevel 聚合');
      assert.ok(body.stats.byUploader, '应含 byUploader 聚合');
      assert.ok(Array.isArray(body.stats.recent), '应含 recent 数组');

      // byStatus 各 key 都应存在（即使 0）
      for (const k of ['draft', 'qc_failed', 'pending', 'approved', 'published', 'need_review', 'rejected', 'archived']) {
        assert.strictEqual(typeof body.stats.byStatus[k], 'number', `byStatus.${k} 应为数字`);
      }
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t2：3 个 raw（不同 bizLine / 不同状态） → 聚合正确 -----

test('GET /api/admin/stats：3 个 raw（不同 bizLine / 状态）聚合正确', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const admin = { username: 'admin', role: 'admin' };

      // 1) trade/internal/pending：admin 上传（默认走 PENDING）
      docs.upload(admin, {
        title: 'trade pending 文档',
        fileName: 'a.md',
        content: '这是一段足够长的内容用于验证 trade pending 状态的统计聚合。'.repeat(10),
        bizLine: 'trade',
        securityLevel: 'internal',
        uploadedBy: 'admin',
      });
      // 2) trade/confidential/published：admin上传 + 发布（走 PENDING → APPROVED → PUBLISHED）
      const v2 = docs.upload(admin, {
        title: 'trade published 文档',
        fileName: 'b.md',
        content: '这是一段足够长的内容用于验证 trade published 状态的统计聚合。'.repeat(10),
        bizLine: 'trade',
        securityLevel: 'confidential',
        uploadedBy: 'admin',
      });
      const stds2 = kl.listStdByRaw(v2.id);
      kl.setStdStatus(stds2[0].id, kl.STD_STATUS.APPROVED, { reviewedBy: 'reviewer', reviewNote: 'ok' });
      kl.publishStd(stds2[0].id);
      // 3) membership/public/rejected：admin上传 + 驳回
      const v3 = docs.upload(admin, {
        title: 'membership rejected 文档',
        fileName: 'c.md',
        content: '这是一段足够长的内容用于验证 membership rejected 状态的统计聚合。'.repeat(10),
        bizLine: 'membership',
        securityLevel: 'public',
        uploadedBy: 'admin',
      });
      const stds3 = kl.listStdByRaw(v3.id);
      kl.setStdStatus(stds3[0].id, kl.STD_STATUS.REJECTED, { reviewedBy: 'reviewer', reviewNote: 'no' });

      // 调接口
      const { status, body } = await getStats(baseUrl, token);
      assert.strictEqual(status, 200);
      assert.strictEqual(body.ok, true);

      // ---- 现有 admin.html 字段 ----
      assert.strictEqual(body.stats.users, 9);
      assert.strictEqual(body.stats.documents, 3, '3 条 raw');
      // 1 pending + 1 published(view.status=approved) + 1 rejected
      assert.strictEqual(body.stats.documentsPending, 1, 'view.status=pending 的有 1 条');
      assert.strictEqual(body.stats.documentsApproved, 1, 'view.status=approved 的有 1 条');
      assert.strictEqual(body.stats.documentsRejected, 1, 'view.status=rejected 的有 1 条');
      assert.ok(body.stats.totalChunks > 0, '应至少有 1 个 chunk');

      // ---- byStatus（按 lifecycleStatus 8 态）----
      assert.strictEqual(body.stats.byStatus.pending, 1, 'lifecycleStatus=pending 应有 1 条');
      assert.strictEqual(body.stats.byStatus.published, 1, 'lifecycleStatus=published 应有 1 条');
      assert.strictEqual(body.stats.byStatus.rejected, 1, 'lifecycleStatus=rejected 应有 1 条');
      assert.strictEqual(body.stats.byStatus.draft, 0, '无 draft');
      assert.strictEqual(body.stats.byStatus.approved, 0, '无 approved（已发布的不会留 approved）');
      assert.strictEqual(body.stats.byStatus.need_review, 0);
      assert.strictEqual(body.stats.byStatus.archived, 0);
      assert.strictEqual(body.stats.byStatus.qc_failed, 0);

      // ---- byBizLine ----
      assert.strictEqual(body.stats.byBizLine.trade, 2, 'trade 应有 2 条');
      assert.strictEqual(body.stats.byBizLine.membership, 1, 'membership 应有 1 条');
      assert.strictEqual(body.stats.byBizLine.all || 0, 0, '无 all');

      // ---- bySecurityLevel ----
      assert.strictEqual(body.stats.bySecurityLevel.internal, 1, 'internal 应有 1 条');
      assert.strictEqual(body.stats.bySecurityLevel.confidential, 1, 'confidential 应有 1 条');
      assert.strictEqual(body.stats.bySecurityLevel.public, 1, 'public 应有 1 条');
      assert.strictEqual(body.stats.bySecurityLevel.secret || 0, 0, '无 secret');

      // ---- byUploader ----
      assert.strictEqual(body.stats.byUploader.admin, 3, 'admin 上传 3 条');

      // ---- recent（最近 N 条）----
      assert.ok(body.stats.recent.length >= 1, 'recent 应至少有 1 条');
      // 最近一条应是 v3（最后上传）
      const recentIds = body.stats.recent.map((d) => d.id);
      assert.ok(recentIds.includes(v3.id), 'v3 应在 recent 列表里');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t3：非管理员访问 /stats 返 403（关键安全回归：后端必须拦） -----

test('GET /api/admin/stats：非管理员返 403', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'zhangsan', '123456');  // product 角色
      const res = await fetch(`${baseUrl}/api/admin/stats`, {
        headers: { 'x-token': token },
      });
      assert.strictEqual(res.status, 403, '非管理员应被 403');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t4：未登录访问 /stats 返 401 -----

test('GET /api/admin/stats：未登录返 401', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/admin/stats`);
      assert.strictEqual(res.status, 401, '未登录应被 401');
    } finally {
      await close();
      iso.end();
    }
  })();
});
