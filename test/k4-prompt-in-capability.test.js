/**
 * K4 测试：Prompt 配置移入能力中心 + UI 美化
 *
 * 验证点：
 * 1. 侧边栏 Prompt 子菜单指向 /capability.html#prompt
 * 2. capability.html 包含 Prompt 分层管理界面
 * 3. 不破坏 K1/K2/K3 已有功能
 * 4. lib/admin-config.js 的 prompt-layers CRUD 函数存在
 * 5. 后端 prompt-layers API 完整工作流（使用 http 请求，不依赖 supertest）
 * 6. 非 admin 访问 403
 * 7. 缺 level 时 400
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ========== 静态文件测试 ==========

test('K4: sidebar.js 的 Prompt 子菜单应指向 /capability.html#prompt', () => {
  const sidebar = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  const promptSection = sidebar.match(/\{[^}]*key:\s*'prompt'[^}]*\}/);
  assert.ok(promptSection, '应能找到 prompt 子菜单配置');
  assert.ok(
    promptSection[0].includes('/capability.html#prompt'),
    `Prompt 菜单 href 应指向 /capability.html#prompt，实际: ${promptSection[0]}`
  );
  assert.ok(
    !promptSection[0].includes('/admin-config.html'),
    'Prompt 菜单不应再指向 admin-config.html'
  );
});

test('K4: capability.html 应包含 Prompt 分层配置管理界面', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');
  assert.ok(html.includes('Prompt'), '能力中心应有 Prompt 类型入口');
  assert.ok(
    html.includes('promptLayers') || html.includes('promptLayer') || html.includes('prompt-layers'),
    '应有分层 prompt 操作相关代码'
  );
});

test('K4: capability.html 应保留聚合视图结构（不破坏 K1/K2/K3）', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');
  assert.ok(html.includes('capabilityListArea'), '应保留能力列表区域');
  assert.ok(html.includes('newCapBtn'), '应保留新建能力按钮');
  assert.ok(html.includes('detailPanel'), '应保留详情面板');
  assert.ok(html.includes('App.renderSidebar'), '应保留侧边栏渲染');
  assert.ok(html.includes('loadCapabilities'), '应保留加载能力列表');
  assert.ok(html.includes('workflow'), '保留 workflow');
  assert.ok(html.includes('skill'), '保留 skill');
  assert.ok(html.includes('reference'), '保留 reference');
  assert.ok(html.includes('script'), '保留 script');
  assert.ok(html.includes('tool'), '保留 tool');
});

// ========== 后端 API 测试 ==========

test('K4: lib/admin-config.js 的分层 prompt CRUD 函数应存在', () => {
  const adminConfig = require('../lib/admin-config');
  assert.strictEqual(typeof adminConfig.listPromptLayers, 'function');
  assert.strictEqual(typeof adminConfig.createPromptLayer, 'function');
  assert.strictEqual(typeof adminConfig.updatePromptLayer, 'function');
  assert.strictEqual(typeof adminConfig.deletePromptLayer, 'function');
  assert.strictEqual(typeof adminConfig.getPromptLayer, 'function');
});

/** 启动临时 server，返回 { baseUrl, close }，参考 prompt-templates-crud.test.js */
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

test('K4: prompt-layers API 完整 CRUD 工作流', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'admin', '123456');

    // 1. 列表（初始）
    let listRes = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    let list = await listRes.json();
    assert.ok(list.ok, '初始列表应成功');
    const initialCount = list.layers.length;

    // 2. 新增
    const createdRes = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ level: 'role', role_name: 'product', business_line: 'trade', prompt_text: '你是产品经理助手' }),
    });
    const created = await createdRes.json();
    assert.ok(created.ok, '创建应成功');
    assert.ok(created.layer && created.layer.id, '应返回带 id 的 layer');
    const id = created.layer.id;

    // 3. 列表验证
    listRes = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    list = await listRes.json();
    assert.strictEqual(list.layers.length, initialCount + 1, '列表长度应 +1');
    assert.ok(list.layers.some((l) => l.id === id), '新建的 layer 应出现在列表中');

    // 4. 更新
    const updatedRes = await fetch(`${baseUrl}/api/admin/prompt-layers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt_text: '更新后的提示词' }),
    });
    const updated = await updatedRes.json();
    assert.ok(updated.ok, '更新应成功');
    assert.strictEqual(updated.layer.prompt_text, '更新后的提示词');

    // 5. 删除
    const deletedRes = await fetch(`${baseUrl}/api/admin/prompt-layers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const deleted = await deletedRes.json();
    assert.ok(deleted.ok, '删除应成功');

    // 6. 列表再次验证
    listRes = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    list = await listRes.json();
    assert.ok(!list.layers.some((l) => l.id === id), '删除后不应再出现');
  } finally {
    await close();
  }
});

test('K4: 非 admin 访问 prompt-layers 应 403', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'reviewer', '123456');
    const res = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 403, '非 admin 应返回 403');
  } finally {
    await close();
  }
});

test('K4: 新增分层 prompt 缺 level 返回 400', async () => {
  const { baseUrl, close } = await startServer();
  try {
    const token = await loginAs(baseUrl, 'admin', '123456');
    const res = await fetch(`${baseUrl}/api/admin/prompt-layers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ prompt_text: '缺少 level' }),
    });
    assert.strictEqual(res.status, 400, '缺 level 应 400');
  } finally {
    await close();
  }
});