/**
 * 能力中心集成测试
 * 验证前端页面与后端的完整交互
 * 注意：此测试需要服务器运行，否则跳过
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const baseUrl = 'http://localhost:3000';

// 检查服务器是否运行
async function ensureServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${baseUrl}/api/health`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000);
  });
}

test('集成测试：能力中心页面应该能加载', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) {
    console.log('⏭️  跳过集成测试（服务器未运行）');
    return;
  }

  await new Promise((resolve, reject) => {
    http.get(`${baseUrl}/capability.html`, (res) => {
      assert.equal(res.statusCode, 200, 'capability.html 应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.includes('能力中心'), '页面应该包含标题');
        assert(data.includes('capabilityListArea'), '页面应该包含列表区域');
        assert(data.includes('detailPanel'), '页面应该包含详情面板');
        assert(data.includes('newCapModal'), '页面应该包含新建能力模态框');
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
    http.get(`${baseUrl}/css/style.css`, (res) => {
      assert.equal(res.statusCode, 200, 'CSS 文件应该返回 200');
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        assert(data.length > 100, 'CSS 文件应该有内容');
        assert(data.includes(':root'), 'CSS 应该包含根变量');
        console.log('✓ CSS 文件加载成功');
        resolve();
      });
    }).on('error', reject);
  });
});

test('集成测试：所有资源应该都可以访问', async (t) => {
  const serverRunning = await ensureServerRunning();
  if (!serverRunning) return;

  const resources = [
    { path: '/capability.html', name: '页面' },
    { path: '/css/style.css', name: 'CSS' },
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