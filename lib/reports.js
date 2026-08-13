/**
 * 定时报告引擎（需求 2）
 *
 * 功能：
 * 1. 阶段报告 - 聊天/任务完成时自动生成
 * 2. 日汇总 - 每天 23:00 生成统计
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');

// 确保报告目录存在
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * 生成单个会话报告
 */
function generateSessionReport(sessionData) {
  const { sessionId, role, startTime, endTime, turnCount, successCount, failCount } = sessionData;

  const duration = Math.round((endTime - startTime) / 1000 / 60); // 分钟
  const successRate = turnCount > 0 ? Math.round((successCount / turnCount) * 100) : 0;

  return {
    sessionId,
    role,
    startTime,
    endTime,
    turnCount,
    successCount,
    failCount,
    duration,
    successRate,
    generatedAt: new Date(),
  };
}

/**
 * 生成日报告
 */
function generateDailyReport(date, sessions, expiringDocs = [], expiredDocs = []) {
  const roleBreakdown = {};
  let totalTurns = 0;
  let totalSuccess = 0;

  for (const session of sessions) {
    // 按角色统计
    roleBreakdown[session.role] = (roleBreakdown[session.role] || 0) + 1;

    // 累计轮数
    totalTurns += session.turnCount || 0;
    totalSuccess += session.successCount || 0;
  }

  const overallSuccessRate = totalTurns > 0 ? Math.round((totalSuccess / totalTurns) * 100) : 0;

  return {
    date,
    sessionCount: sessions.length,
    totalTurns,
    totalSuccess,
    overallSuccessRate,
    roleBreakdown,
    expiringDocs, // 即将到期文档列表（需求 9）
    expiredDocs,  // 已过期文档列表（需求 9）
    generatedAt: new Date(),
  };
}

/**
 * 保存报告到文件
 */
function saveReport(report) {
  const timestamp = Date.now();
  const reportId = report.sessionId || `daily_${report.date}`;
  const filename = `${reportId}_${timestamp}.json`;
  const filepath = path.join(REPORTS_DIR, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));

  return filepath;
}

/**
 * 列出报告
 */
function listReports(options = {}) {
  const { type = 'all', limit = 100 } = options;

  if (!fs.existsSync(REPORTS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => ({
    filename: f,
    filepath: path.join(REPORTS_DIR, f),
  }));
}

/**
 * 获取指定报告
 */
function getReport(sessionId) {
  if (!fs.existsSync(REPORTS_DIR)) {
    return undefined;
  }

  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.startsWith(sessionId));

  if (files.length === 0) {
    return undefined;
  }

  const filepath = path.join(REPORTS_DIR, files[0]);
  const content = fs.readFileSync(filepath, 'utf8');

  return JSON.parse(content);
}

/**
 * 日报告的 Cron 表达式（23:00 触发）
 */
function cronScheduleForDailyReport(timeStr) {
  const [hour, minute] = timeStr.split(':');
  // cron 格式：分 时 日 月 周
  return `${minute} ${hour} * * *`;
}

/**
 * 会话报告的触发方式（同步生成，不需要 cron）
 */
function cronScheduleForSessionReport(sessionData) {
  const report = generateSessionReport(sessionData);
  return saveReport(report);
}

/**
 * 注册定时任务（任务包 C 钩子）
 *
 * 将日报告的 cron 注册逻辑封装成钩子函数，供 server.js 启动时调用。
 * 返回调度信息对象：
 * - cron：日报告 cron 表达式（默认每天 23:00，即 `00 23 * * *`）
 * - enabled：是否启用
 * - name：任务名称
 * - trigger：可供手工调用的日报告生成函数
 *   - 调用方式：trigger(date, sessions) -> 生成并保存一份日报告
 *   - 复用了 generateDailyReport + saveReport，与手动生成路径一致
 */
function registerScheduler() {
  return {
    name: 'daily-report',
    cron: cronScheduleForDailyReport('23:00'),
    enabled: true,
    trigger(date, sessions) {
      const report = generateDailyReport(date, sessions || []);
      return saveReport(report);
    },
  };
}

module.exports = {
  generateSessionReport,
  generateDailyReport,
  saveReport,
  listReports,
  getReport,
  cronScheduleForDailyReport,
  cronScheduleForSessionReport,
  registerScheduler,
};
