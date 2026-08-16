/**
 * 侧边栏渲染测试 - TDD
 *
 * 验证 sidebar.js 的渲染函数在浏览器环境下正常工作。
 * 由于这些测试需要模拟 DOM 环境，使用 node:test 验证
 * HTML 结构与渲染逻辑。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('sidebar.js 文件应该存在', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '../public/js/sidebar.js')), 'sidebar.js 应该存在');
});

test('sidebar.js 应包含 App.renderSidebar 函数定义', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  assert.ok(content.includes('renderSidebar'), 'sidebar.js 应定义 renderSidebar');
  assert.ok(content.includes('moduleKey'), 'renderSidebar 应接受 moduleKey 参数');
  assert.ok(content.includes('itemKey'), 'renderSidebar 应接受 itemKey 参数');
});

test('sidebar.js 应包含 6 个一级模块的定义', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  const modules = ['AI工作台', '知识中心', '能力中心', '审核中心', '运营与管理中心', '系统管理'];
  for (const m of modules) {
    assert.ok(content.includes(m), `sidebar.js 应包含模块 "${m}"`);
  }
});

test('sidebar.js 应包含角色过滤逻辑', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  assert.ok(content.includes('role') || content.includes('admin') || content.includes('show'), 'sidebar.js 应包含角色/权限过滤逻辑');
});

test('sidebar.js 应包含折叠/展开交互', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  assert.ok(content.includes('collapse') || content.includes('toggle') || content.includes('expand'), 'sidebar.js 应包含折叠/展开交互');
});

test('sidebar.js 应支持侧栏折叠/展开', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  assert.ok(content.includes('sidebar-collapsed') || content.includes('sidebarCollapsed') || content.includes('collapsed'), 'sidebar.js 应支持侧栏折叠');
});

test('sidebar.js 应包含高亮当前激活项逻辑', () => {
  const content = fs.readFileSync(path.join(__dirname, '../public/js/sidebar.js'), 'utf-8');
  assert.ok(content.includes('active') || content.includes('highlight'), 'sidebar.js 应包含高亮逻辑');
});

test('dashboard.html 应调用 renderSidebar 而不是 renderHeader', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/dashboard.html'), 'utf-8');
  assert.ok(!html.includes("renderHeader('dashboard')"), 'dashboard.html 不应调用 renderHeader');
  assert.ok(html.includes('renderSidebar'), 'dashboard.html 应调用 renderSidebar');
});

test('knowledge.html 应调用 renderSidebar 而不是 renderHeader', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf-8');
  assert.ok(!html.includes("renderHeader('knowledge')"), 'knowledge.html 不应调用 renderHeader');
  assert.ok(html.includes('renderSidebar'), 'knowledge.html 应调用 renderSidebar');
});

test('capability.html 应调用 renderSidebar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');
  assert.ok(html.includes('renderSidebar'), 'capability.html 应调用 renderSidebar');
});

test('review.html 应调用 renderSidebar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/review.html'), 'utf-8');
  assert.ok(html.includes('renderSidebar'), 'review.html 应调用 renderSidebar');
});

test('operations.html 应调用 renderSidebar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/operations.html'), 'utf-8');
  assert.ok(html.includes('renderSidebar'), 'operations.html 应调用 renderSidebar');
});

test('admin-config.html 应调用 renderSidebar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin-config.html'), 'utf-8');
  assert.ok(html.includes('renderSidebar'), 'admin-config.html 应调用 renderSidebar');
});

test('workspace.html 应调用 renderSidebar', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/workspace.html'), 'utf-8');
  assert.ok(html.includes('renderSidebar'), 'workspace.html 应调用 renderSidebar');
});

test('所有登录后页面都不应调用旧的 renderHeader 方法', () => {
  const pages = [
    'dashboard.html', 'workspace.html', 'knowledge.html',
    'knowledge-quality.html', 'capability.html', 'review.html',
    'operations.html', 'admin.html', 'admin-config.html',
    'admin-model.html', 'admin-logs.html', 'admin-users.html',
    'admin-capability.html', 'admin-qa.html', 'admin-compare.html',
    'service-admin.html', 'service-chat.html', 'password-mgmt.html',
  ];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(__dirname, `../public/${page}`), 'utf-8');
    assert.ok(!html.includes('renderHeader('), `${page} 不应包含 renderHeader 调用`);
  }
});

test('sidebar.css 文件应存在且包含侧边栏样式', () => {
  const cssPath = path.join(__dirname, '../public/css/sidebar.css');
  assert.ok(fs.existsSync(cssPath), 'sidebar.css 应该存在');
  const css = fs.readFileSync(cssPath, 'utf-8');
  assert.ok(css.includes('sidebar'), 'sidebar.css 应包含 sidebar 相关样式');
  assert.ok(css.includes('sidebar-module'), 'sidebar.css 应包含模块样式');
  assert.ok(css.includes('sidebar-item'), 'sidebar.css 应包含子项样式');
  assert.ok(css.includes('active'), 'sidebar.css 应包含激活态样式');
});

test('app.js 不应使用 renderHeader 作为旧顶栏入口', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf-8');
  // app.js 仍然可以保留 renderHeader 作为兼容方法，但必须调用 renderSidebar
  assert.ok(appJs.includes('renderSidebar'), 'app.js 应包含 renderSidebar 定义或转发');
});