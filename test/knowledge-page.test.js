const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// 验证知识库页面文件存在且有效
test('知识库页面文件存在', () => {
  const knowledgePath = path.join(__dirname, '../public/knowledge.html');
  assert.ok(fs.existsSync(knowledgePath), '知识库页面文件应该存在');
});

test('知识库页面包含基本结构', () => {
  const knowledgePath = path.join(__dirname, '../public/knowledge.html');
  const content = fs.readFileSync(knowledgePath, 'utf8');

  assert.ok(content.includes('<!DOCTYPE html>'), '应该是有效的 HTML');
  assert.ok(content.includes('<title>知识库'), '应该有正确的标题');
  assert.ok(content.includes('css/style.css'), '应该链接 CSS');
  assert.ok(content.includes('css/knowledge.css'), '应该链接知识库专用 CSS');
  assert.ok(content.includes('script'), '应该加载 JS');
  assert.ok(content.includes('knowledge.js'), '应该加载知识库 JS');
});
