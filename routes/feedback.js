/**
 * /api/feedback 反馈路由 —— 点赞/点踩/满意度
 */
const express = require('express');
const auth = require('../lib/auth');
const qa = require('../lib/qa-store');
const router = express.Router();

/**
 * POST /api/feedback/record — 记录反馈
 * Body: { sessionId, turn, type: 'feedback'|'satisfaction', value: 'up'|'down'|number }
 */
router.post('/record', auth.requireAuth, (req, res) => {
  const { sessionId, turn, type, value } = req.body || {};
  if (!sessionId || turn === undefined || !type) {
    return res.status(400).json({ ok: false, error: '缺少必填字段' });
  }
  try {
    const allRecords = qa.getAllRecords();
    // 找到对应的 AI 记录更新反馈字段
    const aiRecord = allRecords.find(
      r => r.sessionId === sessionId && r.turn === parseInt(turn, 10) && r.type === 'ai'
    );
    if (!aiRecord) {
      return res.status(404).json({ ok: false, error: '记录不存在' });
    }
    // 直接更新内存记录（在 qa-store 中暂不支持 update，记录到 data 中）
    if (type === 'feedback') {
      aiRecord.feedback = value; // 'up' | 'down'
    } else if (type === 'satisfaction') {
      aiRecord.userSatisfaction = parseInt(value, 10);
    }
    // 通过 appendRecord 覆盖（实际通过删除旧记录+添加新记录实现）
    const idx = allRecords.findIndex(
      r => r.sessionId === sessionId && r.turn === parseInt(turn, 10) && r.type === 'ai'
    );
    if (idx !== -1) {
      // 更新后重新写入
      const data = { records: allRecords };
      // 使用 qa-store 的 write 方法
      const store = require('../lib/store');
      data.version = 1;
      data.updatedAt = new Date().toISOString();
      store.write('qa-history', data);
    }
    res.json({ ok: true, message: '反馈已记录' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/feedback/health
 */
router.get('/health', auth.requireAuth, (req, res) => {
  res.json({ ok: true, msg: '反馈路由已就位' });
});

module.exports = router;