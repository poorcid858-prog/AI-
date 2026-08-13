/**
 * 客服管理后台路由
 *
 * 需求 3：AI 客服独立子系统
 * 职责：话术库、同义词表、未命中池的 CRUD 操作
 */

const express = require('express');

const router = express.Router();

// 暂时硬编码测试数据（实际应从数据库读取）
const serviceData = {
  phrases: [
    { id: 'p1', keyword: '退款', reply: '我们支持 30 天内无条件退款', priority: 1 },
    { id: 'p2', keyword: '退货', reply: '退货流程：1. 填写申请 2. 等待审核 3. 上门取件 4. 签收确认', priority: 2 },
  ],
  synonyms: [
    { keyword: '退货', variants: ['不想要', '能不能退', '寄回去'] },
    { keyword: '退款', variants: ['退钱', '钱啥时候到'] },
  ],
};

/**
 * GET /api/service-admin/phrases
 * 获取话术库列表
 */
router.get('/phrases', (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  // 简单分页
  const start = (page - 1) * limit;
  const end = start + parseInt(limit);
  const paginated = serviceData.phrases.slice(start, end);

  res.json({
    ok: true,
    data: paginated,
    total: serviceData.phrases.length,
    page: parseInt(page),
    limit: parseInt(limit),
  });
});

/**
 * POST /api/service-admin/phrases
 * 新增话术
 */
router.post('/phrases', (req, res) => {
  const { keyword, reply, priority = 1 } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ ok: false, error: 'keyword 不能为空' });
  }

  if (!reply || !reply.trim()) {
    return res.status(400).json({ ok: false, error: 'reply 不能为空' });
  }

  const newPhrase = {
    id: `p${Date.now()}`,
    keyword,
    reply,
    priority: parseInt(priority),
  };

  serviceData.phrases.push(newPhrase);

  res.status(201).json({
    ok: true,
    data: newPhrase,
  });
});

/**
 * DELETE /api/service-admin/phrases/:id
 * 删除话术
 */
router.delete('/phrases/:id', (req, res) => {
  const { id } = req.params;

  const index = serviceData.phrases.findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ ok: false, error: '话术不存在' });
  }

  const deleted = serviceData.phrases.splice(index, 1);

  res.json({
    ok: true,
    deleted: deleted[0],
  });
});

/**
 * GET /api/service-admin/synonyms
 * 获取同义词表
 */
router.get('/synonyms', (req, res) => {
  res.json({
    ok: true,
    data: serviceData.synonyms,
    total: serviceData.synonyms.length,
  });
});

/**
 * POST /api/service-admin/synonyms
 * 新增同义词
 */
router.post('/synonyms', (req, res) => {
  const { keyword, variants } = req.body;

  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ ok: false, error: 'keyword 不能为空' });
  }

  if (!Array.isArray(variants)) {
    return res.status(400).json({ ok: false, error: 'variants 必须是数组' });
  }

  const newSynonym = {
    keyword,
    variants,
  };

  serviceData.synonyms.push(newSynonym);

  res.status(201).json({
    ok: true,
    data: newSynonym,
  });
});

/**
 * DELETE /api/service-admin/synonyms/:keyword
 * 删除同义词
 */
router.delete('/synonyms/:keyword', (req, res) => {
  const { keyword } = req.params;

  const index = serviceData.synonyms.findIndex(s => s.keyword === keyword);

  if (index === -1) {
    return res.status(404).json({ ok: false, error: '同义词不存在' });
  }

  const deleted = serviceData.synonyms.splice(index, 1);

  res.json({
    ok: true,
    deleted: deleted[0],
  });
});

module.exports = router;
