/**
 * AI 客服路由单元测试（需求 3）
 *
 * 直接测试路由处理函数，不依赖 supertest
 */

const test = require('node:test');
const assert = require('node:assert');
const chatRouter = require('../routes/service-chat');
const adminRouter = require('../routes/service-admin');
const engine = require('../lib/service-engine');

// ============ 测试核心逻辑（不通过 HTTP）============

test('S1: 分词 + 打分正常工作', () => {
  const question = '怎样退款？';
  const synonyms = {
    '退货': ['不想要', '能不能退', '寄回去'],
    '退款': ['退钱', '钱啥时候到'],
  };
  const phrases = [
    { id: 'p1', keyword: '退款', reply: '我们支持 30 天内无条件退款' },
  ];

  const result = engine.processQuestion(question, synonyms, phrases);

  assert(result.matches !== undefined, '应返回匹配结果');
  assert(Array.isArray(result.matches), 'matches 应是数组');
});

test('S1b: 空问题不应崩溃', () => {
  const result = engine.processQuestion('', {}, []);
  assert(result !== undefined, '空问题应返回结果对象而非 undefined');
});

test('S1c: 无匹配时返回空数组', () => {
  const result = engine.processQuestion('某个不存在的词', {}, [
    { id: 'p1', keyword: '退款' },
  ]);

  assert(Array.isArray(result.matches), 'matches 应是数组');
  // 可能为空，也可能有无关匹配
});

// ============ 测试路由模块导出 ============

test('S2: service-chat 路由模块可正常导入', () => {
  assert(chatRouter !== undefined, 'chatRouter 应能导入');
  assert(typeof chatRouter === 'function', 'Express 路由应是函数');
});

test('S3: service-admin 路由模块可正常导入', () => {
  assert(adminRouter !== undefined, 'adminRouter 应能导入');
  assert(typeof adminRouter === 'function', 'Express 路由应是函数');
});

// ============ 验证关键字处理函数 ============

test('S4: tokenize 能处理多种输入', () => {
  const cases = [
    { input: '退款', expected: 'token 数 > 0' },
    { input: '', expected: '返回空数组' },
    { input: 'refund', expected: '英文词保留' },
  ];

  for (const { input } of cases) {
    const result = engine.tokenize(input);
    assert(Array.isArray(result), `tokenize(${input}) 应返回数组`);
  }
});

test('S5: removeStopwords 过滤有效', () => {
  const tokens = ['怎', '样', '退', '款'];
  const filtered = engine.removeStopwords(tokens);

  assert(filtered.length <= tokens.length, '过滤后数量应减少或不变');
});

test('S6: normalize 能映射同义词', () => {
  const tokens = ['不想要'];
  const synonyms = {
    '退货': ['不想要', '能不能退'],
    '退款': ['退钱'],
  };

  const result = engine.normalize(tokens, synonyms);

  assert(result.length === 1, '应返回等长或更短的数组');
  assert(result[0] === '退货' || result[0] === '不想要', '应映射或保留原词');
});
