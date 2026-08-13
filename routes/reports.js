/**
 * 定时报告 API 路由（需求 2）
 *
 * 职责：
 * - 获取报告列表和详情
 * - 触发手动生成报告
 * - 管理定时任务
 */

const express = require('express');
const reports = require('../lib/reports');

const router = express.Router();

/**
 * GET /api/reports
 * 获取报告列表
 */
router.get('/', (req, res) => {
  const { type = 'all', limit = 50 } = req.query;

  try {
    const reportList = reports.listReports({ type, limit: parseInt(limit) });

    res.json({
      ok: true,
      data: reportList,
      count: reportList.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/reports/:sessionId
 * 获取指定会话的报告
 */
router.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  try {
    const report = reports.getReport(sessionId);

    if (!report) {
      return res.status(404).json({ ok: false, error: '报告不存在' });
    }

    res.json({
      ok: true,
      data: report,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/reports/generate/session
 * 手动生成会话报告
 */
router.post('/generate/session', (req, res) => {
  const { sessionId, role, startTime, endTime, turnCount, successCount, failCount } = req.body;

  if (!sessionId) {
    return res.status(400).json({ ok: false, error: 'sessionId 必填' });
  }

  try {
    const sessionData = {
      sessionId,
      role: role || 'guest',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      turnCount: turnCount || 0,
      successCount: successCount || 0,
      failCount: failCount || 0,
    };

    const report = reports.generateSessionReport(sessionData);
    const filepath = reports.saveReport(report);

    res.status(201).json({
      ok: true,
      data: report,
      filepath,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/reports/generate/daily
 * 手动生成日报告
 */
router.post('/generate/daily', (req, res) => {
  const { date, sessions } = req.body;

  if (!date || !Array.isArray(sessions)) {
    return res.status(400).json({ ok: false, error: 'date 和 sessions 必填' });
  }

  try {
    const dailyReport = reports.generateDailyReport(date, sessions);
    const filepath = reports.saveReport(dailyReport);

    res.status(201).json({
      ok: true,
      data: dailyReport,
      filepath,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/reports/cron/schedule
 * 获取定时任务计划
 */
router.get('/cron/schedule', (req, res) => {
  const dailyReportCron = reports.cronScheduleForDailyReport('23:00');

  res.json({
    ok: true,
    data: {
      dailyReport: {
        schedule: dailyReportCron,
        description: '每天 23:00 生成日汇总报告',
      },
      sessionReport: {
        schedule: 'on-demand',
        description: '会话结束时自动触发',
      },
    },
  });
});

module.exports = router;
