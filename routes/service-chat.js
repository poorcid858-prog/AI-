/**
 * 客服对话路由
 *
 * 需求 3：AI 客服独立子系统
 * 职责：接收客户问题，通过关键字匹配检索，返回话术或转人工
 */

const express = require('express');
const engine = require('../lib/service-engine');

const router = express.Router();

// 暂时硬编码测试数据（实际应从数据库读取）
const serviceData = {
  phrases: [
    { id: 'p1', keyword: '退款', reply: '我们支持 30 天内无条件退款' },
    { id: 'p2', keyword: '退货', reply: '退货流程：1. 填写申请 2. 等待审核 3. 上门取件 4. 签收确认' },
  ],
  synonyms: {
    '退货': ['不想要', '能不能退', '寄回去'],
    '退款': ['退钱', '钱啥时候到'],
  },
};

/**
 * POST /api/service-chat/send
 * 客户提问 → 关键字匹配 → 返回话术
 */
router.post('/send', (req, res) => {
  const { question, role } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ ok: false, error: '问题不能为空' });
  }

  // 调用核心引擎
  const result = engine.processQuestion(
    question,
    serviceData.synonyms,
    serviceData.phrases
  );

  // 补充完整的 phrase 信息到 matches 中
  const enrichedMatches = result.matches.map(match => {
    const phrase = serviceData.phrases.find(p => p.id === match.id);
    return {
      ...match,
      reply: phrase?.reply || '',
    };
  });

  res.json({
    ok: true,
    originalTokens: result.originalTokens,
    filteredTokens: result.filteredTokens,
    normalizedTokens: result.normalizedTokens,
    matches: enrichedMatches,
  });
});

module.exports = router;
