/**
 * 能力中心前端功能测试 - 更新为聚合视图+创建向导
 *
 * 验证新 capability.html 的结构和功能
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('ability-center: HTML 文件应该存在', (t) => {
  const htmlPath = path.join(__dirname, '../public/capability.html');
  assert(fs.existsSync(htmlPath), 'public/capability.html 应该存在');
});

test('ability-center: HTML 应该包含聚合视图结构', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');

  assert(html.includes('能力中心'), '页面标题应含能力中心');
  assert(html.includes('新建能力'), '应有新建能力按钮');
  assert(html.includes('newCapBtn'), '应有新建按钮 ID');
  assert(html.includes('capabilityListArea'), '应有能力列表区域');
  assert(html.includes('detailPanel'), '应有详情面板');
  assert(html.includes('newCapModal'), '应有新建能力模态框');
  assert(html.includes('loadCapabilities'), '应有 loadCapabilities 函数');
  assert(html.includes('showCapabilityDetail'), '应有 showCapabilityDetail 函数');
  assert(html.includes('/api/capabilities'), '应调用后端 API');
  assert(html.includes('App.guard'), '应有登录守卫');
  assert(html.includes('App.renderHeader'), '应渲染导航栏');
});

test('ability-center: 新建能力向导三步结构', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');

  assert(html.includes('step1'), '应有步骤1区域');
  assert(html.includes('step2'), '应有步骤2区域');
  assert(html.includes('step3'), '应有步骤3区域');
  assert(html.includes('nextStepBtn'), '应有下一步按钮');
  assert(html.includes('prevStepBtn'), '应有上一步按钮');
  assert(html.includes('createBtn'), '应有创建按钮');
  assert(html.includes('newCapType'), '应有类型选择');
  assert(html.includes('newCapName'), '应有名称输入');
  assert(html.includes('newCapContent'), '应有内容输入');
});

test('ability-center: 能力聚合视图按类型分组', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');

  assert(html.includes('workflow'), 'workflow 类型应存在');
  assert(html.includes('skill'), 'skill 类型应存在');
  assert(html.includes('reference'), 'reference 类型应存在');
  assert(html.includes('script'), 'script 类型应存在');
  assert(html.includes('tool'), 'tool 类型应存在');
  assert(html.includes('renderCapabilityList'), '应有列表渲染函数');
  assert(html.includes('typeOrder'), '应有类型排序逻辑');
});

test('ability-center: 能力详情面板含审核操作', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');

  assert(html.includes('submitReviewBtn'), '应有提交审核按钮');
  assert(html.includes('publishCapBtn'), '应有发布按钮');
  assert(html.includes('review'), '应有审核相关逻辑');
  assert(html.includes('pending_review'), '应有待审核状态');
  assert(html.includes('approved'), '应有审核通过状态');
  assert(html.includes('rejected'), '应有审核驳回状态');
});

test('ability-center: 使用 Bootstrap 深色主题', (t) => {
  const html = fs.readFileSync(path.join(__dirname, '../public/capability.html'), 'utf-8');

  assert(html.includes('bootstrap.min.css'), '应引用 Bootstrap CSS');
  assert(html.includes('custom-theme.css'), '应引用深色主题');
  assert(html.includes('bootstrap.bundle.min.js'), '应引用 Bootstrap JS');
  assert(html.includes('data-bs-theme="dark"'), '应为深色主题');
});