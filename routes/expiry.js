/**
 * 文档过期管理 API 路由（需求 9）
 *
 * 职责：
 * - 手动触发过期检查
 * - 查询即将到期 / 已过期文档列表
 * - 管理有效期
 */

const express = require('express');
const expiry = require('../lib/expiry');
const kl = require('../lib/knowledge-layers');

const router = express.Router();

/**
 * POST /api/expiry/scan
 * 手动触发过期检查：将已过期文档转为 need_review
 */
router.post('/scan', (req, res) => {
  try {
    const count = expiry.processExpired();
    res.json({
      ok: true,
      data: { processed: count },
      message: `已处理 ${count} 个过期文档`,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/expiry/expiring
 * 获取即将到期的文档列表（未来 N 天内）
 */
router.get('/expiring', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const list = expiry.getExpiringDocs(days);
    res.json({
      ok: true,
      data: list,
      count: list.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/expiry/expired
 * 获取已过期的文档列表
 */
router.get('/expired', (req, res) => {
  try {
    const list = expiry.getExpiredDocs();
    res.json({
      ok: true,
      data: list,
      count: list.length,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * PATCH /api/expiry/:stdId/reviewed
 * 标记某文档已复审（need_review → published）
 */
router.patch('/:stdId/reviewed', (req, res) => {
  const { stdId } = req.params;
  try {
    const std = kl.getStd(stdId);
    if (!std) {
      return res.status(404).json({ ok: false, error: '标准化文档不存在' });
    }
    const updated = kl.setStdStatus(stdId, kl.STD_STATUS.PUBLISHED);
    res.json({
      ok: true,
      data: { id: updated.id, status: updated.status },
      message: '已标记为复审通过',
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

/**
 * DELETE /api/expiry/:stdId/archive
 * 手动下架文档
 */
router.delete('/:stdId/archive', (req, res) => {
  const { stdId } = req.params;
  try {
    const archived = kl.archiveStd(stdId);
    res.json({
      ok: true,
      data: { id: archived.id, status: archived.status },
      message: '文档已下架',
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/expiry/:stdId/status
 * 查询某文档的过期状态
 */
router.get('/:stdId/status', (req, res) => {
  const { stdId } = req.params;
  try {
    const std = kl.getStd(stdId);
    if (!std) {
      return res.status(404).json({ ok: false, error: '标准化文档不存在' });
    }
    const raw = kl.getRaw(std.rawId);
    const isExpired = expiry.isStdExpired(stdId);
    res.json({
      ok: true,
      data: {
        stdId,
        status: std.status,
        isExpired,
        validUntil: raw ? raw.validUntil : null,
        title: raw ? raw.title : null,
      },
    });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, error: error.message });
  }
});

module.exports = router;