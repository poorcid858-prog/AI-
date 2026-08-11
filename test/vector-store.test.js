const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vs = require('../lib/vector-store');
const dp = require('../lib/document-processor');

// ============================================================
// 1. tokenize
//    切词规则：中文 unigram + bigram；英文/数字按连续字符；
//    标点作分隔符，不出现在 tokens 里。
//    与 document-processor 保持一致的切词逻辑。
// ============================================================

test('tokenize 中文按 unigram + bigram 切分', () => {
  const t = vs.tokenize('退款流程');
  assert.ok(t.includes('退'), 'unigram 缺字');
  assert.ok(t.includes('款'), 'unigram 缺字');
  assert.ok(t.includes('流'), 'unigram 缺字');
  assert.ok(t.includes('程'), 'unigram 缺字');
  assert.ok(t.includes('退款'), 'bigram 缺词');
  assert.ok(t.includes('款流'), 'bigram 缺词');
  assert.ok(t.includes('流程'), 'bigram 缺词');
});

test('tokenize 英文按连续字母保留为整体', () => {
  const t = vs.tokenize('refund policy');
  assert.ok(t.includes('refund'));
  assert.ok(t.includes('policy'));
});

test('tokenize 数字按连续数字保留为整体', () => {
  const t = vs.tokenize('订单 10086 金额 19900');
  assert.ok(t.includes('10086'));
  assert.ok(t.includes('19900'));
});

test('tokenize 标点作分隔符，不出现在 tokens 中', () => {
  const t = vs.tokenize('退款，需要审核。金额：100元（含运费）');
  assert.ok(!t.includes('，'), '中文逗号泄漏进 tokens');
  assert.ok(!t.includes('。'), '中文句号泄漏进 tokens');
  assert.ok(!t.includes('：'), '中文冒号泄漏进 tokens');
  assert.ok(!t.includes('（'), '全角左括号泄漏');
  assert.ok(!t.includes('）'), '全角右括号泄漏');
});

test('tokenize 英文统一小写', () => {
  const t = vs.tokenize('Refund Policy');
  assert.ok(t.includes('refund'));
  assert.ok(t.includes('policy'));
  assert.ok(!t.includes('Refund'));
});

test('tokenize 混合中英文都正常切分', () => {
  const t = vs.tokenize('调用 POST /api/order/create 创建订单');
  assert.ok(t.includes('post'));
  assert.ok(t.includes('api'));
  assert.ok(t.includes('order'));
  assert.ok(t.includes('create'));
  assert.ok(t.includes('创'), '中文 unigram 缺字');
  assert.ok(t.includes('建'), '中文 unigram 缺字');
  assert.ok(t.includes('订单'), '中文 bigram 缺词');
});

test('tokenize 纯标点/空白输入返回空数组（不崩溃）', () => {
  const t = vs.tokenize('，。！？  ');
  assert.deepStrictEqual(t, []);
});

// ============================================================
// 2. tf
// ============================================================

test('tf 正确统计 token 频次', () => {
  assert.deepStrictEqual(vs.tf(['退款', '审核', '退款']), { '退款': 2, '审核': 1 });
});

test('tf 空数组返回空对象', () => {
  assert.deepStrictEqual(vs.tf([]), {});
});

// ============================================================
// 3. idf
//    平滑公式 log((N+1)/(df+1)) + 1 —— 避免除零、保证权重为正。
//    越罕见的词权重越大。
// ============================================================

test('idf 罕见词的权重大于常见词', () => {
  // 6 篇文档中"退款"都出现，"流程"只出现一次
  const docs = [
    ['退款', '流程'],
    ['退款', '规则'],
    ['退款', '审核'],
    ['退款', '类型'],
    ['退款', '金额'],
    ['退款', '渠道'],
  ];
  const idf = vs.idf(docs);
  assert.ok(idf['流程'] > idf['退款'], `罕见词应权重大: 流程=${idf['流程']} 退款=${idf['退款']}`);
});

test('idf 词表只覆盖输入文档中出现的词', () => {
  const docs = [['a', 'b'], ['a']];
  const idf = vs.idf(docs);
  assert.ok('a' in idf);
  assert.ok('b' in idf);
});

test('idf 权重为正数（+1 平滑保证）', () => {
  const docs = [['a']];
  const idf = vs.idf(docs);
  assert.ok(idf['a'] > 0, 'idf 权重必须为正');
});

test('idf 词频越多权重越低（趋势正确）', () => {
  const docs = [['a', 'b'], ['a', 'c'], ['a', 'd'], ['a', 'e']];
  const idf = vs.idf(docs);
  // 'a' 在所有 4 篇里，'b'/'c'/'d'/'e' 各只在 1 篇
  for (const rare of ['b', 'c', 'd', 'e']) {
    assert.ok(idf[rare] > idf['a'], `${rare} 权重应高于 a`);
  }
});

// ============================================================
// 4. vectorize
//    返回与 vocab 等长的稠密数组；某词不在文本中则对应位置为 0。
// ============================================================

test('vectorize 返回与词表等长的稠密数组', () => {
  const vocab = ['退款', '审核', '流程'];
  const idfMap = { '退款': 1.0, '审核': 1.5, '流程': 1.2 };
  const v = vs.vectorize('退款 审核', vocab, idfMap);
  assert.ok(Array.isArray(v));
  assert.strictEqual(v.length, 3);
});

test('vectorize 中不存在的词对应位置为 0', () => {
  const vocab = ['退款', '审核', '流程'];
  const idfMap = { '退款': 1.0, '审核': 1.5, '流程': 1.2 };
  const v = vs.vectorize('退款', vocab, idfMap);
  assert.strictEqual(v[vocab.indexOf('审核')], 0);
  assert.strictEqual(v[vocab.indexOf('流程')], 0);
});

test('vectorize 是稀疏的（多数位置为 0）', () => {
  const vocab = ['退款', '审核', '流程', '规则', '类型', '金额', '渠道', '时间'];
  const idfMap = Object.fromEntries(vocab.map((w) => [w, 1]));
  const v = vs.vectorize('退款', vocab, idfMap);
  const zeroCount = v.filter((x) => x === 0).length;
  assert.ok(zeroCount > v.length / 2, '应稀疏：少于一半的 token 应为非零');
});

test('vectorize 非零项的值为 tf * idf', () => {
  const vocab = ['退款', '审核'];
  const idfMap = { '退款': 1.5, '审核': 2.0 };
  // "退款 退款 审核" → tf: 退款=2, 审核=1
  const v = vs.vectorize('退款 退款 审核', vocab, idfMap);
  assert.strictEqual(v[vocab.indexOf('退款')], 2 * 1.5);
  assert.strictEqual(v[vocab.indexOf('审核')], 1 * 2.0);
});

test('vectorize 空文本返回全零向量', () => {
  const vocab = ['退款', '审核'];
  const idfMap = { '退款': 1.0, '审核': 1.0 };
  const v = vs.vectorize('', vocab, idfMap);
  assert.deepStrictEqual(v, [0, 0]);
});

// ============================================================
// 5. cosine
//    余弦相似度：相同=1，正交=0，零向量=0，对称。
// ============================================================

test('cosine 相同向量相似度为 1', () => {
  assert.strictEqual(vs.cosine([1, 2, 3], [1, 2, 3]), 1);
});

test('cosine 正交向量相似度为 0', () => {
  assert.strictEqual(vs.cosine([1, 0, 0], [0, 1, 0]), 0);
});

test('cosine 零向量与零向量相似度为 0（不是 NaN）', () => {
  const r = vs.cosine([0, 0, 0], [0, 0, 0]);
  assert.strictEqual(r, 0);
  assert.ok(!Number.isNaN(r), '零向量不应返回 NaN');
});

test('cosine 零向量与非零向量相似度为 0（不是 NaN）', () => {
  const r = vs.cosine([0, 0, 0], [1, 2, 3]);
  assert.strictEqual(r, 0);
  assert.ok(!Number.isNaN(r));
});

test('cosine 满足对称性', () => {
  const a = [1, 2, 3];
  const b = [4, 5, 6];
  assert.strictEqual(vs.cosine(a, b), vs.cosine(b, a));
});

test('cosine 长度不等的向量不抛异常（按短向量算）', () => {
  // 工程容忍：函数应只比较前 N 个分量，不崩
  const r = vs.cosine([1, 0, 0, 0], [1, 0, 0]);
  assert.ok(typeof r === 'number');
  assert.ok(!Number.isNaN(r));
});

// ============================================================
// 6. buildIndex
// ============================================================

test('buildIndex 产出词表、idfMap、向量集合', () => {
  const chunks = [
    { id: '1', content: '退款流程说明', keywords: ['退款', '流程'] },
    { id: '2', content: '审核规则说明', keywords: ['审核', '规则'] },
  ];
  const index = vs.buildIndex(chunks);
  assert.ok(Array.isArray(index.vocab));
  assert.ok(index.idfMap && typeof index.idfMap === 'object');
  assert.ok(Array.isArray(index.vectors));
});

test('buildIndex 词表/向量集合规模正确', () => {
  const chunks = [
    { id: '1', content: '退款流程' },
    { id: '2', content: '审核规则' },
    { id: '3', content: '会员积分' },
  ];
  const index = vs.buildIndex(chunks);
  assert.strictEqual(index.vectors.length, 3);
  for (const v of index.vectors) {
    assert.strictEqual(v.vec.length, index.vocab.length, '向量长度必须等于词表长度');
  }
});

test('buildIndex 词表包含 unigram 和 bigram', () => {
  const chunks = [{ id: '1', content: '退款流程' }];
  const index = vs.buildIndex(chunks);
  assert.ok(index.vocab.includes('退'), 'unigram 缺');
  assert.ok(index.vocab.includes('款'), 'unigram 缺');
  assert.ok(index.vocab.includes('退款'), 'bigram 缺');
  assert.ok(index.vocab.includes('流程'), 'bigram 缺');
});

test('buildIndex 保留 chunk 的元数据（id/content/heading/keywords/source）', () => {
  const chunks = [
    { id: 'a', content: '退款流程', heading: '退款规则', keywords: ['退款'], source: 'r.md' },
  ];
  const index = vs.buildIndex(chunks);
  assert.strictEqual(index.vectors[0].id, 'a');
  assert.strictEqual(index.vectors[0].content, '退款流程');
  assert.strictEqual(index.vectors[0].heading, '退款规则');
  assert.deepStrictEqual(index.vectors[0].keywords, ['退款']);
  assert.strictEqual(index.vectors[0].source, 'r.md');
});

test('buildIndex 保留权限判据字段（bizLine/securityLevel/status/docId）', () => {
  // rag-engine.permissionFilter 直接过滤 index.vectors，
  // 这四个字段少带任何一个，对应那层过滤就会静默失效 ——
  // 尤其 status：缺字段被当作"合法旧数据"放行，未审核文档会被检索到。
  const chunks = [
    {
      id: 'a', content: '退款流程说明正文', docId: 'doc_1',
      bizLine: 'trade', securityLevel: 'confidential', status: 'pending',
    },
  ];
  const v = vs.buildIndex(chunks).vectors[0];
  assert.strictEqual(v.bizLine, 'trade');
  assert.strictEqual(v.securityLevel, 'confidential');
  assert.strictEqual(v.status, 'pending', 'status 必须穿过索引，否则状态过滤形同虚设');
  assert.strictEqual(v.docId, 'doc_1', 'docId 必须保留，否则命中结果无法回溯到文档');
});

test('buildIndex 对空 chunks 数组也能工作（不崩）', () => {
  const index = vs.buildIndex([]);
  assert.deepStrictEqual(index.vectors, []);
  assert.ok(Array.isArray(index.vocab));
});

// ============================================================
// 7. search
// ============================================================

test('search 召回语义最相关的 topK', () => {
  const chunks = [
    { id: '1', content: '退款流程说明：用户提交退款申请后系统审核', keywords: ['退款', '流程', '审核'] },
    { id: '2', content: '会员积分规则：消费一元积一分', keywords: ['会员', '积分'] },
    { id: '3', content: '物流配送时效：四十八小时内发货', keywords: ['物流', '发货'] },
  ];
  const index = vs.buildIndex(chunks);
  const results = vs.search('退款流程', index, 3);
  assert.ok(results.length > 0);
  assert.strictEqual(results[0].id, '1', '应召回最相关的 chunk');
});

test('search 结果按相似度降序', () => {
  const chunks = [
    { id: '1', content: '退款流程：用户提交申请后系统进入审核环节' },
    { id: '2', content: '退款是售后流程的一环，需要审核' },
    { id: '3', content: '完全无关的会员积分说明' },
  ];
  const index = vs.buildIndex(chunks);
  const results = vs.search('退款流程审核', index, 3);
  assert.ok(results.length >= 2);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score, `结果未降序: ${i - 1}=${results[i - 1].score} ${i}=${results[i].score}`);
  }
});

test('search 返回的项至少包含 id/content/score/heading/keywords', () => {
  const chunks = [
    { id: '1', content: '退款', heading: 'h', keywords: ['k'] },
  ];
  const index = vs.buildIndex(chunks);
  const r = vs.search('退款', index, 1);
  assert.ok(r.length > 0);
  for (const f of ['id', 'content', 'score', 'heading', 'keywords']) {
    assert.ok(f in r[0], `search 返回项缺少字段: ${f}`);
  }
});

test('search 空查询不报错', () => {
  const chunks = [{ id: '1', content: '退款流程' }];
  const index = vs.buildIndex(chunks);
  const r = vs.search('', index, 3);
  assert.ok(Array.isArray(r), '空查询应返回数组，不抛错');
});

test('search 召回条数不超过 topK', () => {
  const chunks = [
    { id: '1', content: '退款流程' },
    { id: '2', content: '审核规则' },
    { id: '3', content: '会员积分' },
  ];
  const index = vs.buildIndex(chunks);
  const r = vs.search('退款', index, 2);
  assert.ok(r.length <= 2, `召回超过 topK: ${r.length}`);
});

// ============================================================
// 8. rerank
//    在 search 召回的基础上加业务权重：标题 +0.3，关键词 +0.1/次，内容 +0.05/次
// ============================================================

test('rerank 标题命中加权：标题含查询词的候选应排在前面', () => {
  const candidates = [
    { id: 'a', content: '其他内容', heading: '退款规则', keywords: [], score: 0.1 },
    { id: 'b', content: '其他内容', heading: '其他说明', keywords: [], score: 0.1 },
  ];
  const result = vs.rerank('退款', candidates, 2);
  assert.strictEqual(result[0].id, 'a', '标题含"退款"的应排第一');
  assert.ok(result[0].score > result[1].score);
});

test('rerank 关键词命中加权：关键词含查询词的候选应加分', () => {
  const candidates = [
    { id: 'a', content: '其他内容', heading: '', keywords: ['退款', '审核'], score: 0.1 },
    { id: 'b', content: '其他内容', heading: '', keywords: [], score: 0.1 },
  ];
  const result = vs.rerank('退款', candidates, 2);
  assert.strictEqual(result[0].id, 'a', '关键词含"退款"的应排第一');
  assert.ok(result[0].score > result[1].score);
});

test('rerank 内容命中加权：内容含查询词多的候选应加分更多', () => {
  const candidates = [
    { id: 'a', content: '退款退款退款退款退款', heading: '', keywords: [], score: 0.1 },
    { id: 'b', content: '其他完全无关的内容', heading: '', keywords: [], score: 0.1 },
  ];
  const result = vs.rerank('退款', candidates, 2);
  assert.strictEqual(result[0].id, 'a');
  assert.ok(result[0].score > result[1].score);
});

test('rerank 三种加权同时生效：全中的候选分数最高', () => {
  const candidates = [
    { id: 'a', content: '其他', heading: '其他', keywords: [], score: 0.1 },
    { id: 'b', content: '退款', heading: '', keywords: [], score: 0.1 },
    { id: 'c', content: '退款退款退款', heading: '退款规则', keywords: ['退款', '流程'], score: 0.1 },
  ];
  const result = vs.rerank('退款', candidates, 3);
  assert.strictEqual(result[0].id, 'c', '三种加权全中的应排第一');
});

test('rerank 返回条数不超过 topK', () => {
  const candidates = [
    { id: '1', content: '退款', heading: '', keywords: [], score: 0.1 },
    { id: '2', content: '退款', heading: '', keywords: [], score: 0.1 },
    { id: '3', content: '退款', heading: '', keywords: [], score: 0.1 },
  ];
  const result = vs.rerank('退款', candidates, 2);
  assert.strictEqual(result.length, 2);
});

test('rerank 保留 baseScore 字段（cosine 原分可追溯）', () => {
  const candidates = [
    { id: 'a', content: '退款', heading: '退款规则', keywords: [], score: 0.2 },
  ];
  const result = vs.rerank('退款', candidates, 1);
  assert.strictEqual(result[0].baseScore, 0.2, 'baseScore 应保留原始 cosine 分数');
  assert.ok(result[0].score > 0.2, 'rerank 后 score 应 = baseScore + bonus');
});

test('rerank bonus 按 query token 数归一化：长 query 单次命中加分 < 短 query 单次命中', () => {
  // 短 query "退款" (1 个有效 token) 在 退款chunk 上：bonus = 0.05 / 1 = 0.05
  const short = vs.rerank('退款', [{ id: 'a', content: '这是一个退款的内容', heading: '', keywords: [], score: 0 }], 1);
  // 长 query "退款政策说明" (经停用词过滤后约 3 个 token) 同样一次命中：bonus = 0.05 / 3 ≈ 0.0167
  const long = vs.rerank('退款政策说明', [{ id: 'b', content: '这是一个退款的内容', heading: '', keywords: [], score: 0 }], 1);
  assert.ok(short[0].score > long[0].score, '短 query 单次命中的加分应大于长 query');
});

test('rerank 停用词不参与加权：问"怎么退款" 与 问"退款" 的排序应一致', () => {
  const candidates = [
    { id: 'a', content: '其他无关内容', heading: '其他', keywords: [], score: 0.1 },
    { id: 'b', content: '退款流程', heading: '退款', keywords: ['退款'], score: 0.1 },
  ];
  const r1 = vs.rerank('怎么退款', candidates, 2);
  const r2 = vs.rerank('退款', candidates, 2);
  assert.strictEqual(r1[0].id, r2[0].id, '加停用词前后排序应一致');
});

// ============================================================
// 9. 真实文档回归
//    跑 document-processor 拿 13 份模拟文档的 chunks，建索引后
//    搜 "退款流程" 必须命中 trade 退款文档。
// ============================================================

function buildRealIndex() {
  const base = path.join(__dirname, '..', 'mock-data', 'documents');
  const allChunks = [];
  for (const line of fs.readdirSync(base)) {
    for (const file of fs.readdirSync(path.join(base, line))) {
      const raw = fs.readFileSync(path.join(base, line, file), 'utf8');
      const { chunks } = dp.processDocument(raw, { source: file });
      allChunks.push(...chunks);
    }
  }
  return { allChunks, index: vs.buildIndex(allChunks) };
}

test('真实文档回归：搜索"退款流程"在 topK 内命中 trade 退款文档', () => {
  const { index } = buildRealIndex();
  const results = vs.search('退款流程', index, 5);
  assert.ok(results.length > 0, '应召回至少一条');
  // 召回结果中应包含来自退款流程文档的 chunk
  const refundHit = results.find((r) => r.source === 'refund-process.md');
  assert.ok(refundHit, `应命中 refund-process.md，实际来源: ${results.map((r) => r.source).join(', ')}`);
  assert.ok(refundHit.content.includes('退款'), '命中 chunk 的内容应含"退款"');
});

test('真实文档回归：search + rerank 后，前 5 条里至少 3 条来自退款相关文档', () => {
  const { index } = buildRealIndex();
  const recalled = vs.search('退款', index, 12);
  assert.ok(recalled.length > 0);
  const reranked = vs.rerank('退款', recalled, 5);
  const fromRefund = reranked.filter((r) => r.content.includes('退款')).length;
  assert.ok(fromRefund >= 3, `前 5 条中含"退款"的应至少 3 条，实际 ${fromRefund}`);
});

test('真实文档回归：搜索"会员积分"命中 membership 会员文档', () => {
  const { index } = buildRealIndex();
  const results = vs.search('会员积分', index, 5);
  assert.ok(results.length > 0);
  const first = results[0];
  // 命中会员类文档（points-rules.md / member-system.md 等）
  assert.ok(
    first.content.includes('会员') || first.content.includes('积分'),
    '首条内容应含"会员"或"积分"'
  );
});

// ============================================================
// 10. 不区分大小写 / 跨中英文混合
// ============================================================

test('不区分大小写：大写查询与全小写查询召回一致', () => {
  const chunks = [
    { id: '1', content: 'Refund policy for international orders', keywords: [] },
    { id: '2', content: '物流配送说明', keywords: [] },
  ];
  const index = vs.buildIndex(chunks);
  const r1 = vs.search('REFUND', index, 3);
  const r2 = vs.search('refund', index, 3);
  assert.ok(r1.length > 0 && r2.length > 0);
  assert.strictEqual(r1[0].id, r2[0].id, '大小写不一致应召回相同首条');
});

test('跨中英文混合：搜索"refund 退款"能命中同时含中英文的 chunk', () => {
  const chunks = [
    { id: '1', content: 'Refund policy 退款流程说明', keywords: [] },
    { id: '2', content: '积分规则说明', keywords: [] },
    { id: '3', content: 'shipping fee 运费规则', keywords: [] },
  ];
  const index = vs.buildIndex(chunks);
  const results = vs.search('refund 退款', index, 3);
  assert.ok(results.length > 0);
  assert.strictEqual(results[0].id, '1', '中英混合查询应召回同时含两者的 chunk');
});

// ============================================================
// 11. 边界 case —— 防止崩溃 + 空索引/空 query 优雅返回
// ============================================================

test('tokenize 非字符串输入不崩（自动 toString）', () => {
  const t = vs.tokenize(123);
  assert.ok(t.includes('123'), '数字应被切出来');
  const t2 = vs.tokenize(null);
  assert.deepStrictEqual(t2, [], 'null 应返回空数组');
  const t3 = vs.tokenize(undefined);
  assert.deepStrictEqual(t3, []);
});

test('idf 空文档数组不崩', () => {
  const m = vs.idf([]);
  assert.deepStrictEqual(m, {});
  const m2 = vs.idf([[]]);
  assert.deepStrictEqual(m2, {});
});

test('vectorize 空 vocab + 空 idf 返回空数组', () => {
  const v = vs.vectorize('退款流程', [], {});
  assert.deepStrictEqual(v, []);
  const v2 = vs.vectorize('', ['退款'], { '退款': 1 });
  assert.deepStrictEqual(v2, [0]);
});

test('search 空索引返回 []', () => {
  assert.deepStrictEqual(vs.search('退款', { vocab: [], idfMap: {}, vectors: [] }, 5), []);
  assert.deepStrictEqual(vs.search('退款', null, 5), []);
  assert.deepStrictEqual(vs.search('退款', undefined, 5), []);
});

test('search 极不相关查询可能返回 []（被 minScore 阈值过滤）', () => {
  const chunks = [{ id: '1', content: '关于手机壳的产品介绍' }];
  const index = vs.buildIndex(chunks);
  // 不期望命中 → 结果可能空（具体取决于 minScore 阈值）
  assert.ok(Array.isArray(vs.search('退款政策细则到账时效', index, 5)));
});

test('rerank 空 query 走 fallback：按原 score 排序、不叠加 bonus', () => {
  const candidates = [
    { id: 'a', content: '退款', heading: '退款', keywords: [], score: 0.2 },
    { id: 'b', content: '发货', heading: '发货', keywords: [], score: 0.5 },
  ];
  const r = vs.rerank('', candidates, 2);
  assert.strictEqual(r[0].id, 'b', '空 query 应按原 score 排序');
  assert.strictEqual(r[0].baseScore, 0.5);
});

test('rerank 空 candidates 返回 []', () => {
  assert.deepStrictEqual(vs.rerank('退款', [], 5), []);
  assert.deepStrictEqual(vs.rerank('退款', null, 5), []);
});

test('rerank 边界：topK > candidates.length 时返回全部', () => {
  const candidates = [{ id: 'a', content: '退款', heading: '', keywords: [], score: 0.1 }];
  const r = vs.rerank('退款', candidates, 10);
  assert.strictEqual(r.length, 1);
});

test('search 阈值生效：minScore 之下不召回', () => {
  const chunks = [{ id: '1', content: '退款流程' }];
  const index = vs.buildIndex(chunks);
  // 构造一个与语料完全无关的查询：cosine 应 < minScore
  const r = vs.search('完全不相关的航天发动机原理', index, 5);
  // 此查询在向量空间里与"退款流程"接近正交，cosine ≈ 0，应被阈值过滤
  assert.ok(r.length === 0 || r.every((x) => x.score > 0.02), '低于 minScore 的不召回');
});
