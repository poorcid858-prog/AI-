/**
 * 快照对比 API 路由 —— 需求 7：回答对比调试工具
 *
 * 接口：
 *   GET    /api/compare/questions          — 列出测试问题
 *   POST   /api/compare/questions          — 新增测试问题
 *   PUT    /api/compare/questions/:id      — 更新测试问题
 *   DELETE /api/compare/questions/:id      — 删除测试问题
 *   POST   /api/compare/snapshots          — 生成快照（A/B）
 *   GET    /api/compare/snapshots           — 列出所有快照
 *   DELETE /api/compare/snapshots/:id      — 删除快照
 *   POST   /api/compare/compare            — 对比两张快照
 */

const express = require('express');
const sc = require('../lib/snapshot-compare');
const rag = require('../lib/rag-engine');
const engine = require('../lib/service-engine');

const router = express.Router();

// ============================================================
// 测试问题 CRUD
// ============================================================

router.get('/questions', (req, res) => {
  res.json({ ok: true, questions: sc.listQuestions() });
});

router.post('/questions', (req, res) => {
  const { text, role, category } = req.body || {};
  if (!text || !text.trim()) {
    return res.status(400).json({ ok: false, error: '问题文本不能为空' });
  }
  const q = sc.addQuestion({ text: text.trim(), role: role || 'cs', category: category || '通用' });
  res.json({ ok: true, question: q });
});

router.put('/questions/:id', (req, res) => {
  const { text, role, category } = req.body || {};
  const patch = {};
  if (text !== undefined) patch.text = text.trim();
  if (role !== undefined) patch.role = role;
  if (category !== undefined) patch.category = category;
  const updated = sc.updateQuestion(req.params.id, patch);
  if (!updated) return res.status(404).json({ ok: false, error: '问题不存在' });
  res.json({ ok: true, question: updated });
});

router.delete('/questions/:id', (req, res) => {
  const ok = sc.removeQuestion(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '问题不存在' });
  res.json({ ok: true });
});

// ============================================================
// 快照管理
// ============================================================

/**
 * POST /api/compare/snapshots
 * 生成快照 —— 对每个测试问题跑一遍检索/客服，记录结果。
 *
 * Body: { label: 'A'|'B', mode: 'rag'|'service' }
 *   - rag: 走 RAG 检索 + 模拟回答
 *   - service: 走客服引擎（关键字匹配）
 */
router.post('/snapshots', (req, res) => {
  const { label, mode } = req.body || {};
  if (!label || !['A', 'B'].includes(label)) {
    return res.status(400).json({ ok: false, error: 'label 必须为 A 或 B' });
  }
  const questions = sc.listQuestions();
  if (questions.length === 0) {
    return res.status(400).json({ ok: false, error: '没有测试问题，请先添加问题' });
  }

  const results = [];
  const user = { id: 'admin', name: '管理员', role: 'admin', bizLine: 'all' };

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    let decomposed = null;
    let retrievedChunks = [];
    let aiAnswer = '';
    let serviceHitRate = 0;
    let transferRate = 0;

    if (mode === 'service') {
      // 客服模式：用 service-engine 做关键字匹配
      const serviceData = {
        phrases: [
          { id: 'p1', keyword: '退款', reply: '我们支持 30 天内无条件退款' },
          { id: 'p2', keyword: '退货', reply: '退货流程：1. 填写申请 2. 等待审核 3. 上门取件 4. 签收确认' },
          { id: 'p3', keyword: '订单', reply: '订单查询：提供订单号可查询物流状态' },
          { id: 'p4', keyword: '物流', reply: '物流信息可在订单详情页查看，通常 3-5 个工作日送达' },
          { id: 'p5', keyword: 'PRD', reply: 'PRD 文档标准模板：背景、目标、范围、功能需求、非功能需求' },
        ],
        synonyms: {
          '退货': ['不想要', '能不能退', '寄回去'],
          '退款': ['退钱', '钱啥时候到'],
          '订单': ['我的单', '查到', '记录'],
          '物流': ['快递', '多久到', '什么时候到'],
          'PRD': ['需求文档', '产品需求', 'prd模板'],
        },
      };
      const proc = engine.processQuestion(q.text, serviceData.synonyms, serviceData.phrases);
      const matches = proc.matches.map((m) => {
        const phrase = serviceData.phrases.find((p) => p.id === m.id);
        return { id: m.id, keyword: m.keyword, score: m.score, reply: phrase ? phrase.reply : '' };
      });
      const hitCount = matches.length;
      const totalKeywords = serviceData.phrases.length;
      serviceHitRate = totalKeywords > 0 ? +(hitCount / totalKeywords).toFixed(2) : 0;
      transferRate = serviceHitRate > 0.5 ? 0.1 : 0.5;
      aiAnswer = matches.length > 0 ? matches[0].reply : '抱歉，未能匹配到相关话术，已转人工客服。';
      decomposed = {
        originalTokens: proc.originalTokens,
        filteredTokens: proc.filteredTokens,
        normalizedTokens: proc.normalizedTokens,
      };
      retrievedChunks = matches;
    } else {
      // RAG 模式（默认）
      try {
        const index = rag.loadApprovedIndex();
        const results = rag.retrieve(user, q.text, index);
        retrievedChunks = results.map((r) => ({
          id: r.id,
          content: r.content || '',
          score: r.score || 0,
        }));
        const totalChunks = retrievedChunks.length;
        const highScore = retrievedChunks.filter((c) => c.score > 0.3).length;
        serviceHitRate = totalChunks > 0 ? +(highScore / totalChunks).toFixed(2) : 0;
        transferRate = totalChunks === 0 ? 1.0 : +(1 - serviceHitRate).toFixed(2);
        aiAnswer = retrievedChunks.length > 0
          ? `基于检索结果，回答：${retrievedChunks[0].content}`
          : '未检索到相关内容。';
      } catch (_) {
        retrievedChunks = [];
        serviceHitRate = 0;
        transferRate = 0;
        aiAnswer = '（检索失败，请检查数据状态）';
      }
      decomposed = {
        originalTokens: [],
        filteredTokens: [],
        normalizedTokens: [],
      };
    }

    results.push({
      questionIndex: i,
      decomposed,
      retrievedChunks,
      aiAnswer,
      serviceHitRate,
      transferRate,
    });
  }

  const snapshot = sc.generateSnapshot(label, results);
  res.json({ ok: true, snapshot });
});

router.get('/snapshots', (req, res) => {
  res.json({ ok: true, snapshots: sc.listSnapshots() });
});

router.delete('/snapshots/:id', (req, res) => {
  const ok = sc.removeSnapshot(req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: '快照不存在' });
  res.json({ ok: true });
});

// ============================================================
// 快照对比
// ============================================================

/**
 * POST /api/compare/compare
 * 对比两张快照。
 * Body: { labelA: string, labelB: string }
 */
router.post('/compare', (req, res) => {
  const { labelA, labelB } = req.body || {};
  if (!labelA || !labelB) {
    return res.status(400).json({ ok: false, error: '需要 labelA 和 labelB' });
  }
  try {
    const result = sc.compareSnapshots(labelA, labelB);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(404).json({ ok: false, error: err.message });
  }
});

module.exports = router;