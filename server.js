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
    dualPasswordEnabled: Boolean(config.dualPassword && config.dualPassword.enabled),
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
  ['/api/knowledge', './routes/knowledge'],
  ['/api/processing', './routes/processing'], // M4: 异步处理引擎路由
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
  // 启动时数据完整性自检（任务包 M2）：
  //   - 检查 raw_documents.json / std_documents.json 主文件是否为空
  //   - 若为空但存在 .bak 备份，则自动从备份恢复
  //   - 校验 chunks/vectors 存在
  //   - 校验 capabilities.json 可解析且含审核状态
  // 自检失败不阻断启动，仅打印诊断信息。
  (function dataIntegrityCheck() {
    try {
      const fs = require('fs');
      const store = require('./lib/store');
      const dp = config.paths.data;

      const FILES = ['raw_documents', 'std_documents', 'chunks', 'vectors', 'capabilities'];
      FILES.forEach((name) => {
        const fp = path.join(dp, `${name}.json`);
        if (!fs.existsSync(fp)) {
          console.warn(`  · [数据完整性] ${name}.json 不存在，将按默认初始化`);
          store.read(name, []);
        } else {
          const raw = fs.readFileSync(fp, 'utf8');
          let arr = null;
          try { arr = JSON.parse(raw.replace(/^﻿/, '')); } catch (e) { arr = null; }
          const isEmpty = Array.isArray(arr) && arr.length === 0;
          if (isEmpty) {
            const bak = `${fp}.bak`;
            if (fs.existsSync(bak)) {
              try {
                store.read(name, []);
                const bakRaw = fs.readFileSync(bak, 'utf8');
                fs.writeFileSync(fp, bakRaw, 'utf8');
                store.clearCache();
                console.warn(`  · [数据完整性] ${name}.json 为空，已从 ${name}.json.bak 恢复`);
              } catch (eb) {
                console.warn(`  · [数据完整性] ${name}.json.bak 恢复失败: ${eb.message}`);
              }
            } else {
              console.warn(`  · [数据完整性] ${name}.json 为空，且无备份（${name}.json.bak 不存在）`);
            }
          }
        }
      });

      // 校验能力审核种子
      try {
        const cap = require('./lib/capability-engine');
        const pending = cap.getPendingReviewCapabilities();
        if (pending.length > 0) {
          console.log(`  · [数据完整性] 能力审核种子就绪，${pending.length} 项待审核`);
        } else {
          console.warn(`  · [数据完整性] 能力无待审核种子（pending-review 为空）`);
        }
      } catch (_) { /* 能力引擎校验失败不阻断 */ }
    } catch (e) {
      console.warn(`  · [数据完整性] 自检异常（不阻断）: ${e.message}`);
    }
  })();

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
