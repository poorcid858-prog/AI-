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
// 后续步骤逐个接入：auth / documents / workflow / feedback / admin / chat / service / reports / password-mgmt
const routeModules = [
  ['/api/auth', './routes/auth'],
  ['/api/documents', './routes/documents'],
  ['/api/workflow', './routes/workflow'],
  ['/api/feedback', './routes/feedback'],
  ['/api/admin', './routes/admin'],
  ['/api/chat', './routes/chat'],
  ['/api/service-chat', './routes/service-chat'],
  ['/api/service-admin', './routes/service-admin'],
  ['/api/reports', './routes/reports'],
  ['/api/password-mgmt', './routes/password-mgmt'],
  ['/api/retrieval', './routes/retrieval'],
  ['/api/expiry', './routes/expiry'],
  ['/api/compare', './routes/compare'],
  ['/api/capabilities', './routes/capability'],
  ['/api/operations', './routes/operations'],
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
  // 启动时预置常用问题种子（30 条，4 角色），已有数据时不写入
  // 兜底 try/catch：即使 seedIfEmpty 内部 writeFrequency 抛错，也不阻断服务启动
  try { require('./lib/qa-store').seedIfEmpty(); } catch (_) { /* 种子失败不阻断 */ }

  // 持久化定时任务：每天 23:00 自动生成日报告（替代 CronCreate，7 天不过期）
  try {
    const reportsLib = require('./lib/reports');
    const persistentScheduler = require('./lib/persistent-scheduler');
    const qa = require('./lib/qa-store');
    const expiry = require('./lib/expiry');

    const dailyScheduler = persistentScheduler.createScheduler({
      triggerTime: '23:00',
      job(date) {
        // 汇总当天全部会话，生成日报告并保存
        const sessions = qa.listSessions(100).map(s => ({
          sessionId: s.sessionId,
          role: s.firstUserRole || 'guest',
          turnCount: s.recordCount || 0,
          successCount: s.recordCount || 0,
          failCount: 0,
        }));
        // 需求 9：日报告包含到期文档列表
        const expiringDocs = expiry.getExpiringDocs(7);
        const expiredDocs = expiry.getExpiredDocs();
        // 需求 9：自动处理过期文档
        const processed = expiry.processExpired();
        const daily = reportsLib.generateDailyReport(date, sessions, expiringDocs, expiredDocs);
        const file = reportsLib.saveReport(daily);
        console.log(`  · [日报告] ${date} 已生成: ${file}`);
        if (expiringDocs.length > 0) {
          console.log(`  · [到期提醒] ${expiringDocs.length} 个文档即将到期`);
        }
        if (expiredDocs.length > 0) {
          console.log(`  · [过期文档] ${expiredDocs.length} 个文档已过期`);
        }
        if (processed > 0) {
          console.log(`  · [自动处理] ${processed} 个过期文档已转为待复审`);
        }
      },
    });
    dailyScheduler.start();
    console.log(`  · 定时任务: 每日 23:00 生成日报告（持久模式，跨重启存活）`);
    console.log(`  · 文档过期检查: 每日 23:00 自动处理过期文档`);
  } catch (_) { /* 定时任务注册失败不阻断启动 */ }

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
