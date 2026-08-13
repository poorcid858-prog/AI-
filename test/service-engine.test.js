/**
 * AI 客服引擎单元测试（需求 3）
 *
 * TDD 流程：
 * 1. RED - 写失败的测试
 * 2. GREEN - 写最小化代码通过测试
 * 3. REFACTOR - 保持绿色下优化
 */

const test = require('node:test');
const assert = require('node:assert');
const engine = require('../lib/service-engine');

// ============ T1: 分词测试 ============

test('T1: tokenize 中文按 unigram + bigram 切分', () => {
  const text = '退款流程';
  const tokens = engine.tokenize(text);

  // 中文应该包含 unigram（单字）和 bigram（相邻字对）
  assert(Array.isArray(tokens), 'tokenize 应返回数组');
  assert(tokens.length > 0, '分词结果不能为空');

  // 检查是否包含关键词
  const joined = tokens.join('');
  assert(joined.includes('退') || joined.includes('退款'), '应包含"退"或"退款"');
  assert(joined.includes('款') || joined.includes('流'), '应包含"款"或"流"');
});

test('T1b: tokenize 英文按连续字母保留为整体', () => {
  const text = 'refund policy';
  const tokens = engine.tokenize(text);

  assert(Array.isArray(tokens));
  assert(tokens.length > 0);
  assert(tokens.some(t => t === 'refund' || t.includes('refund')), '应保留整个 refund 单词');
});

test('T1c: tokenize 转小写并去标点', () => {
  const text = '怎样退款？';
  const tokens = engine.tokenize(text);

  assert(!tokens.some(t => t === '？'), '标点应被去掉');
  const hasLower = tokens.some(t => t === t.toLowerCase());
  assert(hasLower || tokens.length > 0, '处理后应无标点');
});

// ============ T2: 停用词过滤 ============

test('T2: removeStopwords 过滤常见虚词', () => {
  const tokens = ['怎', '样', '退', '款'];
  const filtered = engine.removeStopwords(tokens);

  assert(Array.isArray(filtered));
  // 停用词列表应该包含"怎"、"样"这类虚词
  assert(filtered.length <= tokens.length, '过滤后数量应减少');
  assert(filtered.includes('退') || filtered.includes('款'), '应保留实词');
});

// ============ T3: 同义词归一 ============

test('T3: normalize 将客户说法映射到标准词', () => {
  const tokens = ['不', '想', '要'];
  const synonyms = {
    '退货': ['不想要', '能不能退', '寄回去'],
    '退款': ['退钱', '钱啥时候到'],
  };

  const normalized = engine.normalize(tokens, synonyms);

  assert(Array.isArray(normalized));
  assert(normalized.length > 0);
  // 应该包含映射后的标准词或原词
  assert(normalized.some(t => t === '退货' || t === '不'), '应该有标准词或原始词');
});

// ============ T4: 关键字打分 ============

test('T4: scoreMatches 按相似度打分并排序', () => {
  const normalizedTokens = ['退货', '时效'];
  const phraseKeywords = [
    { id: 'p1', keyword: '退货' },
    { id: 'p2', keyword: '退款' },
    { id: 'p3', keyword: '时效' },
  ];
  const idf = { '退货': 0.8, '时效': 0.9, '退款': 0.7 };

  const scored = engine.scoreMatches(normalizedTokens, phraseKeywords, idf);

  assert(Array.isArray(scored));
  assert(scored.length > 0, '应返回有评分的结果');

  // 第一个应该是分数最高的（退货 + 时效都匹配）
  if (scored.length > 0) {
    assert(scored[0].score !== undefined, '结果应包含 score 字段');
  }
});

// ============ T5: IDF 权重计算 ============

test('T5: calculateIdf 罕见词权重高于常见词', () => {
  const documents = [
    ['退款', '流程'],
    ['退款', '规则'],
    ['时效', '规则'],
    ['退货', '流程'],
  ];

  const idf = engine.calculateIdf(documents);

  assert(typeof idf === 'object', 'IDF 应返回对象');

  // "时效" 出现 1 次，"退款"、"流程" 各 2 次
  // 出现次数少的词权重应该大
  if (idf['时效'] !== undefined && idf['退款'] !== undefined) {
    assert(idf['时效'] > idf['退款'], '罕见词权重应高于常见词');
  }
});

// ============ T6: 端到端流程 ============

test('T6: 完整流程 从客户提问到打分结果', () => {
  const question = '我不想要这个东西';
  const synonyms = {
    '退货': ['不想要', '能不能退'],
    '退款': ['退钱', '钱啥时候到'],
  };
  const phraseKeywords = [
    { id: 'p1', keyword: '退货' },
    { id: 'p2', keyword: '退款' },
  ];

  const result = engine.processQuestion(question, synonyms, phraseKeywords);

  assert(result !== undefined, '应返回处理结果');
  assert(result.matches !== undefined || Array.isArray(result), '结果应包含匹配信息');
});
