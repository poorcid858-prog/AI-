/**
 * 知识中心前端四层列表测试
 *
 * 测试知识中心前端页面的四层列表功能：
 * - 原始文档列表
 * - 标准化文档列表
 * - Chunk 列表
 * - 向量化数据列表
 * - 操作按钮状态
 * - 批量操作
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('知识中心前端测试 - knowledge.html 页面结构', function () {
  const knowledgeHtmlPath = path.join(__dirname, '..', 'public', 'knowledge.html');
  const htmlContent = fs.readFileSync(knowledgeHtmlPath, 'utf-8');

  // 应该包含四个标签页按钮
  assert.ok(htmlContent.includes('data-layer="documents"'), '应该包含原始文档标签页');
  assert.ok(htmlContent.includes('data-layer="standardized"'), '应该包含标准化文档标签页');
  assert.ok(htmlContent.includes('data-layer="chunks"'), '应该包含 Chunk 标签页');
  assert.ok(htmlContent.includes('data-layer="vectors"'), '应该包含向量化数据标签页');

  // 应该包含批量操作栏
  assert.ok(htmlContent.includes('id="batchActions"'), '应该包含批量操作栏');
  assert.ok(htmlContent.includes('id="batchGenerate"'), '应该包含批量生成按钮');
  assert.ok(htmlContent.includes('id="batchOnline"'), '应该包含批量上线按钮');
  assert.ok(htmlContent.includes('id="batchOffline"'), '应该包含批量下线按钮');

  // 应该包含进度弹窗
  assert.ok(htmlContent.includes('id="progress-modal"'), '应该包含进度弹窗');
  assert.ok(htmlContent.includes('id="progressBar"'), '应该包含进度条');
  assert.ok(htmlContent.includes('id="phaseList"'), '应该包含阶段列表');

  // 应该包含上传区域
  assert.ok(htmlContent.includes('id="uploadArea"'), '应该包含上传区域');
  assert.ok(htmlContent.includes('id="uploadForm"'), '应该包含上传表单');

  // 应该包含搜索功能
  assert.ok(htmlContent.includes('id="search"'), '应该包含搜索框');
  assert.ok(htmlContent.includes('id="btn-search"'), '应该包含搜索按钮');
  assert.ok(htmlContent.includes('id="btn-clear"'), '应该包含清空按钮');
});

test('知识中心前端测试 - knowledge.js 前端逻辑', function () {
  const knowledgeJsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(knowledgeJsPath, 'utf-8');

  // 应该包含页面状态管理
  assert.ok(jsContent.includes('pageState'), '应该包含页面状态管理');
  assert.ok(jsContent.includes('currentLayer'), '应该包含当前层状态');
  assert.ok(jsContent.includes('selectedItems'), '应该包含选中项状态');

  // 应该包含 TabManager 类
  assert.ok(jsContent.includes('class TabManager'), '应该包含 TabManager 类');
  assert.ok(jsContent.includes('switchLayer'), '应该包含层切换方法');

  // 应该包含 DataLoader 类
  assert.ok(jsContent.includes('class DataLoader'), '应该包含 DataLoader 类');
  assert.ok(jsContent.includes('async load'), '应该包含异步加载方法');

  // 应该包含 RenderEngine 类
  assert.ok(jsContent.includes('class RenderEngine'), '应该包含 RenderEngine 类');
  assert.ok(jsContent.includes('renderDocuments'), '应该包含渲染原始文档方法');
  assert.ok(jsContent.includes('renderStandardizedDocs'), '应该包含渲染标准化文档方法');
  assert.ok(jsContent.includes('renderChunks'), '应该包含渲染 Chunk 方法');
  assert.ok(jsContent.includes('renderVectors'), '应该包含渲染向量化数据方法');

  // 应该包含操作函数
  assert.ok(jsContent.includes('async function generateVectors'), '应该包含生成向量函数');
  assert.ok(jsContent.includes('async function reReview'), '应该包含重新审核函数');
  assert.ok(jsContent.includes('async function publishNewVersion'), '应该包含发布新版本函数');
  assert.ok(jsContent.includes('async function onlineDocument'), '应该包含上线函数');
  assert.ok(jsContent.includes('async function offlineDocument'), '应该包含下线函数');
  assert.ok(jsContent.includes('async function deleteDocument'), '应该包含删除函数');

  // 应该包含批量操作函数
  assert.ok(jsContent.includes('async function batchGenerateVectors'), '应该包含批量生成函数');
  assert.ok(jsContent.includes('async function batchOnline'), '应该包含批量上线函数');
  assert.ok(jsContent.includes('async function batchOffline'), '应该包含批量下线函数');
  assert.ok(jsContent.includes('function clearSelection'), '应该包含清除选择函数');

  // 应该包含进度轮询功能
  assert.ok(jsContent.includes('async function pollTaskProgress'), '应该包含进度轮询函数');
  assert.ok(jsContent.includes('function updateProgressUI'), '应该包含更新进度 UI 函数');

  // 应该包含状态文本映射
  assert.ok(jsContent.includes('getReviewStatusText'), '应该包含审核状态文本映射');
  assert.ok(jsContent.includes('getProcessingStatusText'), '应该包含处理状态文本映射');
  assert.ok(jsContent.includes('getOnlineStatusText'), '应该包含生效状态文本映射');

  // 应该包含操作按钮逻辑
  assert.ok(jsContent.includes('getOperationButtons'), '应该包含操作按钮逻辑');
  assert.ok(jsContent.includes('review_status'), '应该包含审核状态判断');
  assert.ok(jsContent.includes('processing_status'), '应该包含处理状态判断');
  assert.ok(jsContent.includes('online_status'), '应该包含生效状态判断');
});

test('知识中心前端测试 - knowledge.css 样式', function () {
  const knowledgeCssPath = path.join(__dirname, '..', 'public', 'css', 'knowledge.css');
  const cssContent = fs.readFileSync(knowledgeCssPath, 'utf-8');

  // 应该包含标签页样式
  assert.ok(cssContent.includes('.tabs'), '应该包含标签页样式');
  assert.ok(cssContent.includes('.tab-btn'), '应该包含标签页按钮样式');

  // 应该包含批量操作栏样式
  assert.ok(cssContent.includes('.batch-actions'), '应该包含批量操作栏样式');
  assert.ok(cssContent.includes('.batch-count'), '应该包含批量计数样式');

  // 应该包含状态标签样式
  assert.ok(cssContent.includes('.badge'), '应该包含状态标签样式');
  assert.ok(cssContent.includes('.bg-warning'), '应该包含警告状态样式');
  assert.ok(cssContent.includes('.bg-success'), '应该包含成功状态样式');
  assert.ok(cssContent.includes('.bg-danger'), '应该包含失败状态样式');

  // 应该包含操作按钮样式
  assert.ok(cssContent.includes('.action-buttons'), '应该包含操作按钮容器样式');
  assert.ok(cssContent.includes('.btn-sm'), '应该包含小按钮样式');

  // 应该包含进度条样式
  assert.ok(cssContent.includes('.progress-bar'), '应该包含进度条样式');
  assert.ok(cssContent.includes('.phase-item'), '应该包含阶段项样式');

  // 应该包含响应式设计
  assert.ok(cssContent.includes('@media (max-width: 768px)'), '应该包含平板设备响应式');
  assert.ok(cssContent.includes('@media (max-width: 480px)'), '应该包含手机设备响应式');
});

test('知识中心前端测试 - API 端点覆盖', function () {
  const routesPath = path.join(__dirname, '..', 'routes', 'knowledge.js');
  const routesContent = fs.readFileSync(routesPath, 'utf-8');

  // 应该支持原始文档列表 API
  assert.ok(routesContent.includes("case 'documents':"), '应该支持原始文档列表');

  // 应该支持标准化文档列表 API
  assert.ok(routesContent.includes("case 'standardized':"), '应该支持标准化文档列表');

  // 应该支持 Chunk 列表 API
  assert.ok(routesContent.includes("case 'chunks':"), '应该支持 Chunk 列表');

  // 应该支持向量化数据列表 API
  assert.ok(routesContent.includes("case 'embeddings':"), '应该支持向量化数据列表');

  // 应该支持版本详情 API
  assert.ok(routesContent.includes('router.get'), '应该支持 GET 请求');
  assert.ok(routesContent.includes('/:versionId'), '应该支持版本详情路由');

  // 应该支持重新发起审核 API
  assert.ok(routesContent.includes('/:versionId/re-review'), '应该支持重新发起审核');

  // 应该支持上线/下线 API
  assert.ok(routesContent.includes('/:versionId/online'), '应该支持上线 API');
  assert.ok(routesContent.includes('/:versionId/offline'), '应该支持下线 API');

  // 应该支持发布新版本 API
  assert.ok(routesContent.includes('/:documentId/new-version'), '应该支持发布新版本');

  // 应该支持删除 API
  assert.ok(routesContent.includes('router.delete'), '应该支持删除操作');

  // 应该支持批量操作 API
  assert.ok(routesContent.includes('/batch-online'), '应该支持批量上线');
  assert.ok(routesContent.includes('/batch-offline'), '应该支持批量下线');
});

test('知识中心前端测试 - 操作按钮状态逻辑', function () {
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(jsPath, 'utf-8');

  // 审核通过且未处理时显示"生成向量数据"
  assert.ok(jsContent.includes("review_status === 'approved'"), '应该判断审核通过状态');
  assert.ok(jsContent.includes('生成向量数据'), '应该显示生成向量数据按钮');

  // 审核失败后显示"重新发起审核"
  assert.ok(jsContent.includes("review_status === 'rejected'"), '应该判断审核失败状态');
  assert.ok(jsContent.includes('重新发起审核'), '应该显示重新发起审核按钮');

  // 向量化前允许删除
  assert.ok(jsContent.includes("'not_processed'"), '应该判断未处理状态');
  assert.ok(jsContent.includes("'failed'"), '应该判断处理失败状态');
  assert.ok(jsContent.includes('删除'), '应该显示删除按钮');

  // 未上线或已下线时显示"上线"
  assert.ok(jsContent.includes("'not_online'"), '应该判断未上线状态');
  assert.ok(jsContent.includes("'offline'"), '应该判断已下线状态');
  assert.ok(jsContent.includes('上线'), '应该显示上线按钮');

  // 已上线时显示"下线"
  assert.ok(jsContent.includes("'online'"), '应该判断已上线状态');
  assert.ok(jsContent.includes('下线'), '应该显示下线按钮');

  // 应该根据版本号显示发布新版本按钮
  assert.ok(jsContent.includes("doc.version && doc.version > 0"), '应该判断版本号');
  assert.ok(jsContent.includes('发布新版本'), '应该显示发布新版本按钮');
});

test('知识中心前端测试 - 批量操作功能', function () {
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(jsPath, 'utf-8');

  // 应该支持批量选择
  assert.ok(jsContent.includes('pageState.selectedItems'), '应该包含选中项状态');
  assert.ok(jsContent.includes('selectAll'), '应该包含全选功能');
  assert.ok(jsContent.includes('row-select'), '应该包含行选择功能');

  // 应该支持批量生成向量数据
  assert.ok(jsContent.includes('/api/processing/knowledge/batch-generate'), '应该调用批量生成 API');
  assert.ok(jsContent.includes('versionIds'), '应该包含版本 ID 数组');

  // 应该支持批量上线/下线
  assert.ok(jsContent.includes('/api/knowledge/batch-online'), '应该调用批量上线 API');
  assert.ok(jsContent.includes('/api/knowledge/batch-offline'), '应该调用批量下线 API');

  // 应该显示已选择数量
  const htmlPath = path.join(__dirname, '..', 'public', 'knowledge.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  assert.ok(htmlContent.includes('已选择'), '应该显示已选择文本');
  assert.ok(htmlContent.includes('id="selectedCount"'), '应该包含已选择计数元素');
});

test('知识中心前端测试 - 进度展示功能', function () {
  const htmlPath = path.join(__dirname, '..', 'public', 'knowledge.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // 应该包含进度条
  assert.ok(htmlContent.includes('id="progressBar"'), '应该包含进度条');
  assert.ok(htmlContent.includes('id="progressText"'), '应该包含进度文本');

  // 应该包含阶段列表
  assert.ok(htmlContent.includes('id="phaseList"'), '应该包含阶段列表');

  // 应该包含错误信息展示
  assert.ok(htmlContent.includes('id="progressError"'), '应该包含错误信息展示');

  // 应该包含重试按钮
  assert.ok(htmlContent.includes('id="retryBtn"'), '应该包含重试按钮');

  // 应该包含轮询逻辑
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(jsPath, 'utf-8');
  assert.ok(jsContent.includes('pollTaskProgress'), '应该包含进度轮询函数');
  assert.ok(jsContent.includes('setTimeout'), '应该包含定时器');
});

test('知识中心前端测试 - 血缘跳转功能', function () {
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(jsPath, 'utf-8');

  // 应该支持点击父级 ID 跳转
  assert.ok(jsContent.includes('link-source'), '应该包含来源链接');
  assert.ok(jsContent.includes('data-layer'), '应该包含层数据属性');
  assert.ok(jsContent.includes('data-id'), '应该包含 ID 数据属性');

  // 应该包含追踪功能
  assert.ok(jsContent.includes('class TraceEngine'), '应该包含追踪引擎类');
  assert.ok(jsContent.includes('async trace'), '应该包含异步追踪方法');
  assert.ok(jsContent.includes('/api/knowledge/trace/'), '应该调用追踪 API');
});

test('知识中心前端测试 - 页面初始化', function () {
  const jsPath = path.join(__dirname, '..', 'public', 'js', 'knowledge.js');
  const jsContent = fs.readFileSync(jsPath, 'utf-8');

  // 应该在 DOM 加载完成后初始化
  assert.ok(jsContent.includes("document.addEventListener('DOMContentLoaded'"), '应该监听 DOM 加载事件');
  assert.ok(jsContent.includes("dataLoader.load('documents')"), '应该加载初始数据');

  // 应该初始化所有管理器
  assert.ok(jsContent.includes('const tabManager = new TabManager()'), '应该初始化 TabManager');
  assert.ok(jsContent.includes('const dataLoader = new DataLoader()'), '应该初始化 DataLoader');
  assert.ok(jsContent.includes('const renderEngine = new RenderEngine()'), '应该初始化 RenderEngine');
  assert.ok(jsContent.includes('const traceEngine = new TraceEngine()'), '应该初始化 TraceEngine');
  assert.ok(jsContent.includes('const searchFilter = new SearchFilter()'), '应该初始化 SearchFilter');
});
