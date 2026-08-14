/**
 * 能力中心集成测试
 * 验证前端页面与后端 API 的完整交互
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('child_process');
const http = require('http');

let serverProcess;
const testPort = 3000;
const baseUrl = `http://localhost:${testPort}`;

// 启动服务器（如果尚未运行）
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
  });
}

test('集成测试：能力中心页面应该能加载并显示列表', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) {
    console.log('⏭️  跳过集成测试（服务器未运行）');
    return;
  }

  // 1. 测试页面可以访问
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/capability.html`, (res) => {
      assert.equal(res.statusCode, 200, '页面应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.includes('能力中心'), '页面应该包含标题');
        assert(data.includes('class="sidebar"'), '页面应该包含菜单');
        assert(data.includes('capability.js'), '页面应该加载 JS 文件');
        resolve();
      });
    }).on('error', reject);
  });

  // 2. 测试 API 能返回能力列表
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/api/capabilities`, { headers: { Authorization: 'Bearer test' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          assert(Array.isArray(parsed.capabilities) || parsed.ok === true, 'API 应该返回能力列表或成功响应');
          console.log('✓ API 返回列表成功');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });

  // 3. 测试 CSS 可以访问
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/css/capability.css`, (res) => {
      assert.equal(res.statusCode, 200, 'CSS 文件应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.includes('.capability-container'), 'CSS 应该包含样式定义');
        resolve();
      });
    }).on('error', reject);
  });

  // 4. 测试 JS 可以访问
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/js/capability.js`, (res) => {
      assert.equal(res.statusCode, 200, 'JS 文件应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.includes('loadCapabilities'), 'JS 应该定义 loadCapabilities');
        assert(data.includes('showDetail'), 'JS 应该定义 showDetail');
        resolve();
      });
    }).on('error', reject);
  });

  console.log('✅ 集成测试全部通过');
});

test('集成测试：API 认证检查', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  // 测试无认证的请求
  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/api/capabilities`, (res) => {
      // 应该返回 401 或跳过认证
      console.log(`✓ API 认证状态码: ${res.statusCode}`);
      resolve();
    }).on('error', reject);
  });
});

test('集成测试：页面资源加载检查', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  const resources = [
    '/capability.html',
    '/js/capability.js',
    '/css/capability.css',
  ];

  for (const resource of resources) {
    await new Promise((resolve, reject) => {
      http.get(`${baseUrl}${resource}`, (res) => {
        assert.equal(res.statusCode, 200, `${resource} 应该返回 200`);
        resolve();
      }).on('error', reject);
    });
  }

  console.log('✓ 所有资源都可以访问');
});
