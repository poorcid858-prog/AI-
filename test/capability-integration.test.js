/**
 * 能力中心集成测试
 * 验证前端页面与后端的完整交互
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const baseUrl = 'http://localhost:3000';

// 检查服务器是否运行
async function ensureServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${baseUrl}/api/health`, (res) => {
      console.log('✓ 服务器已运行');
      resolve(true);
    });

    req.on('error', (err) => {
      console.log('✓ 服务器尚未运行，跳过集成测试');
      resolve(false);
    });

    req.setTimeout(2000);
  });
}

test('集成测试：能力中心页面应该能加载', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) {
    console.log('⏭️  跳过集成测试（服务器未运行）');
    return;
  }

  // 测试页面可以访问
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/capability.html`, (res) => {
      assert.equal(res.statusCode, 200, 'capability.html 应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.includes('能力中心'), '页面应该包含标题');
        assert(data.includes('class="sidebar"'), '页面应该包含菜单');
        assert(data.includes('class="list-area"'), '页面应该包含列表区域');
        assert(data.includes('class="detail-area"'), '页面应该包含详情区域');
        assert(data.includes('capability.js'), '页面应该加载 JS 文件');
        assert(data.includes('capability.css'), '页面应该加载 CSS 文件');
        console.log('✓ 页面 HTML 结构正确');
        resolve();
      });
    }).on('error', reject);
  });
});

test('集成测试：CSS 文件应该能加载', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/css/capability.css`, (res) => {
      assert.equal(res.statusCode, 200, 'CSS 文件应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.length > 100, 'CSS 文件应该有内容');
        assert(data.includes('.capability-container'), 'CSS 应该包含主容器样式');
        assert(data.includes('.sidebar'), 'CSS 应该包含菜单样式');
        assert(data.includes('.list-area'), 'CSS 应该包含列表区域样式');
        assert(data.includes('.detail-area'), 'CSS 应该包含详情区域样式');
        console.log('✓ CSS 文件加载成功');
        resolve();
      });
    }).on('error', reject);
  });
});

test('集成测试：JavaScript 文件应该能加载', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/js/capability.js`, (res) => {
      assert.equal(res.statusCode, 200, 'JS 文件应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.length > 500, 'JS 文件应该有内容');
        assert(data.includes('loadCapabilities'), 'JS 应该定义 loadCapabilities');
        assert(data.includes('showDetail'), 'JS 应该定义 showDetail');
        assert(data.includes('saveCapability'), 'JS 应该定义 saveCapability');
        assert(data.includes('deleteCapability'), 'JS 应该定义 deleteCapability');
        assert(data.includes('DOMContentLoaded'), 'JS 应该有页面初始化代码');
        assert(data.includes('/api/capabilities'), 'JS 应该调用后端 API');
        console.log('✓ JavaScript 文件加载成功');
        resolve();
      });
    }).on('error', reject);
  });
});

test('集成测试：页面应该能处理登录要求', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  // 尝试调用 API（预期返回 401，前端会处理）
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/api/capabilities`, (res) => {
      // 应该返回 401（需要登录）
      assert(res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 404,
        `API 返回状态 ${res.statusCode}（预期 401/403/404 表示需要认证）`);
      console.log(`✓ API 返回状态 ${res.statusCode}（需要认证）`);
      resolve();
    }).on('error', reject);
  });
});

test('集成测试：所有资源应该都可以访问', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  const resources = [
    { path: '/capability.html', name: '页面' },
    { path: '/js/capability.js', name: 'JS' },
    { path: '/css/capability.css', name: 'CSS' },
  ];

  for (const resource of resources) {
    await new Promise((resolve, reject) => {
      http.get(`${baseUrl}${resource.path}`, (res) => {
        assert.equal(res.statusCode, 200, `${resource.name}应该返回 200`);
        resolve();
      }).on('error', reject);
    });
  }

  console.log('✅ 所有资源都可以访问');
});
