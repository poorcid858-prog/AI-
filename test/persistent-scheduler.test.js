/**
 * 持久化定时任务测试（把 23:00 日报告从 Claude CronCreate 移到应用自带调度器）
 *
 * 背景：之前用的是 Claude 的 CronCreate recurring 任务，7 天自动过期且依赖 Claude 会话在线。
 * 现在改成应用内置的持久调度器 —— 用 setInterval 每小扫一次，到点就生成日报告，
 * 生成状态记录在 data/reports/<date> 文件里，重启用也不会重复生成。
 *
 * TDD：先写失败测试 → 再实现。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const persistentScheduler = require('../lib/persistent-scheduler');

// 用临时目录隔离测试，不碰真实 data/
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
const statePath = path.join(tempDir, 'scheduler-state.json');

// ============ D1: 持久化状态标记 ============

test('D1: 记录 date 已生成后，同一 date 判定为已生成（幂等）', () => {
  persistentScheduler.markGenerated(statePath, '2026-08-13');
  const generated = persistentScheduler.isGenerated(statePath, '2026-08-13');
  assert.strictEqual(generated, true, '已标记的 date 应判定为已生成');
  const notGenerated = persistentScheduler.isGenerated(statePath, '2026-08-14');
  assert.strictEqual(notGenerated, false, '未标记的 date 应判定为未生成');
});

test('D1b: 状态文件不存在时返回未生成（不报错）', () => {
  const missingFile = path.join(tempDir, 'nonexistent.json');
  const generated = persistentScheduler.isGenerated(missingFile, '2026-08-13');
  assert.strictEqual(generated, false, '文件不存在时任何 date 都是未生成');
});

// ============ D2: 是否到点 ============

test('D2: 未生成的今天日期，若当前时间 >= 触发点则 shouldRun 为 true', () => {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  // 清掉今天的标记
  persistentScheduler.clear(statePath, todayStr);

  // 触发点设在 00:00（凌晨已过，任何时刻都到点）
  const shouldRun = persistentScheduler.shouldRun({
    statePath,
    triggerTime: '00:00',
    date: todayStr,
  });
  assert.strictEqual(shouldRun, true, '过了触发点且今天没生成过，应该运行');
});

test('D2b: 已生成的今天日期 shouldRun 为 false（不重复）', () => {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  persistentScheduler.markGenerated(statePath, todayStr);
  const shouldRun = persistentScheduler.shouldRun({
    statePath,
    triggerTime: '00:00',
    date: todayStr,
  });
  assert.strictEqual(shouldRun, false, '今天已生成过就不该再运行');
});

test('D2c: 触发点尚未到（触发点设为未来时间）shouldRun 为 false', () => {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  persistentScheduler.clear(statePath, todayStr);
  // 触发点设为 23:59（绝大多数时刻还没到）
  const shouldRun = persistentScheduler.shouldRun({
    statePath,
    triggerTime: '23:59',
    date: todayStr,
  });
  assert.strictEqual(shouldRun, false, '还没到触发点，不该运行');
});

// ============ D3: 调度器启动 ============

test('D3: createScheduler 返回可启停的调度器且持有日期状态函数', () => {
  const scheduler = persistentScheduler.createScheduler({
    statePath,
    triggerTime: '23:00',
    job: (date) => ({ ok: true, date }),
  });
  assert(scheduler && typeof scheduler.start === 'function', '应返回带 start 的调度器');
  assert(scheduler && typeof scheduler.stop === 'function', '应返回带 stop 的调度器');
  assert(scheduler && typeof scheduler.checkNow === 'function', '应暴露 checkNow 供测试手动触发');
  assert(scheduler && typeof scheduler.isGenerated === 'function', '应暴露 isGenerated');
  scheduler.stop();
});

test('D3b: checkNow 未生成且有会话数据时执行 job 并标记', () => {
  const todayStr = '2026-08-13';
  persistentScheduler.clear(statePath, todayStr);
  let jobRan = false;
  const scheduler = persistentScheduler.createScheduler({
    statePath,
    triggerTime: '00:00', // 触发点已过
    date: todayStr,
    job: () => { jobRan = true; return { ok: true }; },
  });
  scheduler.checkNow();
  assert.strictEqual(jobRan, true, '到点且未生成应执行 job');
  assert.strictEqual(scheduler.isGenerated(todayStr), true, '执行后应标记为已生成');
  scheduler.stop();
});

test('D3c: checkNow 已生成则跳过 job（不重复生成）', () => {
  const todayStr = '2026-08-13';
  persistentScheduler.markGenerated(statePath, todayStr);
  let jobRan = false;
  const scheduler = persistentScheduler.createScheduler({
    statePath,
    triggerTime: '00:00',
    date: todayStr,
    job: () => { jobRan = true; return { ok: true }; },
  });
  scheduler.checkNow();
  assert.strictEqual(jobRan, false, '已生成过就不该再执行 job');
  scheduler.stop();
});

// 清理
test('after: 清理临时目录', () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});