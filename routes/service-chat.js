/**
 * 客服对话路由
 *
 * 需求 3：AI 客服独立子系统
 * 职责：接收客户问题，通过关键字匹配检索，返回话术或转人工
 * 数据层：lib/service-store.js（JSON 文件持久化）
 */

const express = require('express');
const engine = require('../lib/service-engine');
const serviceStore = require('../lib/service-store');

const router = express.Router();

/**
 * POST /api/service-chat/send
 * 客户提问 → 关键字匹配 → 返回话术
 */
router.post('/send', (req, res) => {
  const { question, role } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ ok: false, error: '问题不能为空' });
  }

  // 从持久化存储读取话术和同义词
  const phrases = serviceStore.listPhrases();
  const synonyms = serviceStore.listSynonyms();

  // 构建同义词对象（{keyword: [variants]} 格式）
  const synonymsMap = {};
  for (const s of synonyms) {
    synonymsMap[s.keyword] = s.variants || [];
  }

  // 调用核心引擎
  const result = engine.processQuestion(question, synonymsMap, phrases);

  // 补充完整的 phrase 信息到 matches 中
  const enrichedMatches = result.matches.map(match => {
    const phrase = phrases.find(p => p.id === match.id);
    return {
      ...match,
      reply: phrase?.reply || '',
    };
  });

  // 记录聊天日志
  const matched = enrichedMatches.length > 0;
  const publicFallback = matched ? enrichedMatches.some(m => {
    const phrase = phrases.find(p => p.id === m.id);
    return phrase && phrase.keyword === 'public';
  }) : false;

  serviceStore.addChatLog({
    question,
    matched,
    matchCount: enrichedMatches.length,
    keyword: matched ? enrichedMatches[0].keyword : null,
    publicFallback,
  });

  // 未命中时记录到未命中池
  if (!matched) {
    serviceStore.addUnmatched(question, role || 'cs');
  }

  res.json({
    ok: true,
    originalTokens: result.originalTokens,
    filteredTokens: result.filteredTokens,
    normalizedTokens: result.normalizedTokens,
    matches: enrichedMatches,
  });
});

module.exports = router;
