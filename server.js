/**
 * Express 服务入口
 *
 * 职责边界：只做装配 —— 中间件挂载、路由注册、静态资源、启动。
 * 所有业务逻辑在 lib/，所有接口定义在 routes/。
 */

const express = require('express');
const path = require('path');
const config = require('./config');

const app = express();

// ---------- 基础中间件 ----------
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// 请求日志：便于你在终端观察全流程每一步实际打了哪些接口
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`[${stamp}] ${req.method} ${req.path}`);
  }
  next();
});

// ---------- 健康检查 ----------
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    llmMode: config.llm.mode,
    readonlyMode: config.readonlyMode,
    time: new Date().toISOString(),
  });
});

// ---------- 静态资源 ----------
app.use(express.static(config.paths.public));

// ---------- 路由注册 ----------
// 后续步骤逐个接入：auth / documents / workflow / feedback / admin
const routeModules = [
  ['/api/auth', './routes/auth'],
  ['/api/documents', './routes/documents'],
  ['/api/workflow', './routes/workflow'],
  ['/api/feedback', './routes/feedback'],
  ['/api/admin', './routes/admin'],
];

for (const [mountPath, modulePath] of routeModules) {
  try {
    app.use(mountPath, require(modulePath));
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND' && err.message.includes(modulePath.replace('./', ''))) {
      // 该模块尚未实现（按计划分步交付），跳过而不阻断启动
      console.log(`  · ${mountPath} 待实现`);
    } else {
      throw err;
    }
  }
}

// ---------- 404 ----------
app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: `接口不存在: ${req.method} ${req.path}` });
});

// ---------- 统一错误处理 ----------
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ ok: false, error: err.message || '服务器内部错误' });
});

// ---------- 启动 ----------
if (require.main === module) {
  app.listen(config.port, config.host, () => {
    console.log('');
    console.log('  企业 AI 辅助工具已启动');
    console.log(`  访问地址   http://localhost:${config.port}`);
    console.log(`  大模型模式 ${config.llm.mode === 'mock' ? '模拟模式（无需 API Key）' : '真实模式'}`);
    console.log(`  只读模式   ${config.readonlyMode ? '开启（对外演示）' : '关闭（本地开发）'}`);
    console.log('');
  });
}

module.exports = app;
