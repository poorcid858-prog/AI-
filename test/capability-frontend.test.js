/**
 * 能力中心前端功能测试 - TDD
 *
 * 流程：先写测试，确认失败 → 创建文件 → 运行测试通过
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('ability-center: HTML 文件应该存在', (t) => {
  const htmlPath = path.join(__dirname, '../public/capability.html');
  assert(fs.existsSync(htmlPath), 'public/capability.html 应该存在');
});

test('ability-center: JS 文件应该存在', (t) => {
  const jsPath = path.join(__dirname, '../public/js/capability.js');
  assert(fs.existsSync(jsPath), 'public/js/capability.js 应该存在');
});

test('ability-center: CSS 文件应该存在', (t) => {
  const cssPath = path.join(__dirname, '../public/css/capability.css');
  assert(fs.existsSync(cssPath), 'public/css/capability.css 应该存在');
});

test('ability-center: HTML 应该包含左侧菜单', (t) => {
  const htmlPath = path.join(__dirname, '../public/capability.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  assert(html.includes('<div class="sidebar">'), 'sidebar div 应该存在');
  assert(html.includes('data-type="workflow"'), 'workflow 菜单项应该存在');
  assert(html.includes('data-type="skill"'), 'skill 菜单项应该存在');
  assert(html.includes('data-type="reference"'), 'reference 菜单项应该存在');
  assert(html.includes('data-type="script"'), 'script 菜单项应该存在');
  assert(html.includes('data-type="tool"'), 'tool 菜单项应该存在');
});

test('ability-center: HTML 应该包含列表区域', (t) => {
  const htmlPath = path.join(__dirname, '../public/capability.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  assert(html.includes('<div class="list-area">'), 'list-area div 应该存在');
  assert(html.includes('id="search"'), 'search 输入框应该存在');
  assert(html.includes('id="capability-list"'), '列表表格应该存在');
});

test('ability-center: HTML 应该包含详情区域', (t) => {
  const htmlPath = path.join(__dirname, '../public/capability.html');
  const html = fs.readFileSync(htmlPath, 'utf-8');

  assert(html.includes('<div class="detail-area">'), 'detail-area div 应该存在');
  assert(html.includes('id="detail-content"'), '详情内容区应该存在');
});

test('ability-center: JS 应该定义 loadCapabilities 函数', (t) => {
  const jsPath = path.join(__dirname, '../public/js/capability.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert(js.includes('loadCapabilities'), 'loadCapabilities 函数应该被定义');
  assert(js.includes('async'), '应该使用 async 函数');
});

test('ability-center: JS 应该定义 showDetail 函数', (t) => {
  const jsPath = path.join(__dirname, '../public/js/capability.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert(js.includes('showDetail'), 'showDetail 函数应该被定义');
});

test('ability-center: JS 应该定义 saveCapability 函数', (t) => {
  const jsPath = path.join(__dirname, '../public/js/capability.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert(js.includes('saveCapability'), 'saveCapability 函数应该被定义');
});

test('ability-center: JS 应该定义 deleteCapability 函数', (t) => {
  const jsPath = path.join(__dirname, '../public/js/capability.js');
  const js = fs.readFileSync(jsPath, 'utf-8');

  assert(js.includes('deleteCapability'), 'deleteCapability 函数应该被定义');
});

test('ability-center: CSS 应该定义样式', (t) => {
  const cssPath = path.join(__dirname, '../public/css/capability.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  assert(css.includes('.capability-container'), '.capability-container 样式应该存在');
  assert(css.includes('.sidebar'), '.sidebar 样式应该存在');
  assert(css.includes('.list-area'), '.list-area 样式应该存在');
  assert(css.includes('.detail-area'), '.detail-area 样式应该存在');
});
