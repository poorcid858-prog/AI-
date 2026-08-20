/**
 * K3 任务包测试：BOM 处理、文件上传、admin-config 瘦身
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ============================================================
// 1. store.js BOM 处理
// ============================================================

test('store.js 应包含 BOM 去除逻辑', () => {
  const storePath = path.join(__dirname, '../lib/store.js');
  const content = fs.readFileSync(storePath, 'utf8');
  assert.ok(content.includes('replace(/^'), 'store.js 应包含 BOM 去除逻辑');
  assert.ok(content.includes('JSON.parse'), 'store.js 应有 JSON.parse');
});

// ============================================================
// 2. knowledge.html 文件上传
// ============================================================

test('knowledge.html 应包含文件选择控件', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  assert.ok(html.includes('type="file"'), '应包含文件选择控件');
  assert.ok(html.includes('accept=".md,.txt"'), '应接受 .md/.txt 文件类型');
  assert.ok(html.includes('uploadFile'), '应有 uploadFile 元素 ID');
});

test('knowledge.html 应包含 FileReader 逻辑', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/knowledge.html'), 'utf8');
  assert.ok(html.includes('FileReader'), '应使用 FileReader 读取文件');
  assert.ok(html.includes('readAsText'), '应以文本方式读取文件');
});

// ============================================================
// 3. review.html 发布按钮
// ============================================================

test('review.html 应包含发布按钮和相关逻辑', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/review.html'), 'utf8');
  // M6 更新：review.html 现在使用新的 knowledge API
  assert.ok(html.includes('/api/knowledge/'), 'review.html 应调用 knowledge API');
  assert.ok(html.includes('pending-review'), '应包含 pending-review 端点');
  assert.ok(html.includes('review'), '应包含 review 相关逻辑');
});

// ============================================================
// 4. admin-config.html 瘦身
// ============================================================

test('admin-config.html 应已移除分层提示词 Tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin-config.html'), 'utf8');
  assert.ok(!html.includes('data-tab="prompts"'), '不应包含 prompts Tab');
  assert.ok(!html.includes('data-tab="system"'), '不应包含 system Tab');
  assert.ok(html.includes('data-tab="password"'), '应保留 password Tab');
  assert.ok(html.includes('data-tab="chunking"'), '应保留 chunking Tab');
});

test('admin-config.html 不应包含分层提示词和系统参数的 JS 函数', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/admin-config.html'), 'utf8');
  assert.ok(!html.includes('showAddPromptForm'), '不应包含 showAddPromptForm');
  assert.ok(!html.includes('savePromptLayer'), '不应包含 savePromptLayer');
  assert.ok(!html.includes('loadPromptLayers'), '不应包含 loadPromptLayers');
  assert.ok(!html.includes('showAddSysConfigForm'), '不应包含 showAddSysConfigForm');
  assert.ok(!html.includes('loadSysConfigs'), '不应包含 loadSysConfigs');
});

// ============================================================
// 5. 白屏修复：knowledge.js 无 alert 调用
// ============================================================

test('knowledge.js 不应使用 alert 阻塞型弹窗', () => {
  const js = fs.readFileSync(path.join(__dirname, '../public/js/knowledge.js'), 'utf8');
  assert.ok(js.includes('toast'), '应使用 toast 代替 alert');
  assert.ok(js.includes('error'), 'error 方法应存在');
});