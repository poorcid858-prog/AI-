/**
 * 定时任务注册测试（任务包 C：CronCreate 定时任务自动触发）
 *
 * 功能：
 * 1. registerScheduler - 把日报告 cron 注册逻辑封装为钩子函数
 */

const test = require('node:test');
const assert = require('node:assert');
const reports = require('../lib/reports');

// ============ registerScheduler 钩子 ============

test('C1: registerScheduler 导出一个函数', () => {
  assert.strictEqual(typeof reports.registerScheduler, 'function', 'registerScheduler 应是函数');
});

test('C2: registerScheduler 返回 cron 表达式（表明注册成功）', () => {
  const result = reports.registerScheduler();
  assert(typeof result, 'registerScheduler 应返回调度信息');
  assert(result !== undefined && result !== null, '应返回非空调度结果');
});

test('C3: registerScheduler 生成的日报告 cron 在每天 23:00 触发', () => {
  const result = reports.registerScheduler();
  // 返回的 cron 应匹配 `00 23 * * *`（分 时 日 月 周 = 每天 23:00）
  assert(result.cron !== undefined, '应包含 cron 字段');
  assert.strictEqual(result.cron, '00 23 * * *', '日报告 cron 应为每天 23:00');
  assert.strictEqual(result.enabled, true, '应标记为启用');
});

test('C4: registerScheduler 的 cron 与 cronScheduleForDailyReport(23:00) 一致', () => {
  const result = reports.registerScheduler();
  const expected = reports.cronScheduleForDailyReport('23:00');
  assert.strictEqual(result.cron, expected, 'registerScheduler 应复用日报告 cron 计划');
});

test('C5: registerScheduler 执行日报告生成逻辑（返回可调用的 action）', () => {
  const result = reports.registerScheduler();
  assert.strictEqual(typeof result.trigger, 'function', '应暴露 trigger 触发函数');
  // 手工触发应能生成并保存一份日报告
  if (typeof result.trigger === 'function') {
    const report = result.trigger('2026-08-13', [
      { sessionId: 's1', role: 'product', turnCount: 5, successCount: 4 },
    ]);
    assert(report !== undefined, 'trigger 应产出报告');
  }
});