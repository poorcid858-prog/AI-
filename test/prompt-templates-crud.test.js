/**
 * 提问模板 CRUD API 测试 —— 任务包 K2
 *
 * 后端路由：routes/admin.js
 * 覆盖：
 *   - POST /api/admin/prompt-templates（新增模板）
 *   - PUT /api/admin/prompt-templates/:id（更新模板）
 *   - DELETE /api/admin/prompt-templates/:id（删除模板）
 *   - 最多 10 条拦截
 *   - 必填字段校验
 *   - 非管理员 403 拦截
 *   - 未登录 401 拦截
 *
 * 隔离策略同 routes-admin.test.js：手动 setup / teardown
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const auth = require('../lib/auth');

/** 起一个真 server，返回 baseUrl + 关闭函数 */
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

/** 登录拿 token */
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

/** 同步 setUp：切独立 tmpDir */
function beginIsolation() {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-prompt-tpl-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    },
  };
}

// ============================================================
// 测试用例
// ============================================================

// ----- t1：POST 新增模板 -----

test('POST /api/admin/prompt-templates：新增模板成功', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({
          name: '测试模板',
          content: '这是一个测试模板的内容',
          role: 'test',
          priority: 1,
          enabled: true,
        }),
      });
      const body = await res.json();
      assert.strictEqual(res.status, 201, '应返 201');
      assert.strictEqual(body.ok, true);
      assert.ok(body.template, '应含 template 对象');
      assert.strictEqual(body.template.name, '测试模板');
      assert.strictEqual(body.template.content, '这是一个测试模板的内容');
      assert.strictEqual(body.template.role, 'test');
      assert.strictEqual(body.template.priority, 1);
      assert.strictEqual(body.template.enabled, true);
      assert.ok(body.template.id, '应有 id');
      assert.ok(body.template.createdAt, '应有 createdAt');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t2：POST 缺少必填字段报错 -----

test('POST /api/admin/prompt-templates：缺少 name 报 400', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ content: '只有内容', role: 'test' }),
      });
      assert.strictEqual(res.status, 400, 'name 缺失应 400');
      const body = await res.json();
      assert.strictEqual(body.ok, false);
    } finally {
      await close();
      iso.end();
    }
  })();
});

test('POST /api/admin/prompt-templates：缺少 content 报 400', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '模板名', role: 'test' }),
      });
      assert.strictEqual(res.status, 400, 'content 缺失应 400');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t3：POST 超过 10 条拦截 -----

test('POST /api/admin/prompt-templates：超过 10 条返回 400', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      // 先插入 10 条
      for (let i = 0; i < 10; i++) {
        const r = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-token': token },
          body: JSON.stringify({ name: `模板${i}`, content: `内容${i}`, role: 'all' }),
        });
        assert.strictEqual(r.status, 201, `第 ${i + 1} 条应创建成功`);
      }
      // 第 11 条应被拒绝
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '第11条', content: '超出限制', role: 'all' }),
      });
      assert.strictEqual(res.status, 400, '超过 10 条应 400');
      const body = await res.json();
      assert.ok(body.error.includes('最多'), '错误消息应包含"最多"');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t4：PUT 更新模板 -----

test('PUT /api/admin/prompt-templates/:id：更新模板成功', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      // 先创建一条
      const createRes = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '原模板', content: '原内容', role: 'test', enabled: true }),
      });
      const created = await createRes.json();
      const tplId = created.template.id;

      // 更新
      const updateRes = await fetch(`${baseUrl}/api/admin/prompt-templates/${tplId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '更新后模板', content: '更新后内容', role: 'product', enabled: false }),
      });
      const updated = await updateRes.json();
      assert.strictEqual(updateRes.status, 200, '应返 200');
      assert.strictEqual(updated.ok, true);
      assert.strictEqual(updated.template.name, '更新后模板');
      assert.strictEqual(updated.template.content, '更新后内容');
      assert.strictEqual(updated.template.role, 'product');
      assert.strictEqual(updated.template.enabled, false);
      assert.ok(updated.template.updatedAt, '应有 updatedAt');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t5：PUT 不存在的模板返回 404 -----

test('PUT /api/admin/prompt-templates/:id：不存在的 id 返回 404', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates/99999`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '不存在', content: '内容', role: 'all' }),
      });
      assert.strictEqual(res.status, 404, '不存在的 id 应 404');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t6：DELETE 删除模板 -----

test('DELETE /api/admin/prompt-templates/:id：删除模板成功', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      // 先创建一条
      const createRes = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '待删除模板', content: '待删除', role: 'test' }),
      });
      const created = await createRes.json();
      const tplId = created.template.id;

      // 删除
      const delRes = await fetch(`${baseUrl}/api/admin/prompt-templates/${tplId}`, {
        method: 'DELETE',
        headers: { 'x-token': token },
      });
      assert.strictEqual(delRes.status, 200, '应返 200');
      const delBody = await delRes.json();
      assert.strictEqual(delBody.ok, true);

      // 确认已删除
      const getRes = await fetch(`${baseUrl}/api/admin/prompt-templates?role=all`, {
        headers: { 'x-token': token },
      });
      const getBody = await getRes.json();
      const remaining = getBody.templates.filter(t => t.id === tplId);
      assert.strictEqual(remaining.length, 0, '删除后不应再出现');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t7：DELETE 不存在的模板返回 404 -----

test('DELETE /api/admin/prompt-templates/:id：不存在的 id 返回 404', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'admin', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates/99999`, {
        method: 'DELETE',
        headers: { 'x-token': token },
      });
      assert.strictEqual(res.status, 404, '不存在的 id 应 404');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t8：非管理员访问 POST 403 -----

test('POST /api/admin/prompt-templates：非管理员返 403', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'zhangsan', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '模板', content: '内容', role: 'all' }),
      });
      assert.strictEqual(res.status, 403, '非管理员应 403');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t9：非管理员访问 PUT 403 -----

test('PUT /api/admin/prompt-templates/:id：非管理员返 403', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'zhangsan', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates/1`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-token': token },
        body: JSON.stringify({ name: '模板', content: '内容', role: 'all' }),
      });
      assert.strictEqual(res.status, 403, '非管理员应 403');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t10：非管理员访问 DELETE 403 -----

test('DELETE /api/admin/prompt-templates/:id：非管理员返 403', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const token = await loginAs(baseUrl, 'zhangsan', '123456');
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates/1`, {
        method: 'DELETE',
        headers: { 'x-token': token },
      });
      assert.strictEqual(res.status, 403, '非管理员应 403');
    } finally {
      await close();
      iso.end();
    }
  })();
});

// ----- t11：未登录访问 POST 401 -----

test('POST /api/admin/prompt-templates：未登录返 401', () => {
  const iso = beginIsolation();
  return (async () => {
    const { baseUrl, close } = await startServer();
    try {
      const res = await fetch(`${baseUrl}/api/admin/prompt-templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '模板', content: '内容', role: 'all' }),
      });
      assert.strictEqual(res.status, 401, '未登录应 401');
    } finally {
      await close();
      iso.end();
    }
  })();
});