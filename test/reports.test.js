/**
 * 定时报告功能测试（需求 2）
 *
 * 功能：
 * 1. 阶段报告 - 每个聊天/任务完成时自动生成
 * 2. 日汇总 - 每天 23:00 生成汇总统计
 */

const test = require('node:test');
const assert = require('node:assert');
const reports = require('../lib/reports');

// ============ 报告生成测试 ============

test('R1: generateSessionReport 生成单个会话报告', () => {
  const sessionData = {
    sessionId: 'sess_001',
    role: 'product',
    startTime: new Date('2026-08-12T10:00:00'),
    endTime: new Date('2026-08-12T10:30:00'),
    turnCount: 5,
    successCount: 4,
    failCount: 1,
  };

  const report = reports.generateSessionReport(sessionData);

  assert(report !== undefined, '应返回报告对象');
  assert(report.sessionId === 'sess_001', '报告应包含 sessionId');
  assert(report.duration !== undefined, '报告应计算时长');
  assert(report.successRate !== undefined, '报告应计算成功率');
});

test('R1b: generateSessionReport 计算正确的时长和成功率', () => {
  const sessionData = {
    sessionId: 'sess_001',
    role: 'product',
    startTime: new Date('2026-08-12T10:00:00'),
    endTime: new Date('2026-08-12T10:30:00'),
    turnCount: 5,
    successCount: 4,
    failCount: 1,
  };

  const report = reports.generateSessionReport(sessionData);

  assert.strictEqual(report.duration, 30, '时长应为 30 分钟');
  assert.strictEqual(report.successRate, 80, '成功率应为 80%');
});

// ============ 日报告测试 ============

test('R2: generateDailyReport 聚合多个会话数据', () => {
  const sessions = [
    { sessionId: 'sess_001', turnCount: 5, successCount: 4, role: 'product' },
    { sessionId: 'sess_002', turnCount: 3, successCount: 3, role: 'test' },
    { sessionId: 'sess_003', turnCount: 4, successCount: 2, role: 'frontend' },
  ];

  const dailyReport = reports.generateDailyReport('2026-08-12', sessions);

  assert(dailyReport !== undefined, '应返回日报告');
  assert.strictEqual(dailyReport.date, '2026-08-12', '应包含日期');
  assert.strictEqual(dailyReport.sessionCount, 3, '应统计会话数');
  assert.strictEqual(dailyReport.totalTurns, 12, '应统计总对话轮数');
  assert(dailyReport.roleBreakdown !== undefined, '应包含按角色的统计');
});

test('R2b: generateDailyReport 按角色统计', () => {
  const sessions = [
    { sessionId: 's1', role: 'product', turnCount: 5 },
    { sessionId: 's2', role: 'product', turnCount: 3 },
    { sessionId: 's3', role: 'test', turnCount: 4 },
  ];

  const dailyReport = reports.generateDailyReport('2026-08-12', sessions);

  assert.strictEqual(dailyReport.roleBreakdown.product, 2, 'product 应有 2 个会话');
  assert.strictEqual(dailyReport.roleBreakdown.test, 1, 'test 应有 1 个会话');
});

// ============ 报告存储测试 ============

test('R3: saveReport 存储报告到文件', () => {
  const report = {
    type: 'session',
    sessionId: 'sess_001',
    generatedAt: new Date(),
  };

  const path = reports.saveReport(report);

  assert(path !== undefined, '应返回保存路径');
  assert(typeof path === 'string', '路径应是字符串');
  assert(path.includes('sess_001'), '路径应包含 sessionId');
});

test('R4: listReports 列出报告', () => {
  const reportList = reports.listReports({ type: 'session', limit: 10 });

  assert(Array.isArray(reportList), '应返回数组');
});

test('R5: getReport 获取指定报告', () => {
  const report = reports.getReport('sess_001');

  assert(report === undefined || report !== null, '应返回报告或 undefined');
});

// ============ 定时任务集成 ============

test('R6: cronScheduleForDailyReport 返回有效的 cron 表达式', () => {
  const cronExpr = reports.cronScheduleForDailyReport('23:00');

  assert(typeof cronExpr === 'string', '应返回字符串');
  assert(cronExpr.includes('23'), '应包含 23:00');
});

test('R7: cronScheduleForSessionReport 在会话结束后触发', () => {
  const trigger = reports.cronScheduleForSessionReport;

  assert(typeof trigger === 'function', '应是函数');
});
