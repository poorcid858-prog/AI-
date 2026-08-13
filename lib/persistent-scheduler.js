/**
 * 持久化定时任务调度器（替代 Claude CronCreate 的 7 天过期问题）
 *
 * 为什么自建：
 * - Claude 的 CronCreate recurring 任务 7 天自动过期，且依赖 Claude 会话在线
 * - 本项目要稳定每天 23:00 生成日报告，就必须用应用内置的持久调度
 *
 * 原理：
 * - 用 setInterval 每 60 秒扫一次
 * - 每次扫：如果当前时刻 >= triggerTime 且 今天还没生成过 → 执行 job 并记状态
 * - 状态记录在 data（JSON 文件），重启后读取，避免同一天重复生成
 * - job 是幂等的：同一天只生成一次
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STATE_PATH = path.join(__dirname, '..', 'data', 'scheduler-state.json');
const DEFAULT_TRIGGER_TIME = '23:00';
const CHECK_INTERVAL_MS = 60 * 1000; // 每 60 秒扫一次

/**
 * 判断当前时刻是否已过触发点
 */
function passedTrigger(triggerTime, now = new Date()) {
  const [h, m] = String(triggerTime).split(':').map(Number);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const triggerMinutes = (h || 0) * 60 + (m || 0);
  return nowMinutes >= triggerMinutes;
}

/**
 * 读取已生成日期的状态
 */
function readState(statePath) {
  const file = statePath || DEFAULT_STATE_PATH;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data.generatedDates) ? data.generatedDates : [];
  } catch {
    return [];
  }
}

/**
 * 判断某 date 是否已生成（文件不存在返回 false，不报错）
 */
function isGenerated(statePath, date) {
  return readState(statePath).includes(date);
}

/**
 * 记录某 date 已生成（幂等：重复调用无害）
 */
function markGenerated(statePath, date) {
  const file = statePath || DEFAULT_STATE_PATH;
  const dates = new Set(readState(file));
  dates.add(date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generatedDates: [...dates] }, null, 2));
}

/**
 * 清除某 date 的生成标记（测试/重跑用）
 */
function clear(statePath, date) {
  const file = statePath || DEFAULT_STATE_PATH;
  const dates = new Set(readState(file));
  dates.delete(date);
  if (dates.size === 0) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } else {
    fs.writeFileSync(file, JSON.stringify({ generatedDates: [...dates] }, null, 2));
  }
}

/**
 * 判定是否应该运行（触发点已到 && 今天还没生成过）
 */
function shouldRun({ statePath, triggerTime = DEFAULT_TRIGGER_TIME, date, now }) {
  if (!passedTrigger(triggerTime, now)) {
    return false;
  }
  if (isGenerated(statePath, date)) {
    return false;
  }
  return true;
}

/**
 * 创建持久调度器
 *
 * @param {object} opts
 * @param {string} [opts.statePath] 状态文件路径（默认 data/scheduler-state.json）
 * @param {string} [opts.triggerTime] 每天触发时刻 "HH:MM"（默认 23:00）
 * @param {string} [opts.date] 固定要生成的日期（测试用；生产留空则用当天）
 * @param {Function} opts.job 到点执行的任务，入参 date，返回报告
 * @returns {object} { start, stop, checkNow, isGenerated }
 */
function createScheduler(opts) {
  const statePath = opts.statePath;
  const triggerTime = opts.triggerTime || DEFAULT_TRIGGER_TIME;
  const fixedDate = opts.date || null;
  const job = opts.job || (() => {});

  let timer = null;
  let running = false;

  function todayStr() {
    return fixedDate || new Date().toISOString().slice(0, 10);
  }

  /**
   * 检查本次是否该生成；该生成则执行 job 并标记。
   * 供 setInterval 和测试的 checkNow 调用。
   */
  function checkNow(now) {
    const date = todayStr();
    if (shouldRun({ statePath, triggerTime, date, now })) {
      job(date);
      markGenerated(statePath, date);
    }
  }

  function start() {
    if (running) return;
    running = true;
    // 启动时立刻检查一次（如果已经到点且今天没生成，立即补生成）
    checkNow(new Date());
    timer = setInterval(() => {
      checkNow(new Date());
    }, CHECK_INTERVAL_MS);
    // 让进程能正常退出
    if (timer.unref) timer.unref();
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    start,
    stop,
    checkNow,
    isGenerated: (d) => isGenerated(statePath, d),
    getTriggerTime: () => triggerTime,
    getCheckIntervalMs: () => CHECK_INTERVAL_MS,
  };
}

module.exports = {
  markGenerated,
  isGenerated,
  clear,
  shouldRun,
  passedTrigger,
  createScheduler,
};