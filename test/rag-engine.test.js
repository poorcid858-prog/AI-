/**
 * RAG 引擎测试 —— 第 7 步
 *
 * 覆盖：
 *   1. permissionFilter 业务线隔离
 *   2. permissionFilter 密级隔离
 *   3. permissionFilter 状态过滤
 *   4. retrieve 主流程
 *   5. loadApprovedIndex
 *   6. 真实端到端回归（13 份模拟文档）
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rag = require('../lib/rag-engine');
const vs = require('../lib/vector-store');
const dp = require('../lib/document-processor');
const config = require('../config');
const auth = require('../lib/auth');
const store = require('../lib/store');

// ============================================================
// 工具：构造 chunk / user 夹具
// ============================================================

let _idSeq = 0;
function makeChunk(opts = {}) {
  _idSeq += 1;
  return {
    id: opts.id || `c_${_idSeq}`,
    content: opts.content || '默认正文内容足够长以满足向量化的输入要求，包含若干关键词便于检索。',
    heading: opts.heading || null,
    keywords: opts.keywords || [],
    fingerprint: opts.fingerprint || `fp_${_idSeq}_${Math.random().toString(36).slice(2, 6)}`,
    bizLine: opts.bizLine,
    securityLevel: opts.securityLevel,
    source: opts.source || null,
    status: opts.status, // 可能是 undefined（不参与状态过滤）
  };
}

const admin = { id: 'u_admin', role: 'admin', bizLine: 'all', readonly: false };
const reviewer = { id: 'u_reviewer', role: 'reviewer', bizLine: 'all', readonly: false };
const tradePM = { id: 'u_trade', role: 'product', bizLine: 'trade', readonly: false };
const memberPM = { id: 'u_member', role: 'product', bizLine: 'membership', readonly: false };
const allPM = { id: 'u_all', role: 'product', bizLine: 'all', readonly: false };
const csAgent = { id: 'u_cs', role: 'cs', bizLine: 'all', readonly: false };
const guest = { id: 'u_guest', role: 'guest', bizLine: 'all', readonly: true };

// ============================================================
// 1. permissionFilter 业务线隔离（最关键）
// ============================================================

test('业务线隔离：交易线 PM 能看 trade / all，看不到 membership', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, tradePM);
  const lines = out.map((c) => c.bizLine);
  assert.ok(lines.every((l) => l === 'trade' || l === 'all'), `交易线 PM 看到了越权内容: ${lines}`);
  assert.strictEqual(out.length, 2);
});

test('业务线隔离：会员线 PM 能看 membership / all，看不到 trade', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, memberPM);
  const lines = out.map((c) => c.bizLine);
  assert.ok(lines.every((l) => l === 'membership' || l === 'all'));
  assert.strictEqual(out.length, 2);
});

test('业务线隔离：bizLine=all 的 PM 能看 trade 和 membership', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, allPM);
  assert.strictEqual(out.length, 2, 'bizLine=all 应能跨线看');
});

test('业务线隔离：admin 不受业务线限制，看全部', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'confidential', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, admin);
  assert.strictEqual(out.length, 2);
});

test('业务线隔离：reviewer 不受业务线限制，看全部', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'confidential', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, reviewer);
  assert.strictEqual(out.length, 2);
});

test('业务线隔离：guest(readonly) demo 用，看全部', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'confidential', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, guest);
  assert.strictEqual(out.length, 2);
});

test('业务线隔离：cs(客服) 按业务线过滤，cs.bizLine=all 时跨线', () => {
  const chunks = [
    makeChunk({ bizLine: 'trade', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'membership', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, csAgent);
  assert.strictEqual(out.length, 3, 'cs.bizLine=all 应能跨线（受密级限制）');
});

test('业务线隔离：cs(客服) 受密级限制，只能看 public', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'confidential', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, csAgent);
  assert.strictEqual(out.length, 1, 'cs 只能看 public');
  assert.strictEqual(out[0].securityLevel, 'public');
});

// ============================================================
// 2. permissionFilter 密级隔离
// ============================================================

test('密级隔离：guest 走 readonly 旁路，可浏览 internal（demo 便利，非密级豁免设计）', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, guest);
  // guest 走 readonly 旁路，看全部（demo 用）
  assert.strictEqual(out.length, 2);
});

test('密级隔离：cs 只能看 public，看不到 internal / confidential', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'confidential', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, csAgent);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].securityLevel, 'public');
});

test('密级隔离：产品经理（confidential）能看到 public + internal + confidential，看不到 secret', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'confidential', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'secret', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, tradePM);
  assert.strictEqual(out.length, 3, '产品经理不应看到 secret');
  const levels = out.map((c) => c.securityLevel);
  assert.ok(levels.includes('public') && levels.includes('internal') && levels.includes('confidential'));
  assert.ok(!levels.includes('secret'));
});

test('密级隔离：admin 能看 secret', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
    makeChunk({ bizLine: 'all', securityLevel: 'secret', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, admin);
  assert.strictEqual(out.length, 2);
});

test('密级隔离：reviewer 能看 secret', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'secret', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, reviewer);
  assert.strictEqual(out.length, 1);
});

// ============================================================
// 3. permissionFilter 状态过滤
// ============================================================

test('状态过滤：pending 文档不进 RAG 库', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'pending' }),
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, admin);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'approved');
});

test('状态过滤：rejected 文档不进 RAG 库', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'rejected' }),
    makeChunk({ bizLine: 'all', securityLevel: 'public', status: 'approved' }),
  ];
  const out = rag.permissionFilter(chunks, admin);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'approved');
});

test('状态过滤：chunk 无 status 字段时按合法通过（兼容旧数据）', () => {
  const chunks = [
    makeChunk({ bizLine: 'all', securityLevel: 'public' }), // status undefined
  ];
  const out = rag.permissionFilter(chunks, admin);
  assert.strictEqual(out.length, 1, '缺 status 字段不应误杀');
});

// ============================================================
// 4. retrieve 主流程
// ============================================================

test('retrieve：输入 user + query + index → 返回 topK chunks', () => {
  const chunks = [
    makeChunk({ id: 'a', content: '退款流程说明：用户提交退款申请后系统进入审核环节', bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'b', content: '会员积分规则：消费一元积一分，到期清零', bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'c', content: '物流配送时效：四十八小时内发货', bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
  ];
  const filtered = rag.permissionFilter(chunks, tradePM);
  const index = vs.buildIndex(filtered);
  const r = rag.retrieve(tradePM, '退款流程', index, 3);
  assert.ok(r.length > 0);
  // 召回结果中只应有 trade / all（permissionFilter 已过滤 membership）
  for (const item of r) {
    assert.ok(item.bizLine === 'trade' || item.bizLine === 'all', `越权命中: ${item.bizLine}`);
  }
});

test('retrieve：被过滤的 chunk 不会出现在结果中', () => {
  const chunks = [
    makeChunk({ id: 'trade_doc', content: '退款流程 trade 业务线', bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'member_doc', content: '退款流程 membership 业务线', bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const filtered = rag.permissionFilter(chunks, tradePM);
  const index = vs.buildIndex(filtered);
  const r = rag.retrieve(tradePM, '退款流程', index, 5);
  // 过滤后只剩 trade_doc，不应出现 member_doc
  assert.ok(r.every((x) => x.id !== 'member_doc'), 'membership 文档不应出现');
});

test('retrieve：按 rerank 分数降序', () => {
  const chunks = [
    makeChunk({ id: 'a', content: '退款退款退款退款退款', heading: '退款规则', keywords: ['退款', '流程'], bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'b', content: '完全无关的手机壳介绍', heading: '产品介绍', keywords: [], bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
  ];
  const filtered = rag.permissionFilter(chunks, tradePM);
  const index = vs.buildIndex(filtered);
  const r = rag.retrieve(tradePM, '退款', index, 2);
  assert.ok(r.length >= 1);
  assert.strictEqual(r[0].id, 'a', '退款相关文档应排第一');
});

test('retrieve：空索引返回空数组（不崩）', () => {
  const r = rag.retrieve(tradePM, '退款', { vocab: [], idfMap: {}, vectors: [] }, 5);
  assert.deepStrictEqual(r, []);
});

// —— 以下 4 个用例故意传「未过滤的全局索引」——
// 上面几个用例都是调用方先 permissionFilter 再 buildIndex，
// 这掩盖了 retrieve 自己不过滤也能通过测试的问题。
// 真实调用（第 9 步工作流）会把全局索引直接传进来，
// 所以这里必须锁住：retrieve 内部自己也要过滤。

test('retrieve：传未过滤的全局索引，仍不能跨业务线泄漏', () => {
  const chunks = [
    makeChunk({ id: 'trade_doc', content: '退款流程说明：交易线用户提交退款申请后进入审核', bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'member_doc', content: '退款流程说明：会员线用户提交退款申请后进入审核', bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const globalIndex = vs.buildIndex(chunks); // 注意：没有 permissionFilter
  const r = rag.retrieve(tradePM, '退款流程', globalIndex, 5);
  assert.ok(r.length > 0, '本业务线的文档应该能召回');
  assert.ok(r.every((x) => x.id !== 'member_doc'), '会员线文档不应泄漏给交易线 PM');
});

test('retrieve：传未过滤的全局索引，仍不能越级看高密级', () => {
  const chunks = [
    makeChunk({ id: 'pub', content: '退款政策公开说明，任何人可查阅的基础规则', bizLine: 'trade', securityLevel: 'public', status: 'approved' }),
    makeChunk({ id: 'secret', content: '退款政策绝密附录，仅限管理层查阅的风控阈值', bizLine: 'trade', securityLevel: 'secret', status: 'approved' }),
  ];
  const globalIndex = vs.buildIndex(chunks);
  const r = rag.retrieve(tradePM, '退款政策', globalIndex, 5);
  assert.ok(r.every((x) => x.id !== 'secret'), '绝密文档不应泄漏给普通 PM');
});

test('retrieve：传未过滤的全局索引，仍不能召回未审核文档', () => {
  const chunks = [
    makeChunk({ id: 'ok', content: '退款流程已审核通过的正式版本说明文档', bizLine: 'trade', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'draft', content: '退款流程还在草稿状态的待审核版本说明文档', bizLine: 'trade', securityLevel: 'internal', status: 'pending' }),
  ];
  const globalIndex = vs.buildIndex(chunks);
  const r = rag.retrieve(tradePM, '退款流程', globalIndex, 5);
  assert.ok(r.every((x) => x.id !== 'draft'), '未审核文档不应被检索到');
});

test('retrieve：用户可见范围为空时返回空数组（不是返回全部）', () => {
  const chunks = [
    makeChunk({ id: 'm1', content: '会员积分规则说明：消费一元积一分', bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
    makeChunk({ id: 'm2', content: '会员等级升降级规则说明文档', bizLine: 'membership', securityLevel: 'internal', status: 'approved' }),
  ];
  const globalIndex = vs.buildIndex(chunks);
  const r = rag.retrieve(tradePM, '会员积分', globalIndex, 5);
  assert.deepStrictEqual(r, [], '一条都看不到时应返回空，不能降级为不过滤');
});

// ============================================================
// 5. loadApprovedIndex
// ============================================================

// loadApprovedIndex 读的是 store 的 documents 表（data/documents.json）。
//
// 注意：不能直接覆盖真实的 data/documents.json 做夹具 ——
// `node --test` 会**并行**跑多个测试文件（各自独立进程），
// documents.test.js 同时也在读写这张表，互相覆盖会导致随机失败。
// 所以这里把 config.paths.data 临时指向一个本进程独占的目录，
// store.filePath() 每次调用都重读 config，因此改指针就能完全隔离。
function withDocuments(fakeData, fn) {
  const tmpDir = path.join(__dirname, `.tmp-rag-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'documents.json'), JSON.stringify(fakeData, null, 2), 'utf8');
    config.paths.data = tmpDir;
    store.clearCache();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test('loadApprovedIndex：从 store 的 documents 表读取（不是 chunks.json）', () => {
  const fakeData = [
    {
      id: 'doc_a', title: 'A', bizLine: 'trade', securityLevel: 'internal',
      status: 'approved',
      chunks: [
        { id: 'a_c1', content: '退款流程说明第一段内容', heading: '退款', keywords: ['退款', '流程'], fingerprint: 'fp_aa' },
      ],
    },
    {
      id: 'doc_b', title: 'B', bizLine: 'membership', securityLevel: 'public',
      status: 'pending',
      chunks: [
        { id: 'b_c1', content: '这条不应该被加载', heading: null, keywords: [], fingerprint: 'fp_bb' },
      ],
    },
  ];
  withDocuments(fakeData, () => {
    const { index, chunks, byDoc, byFingerprint } = rag.loadApprovedIndex();
    assert.ok(index, '应有 index');
    assert.ok(Array.isArray(chunks), 'chunks 应为数组');
    assert.strictEqual(chunks.length, 1, '只应加载 approved 的 1 个 chunk');
    assert.ok(chunks[0].id === 'a_c1');
    // byDoc 映射
    assert.ok(byDoc.doc_a, 'byDoc.doc_a 应存在');
    assert.strictEqual(byDoc.doc_a.length, 1);
    assert.ok(!byDoc.doc_b, 'pending 文档不应在 byDoc 中');
    // byFingerprint 映射
    assert.ok(byFingerprint.get('fp_aa'), 'byFingerprint 应能查到 fp_aa');
  });
});

test('loadApprovedIndex：chunk 继承所属文档的 业务线/密级/状态（权限过滤依赖这三个字段）', () => {
  const fakeData = [
    {
      id: 'doc_s', title: 'S', bizLine: 'membership', securityLevel: 'secret',
      status: 'approved',
      chunks: [{ id: 's_c1', content: '会员绝密资料正文', fingerprint: 'fp_ss' }],
    },
  ];
  withDocuments(fakeData, () => {
    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].bizLine, 'membership', 'chunk 应带上文档的业务线');
    assert.strictEqual(chunks[0].securityLevel, 'secret', 'chunk 应带上文档的密级');
    assert.strictEqual(chunks[0].status, 'approved', 'chunk 应带上文档的状态');
    assert.strictEqual(chunks[0].docId, 'doc_s', 'chunk 应能回溯到文档');
    // 交易线 PM 不该看到会员线绝密
    assert.deepStrictEqual(rag.permissionFilter(chunks, tradePM), []);
  });
});

test('loadApprovedIndex：documents 为空时返回的 index 也是合法的（search 不崩）', () => {
  withDocuments([], () => {
    const { index, chunks, byDoc, byFingerprint } = rag.loadApprovedIndex();
    assert.ok(index);
    assert.deepStrictEqual(chunks, []);
    assert.deepStrictEqual(byDoc, {});
    assert.ok(byFingerprint && byFingerprint.size === 0);
    // 验证 search 不崩
    const r = vs.search('任何关键词', index, 5);
    assert.deepStrictEqual(r, []);
  });
});

test('loadApprovedIndex：跳过未审核文档（pending/rejected）的 chunk', () => {
  const fakeData = [
    { id: 'd1', bizLine: 'trade', securityLevel: 'internal', status: 'pending',
      chunks: [{ id: 'd1c', content: '待审核的文档', fingerprint: 'fp_pending' }] },
    { id: 'd2', bizLine: 'trade', securityLevel: 'internal', status: 'rejected',
      chunks: [{ id: 'd2c', content: '被驳回的文档', fingerprint: 'fp_rejected' }] },
    { id: 'd3', bizLine: 'trade', securityLevel: 'internal', status: 'approved',
      chunks: [{ id: 'd3c', content: '已审核的文档', fingerprint: 'fp_approved' }] },
  ];
  withDocuments(fakeData, () => {
    const { chunks } = rag.loadApprovedIndex();
    assert.strictEqual(chunks.length, 1);
    assert.strictEqual(chunks[0].id, 'd3c');
  });
});

// ============================================================
// 6. 真实端到端回归（13 份模拟文档）
// ============================================================

function buildAllRealChunks() {
  // 把 13 份 mock 文档切成 chunks，注入 status=approved 与 docId
  const base = path.join(__dirname, '..', 'mock-data', 'documents');
  const allChunks = [];
  for (const line of fs.readdirSync(base)) {
    for (const file of fs.readdirSync(path.join(base, line))) {
      const raw = fs.readFileSync(path.join(base, line, file), 'utf8');
      const { chunks } = dp.processDocument(raw, { source: file });
      for (const c of chunks) {
        allChunks.push(Object.assign({}, c, { status: 'approved' }));
      }
    }
  }
  return allChunks;
}

function pipeline(user, query, rawChunks, topK) {
  const filtered = rag.permissionFilter(rawChunks, user);
  const index = vs.buildIndex(filtered);
  return rag.retrieve(user, query, index, topK || 5);
}

test('真实端到端：交易线 PM 搜"退款流程" → 命中 trade，无 membership', () => {
  const all = buildAllRealChunks();
  const r = pipeline(tradePM, '退款流程', all, 10);
  assert.ok(r.length > 0, '交易线 PM 搜退款应能召回');
  // 召回结果中应包含 trade 退款文档（refund-process.md）
  const fromTradeRefund = r.find((x) => x.source === 'refund-process.md');
  assert.ok(fromTradeRefund, `应命中 refund-process.md, 实际来源: ${r.map((x) => x.source).join(', ')}`);
  // 不应包含 membership 文档
  const fromMember = r.find((x) => x.source && /^(member|points|coupon)/.test(x.source));
  assert.ok(!fromMember, `交易线 PM 越权命中 membership: ${fromMember && fromMember.source}`);
});

test('真实端到端：会员线 PM 搜"退款流程" → 不命中（退款是 trade 业务）', () => {
  const all = buildAllRealChunks();
  const r = pipeline(memberPM, '退款流程', all, 10);
  // 会员线 PM 应看不到任何 trade 退款文档
  const fromTradeRefund = r.find((x) => x.source === 'refund-process.md');
  assert.ok(!fromTradeRefund, `会员线 PM 越权命中 trade 退款: ${fromTradeRefund && fromTradeRefund.content}`);
});

test('真实端到端：guest 搜"退款流程" → 不命中（trade 退款是 internal 级，guest 看到全部是 demo 旁路）', () => {
  // 注意：当前 spec 允许 guest (readonly) 看全部，但 cs (readonly=false) 只能看 public
  // 这里测 cs_agent 看到 refund 文档（refund-process.md 是 internal + trade）
  const all = buildAllRealChunks();
  const r = pipeline(csAgent, '退款流程', all, 10);
  // cs 受密级限制，trade 退款是 internal > public，应看不到
  const fromTradeRefund = r.find((x) => x.source === 'refund-process.md');
  assert.ok(!fromTradeRefund, `cs 应看不到 internal 级的 trade 退款文档`);
});

test('真实端到端：bizLine=all 的 PM 搜"退款流程" → 命中 trade 退款', () => {
  const all = buildAllRealChunks();
  const r = pipeline(allPM, '退款流程', all, 10);
  const fromTradeRefund = r.find((x) => x.source === 'refund-process.md');
  assert.ok(fromTradeRefund, `bizLine=all PM 应能跨线命中 trade 退款`);
});

test('真实端到端：admin 搜"退款流程" → 命中 trade 退款', () => {
  const all = buildAllRealChunks();
  const r = pipeline(admin, '退款流程', all, 10);
  const fromTradeRefund = r.find((x) => x.source === 'refund-process.md');
  assert.ok(fromTradeRefund, `admin 应能命中 trade 退款`);
});

test('真实端到端：会员线 PM 搜"会员积分" → 命中 membership 文档', () => {
  const all = buildAllRealChunks();
  const r = pipeline(memberPM, '会员积分', all, 10);
  assert.ok(r.length > 0);
  const fromMember = r.find((x) => x.source && /member|points/.test(x.source));
  assert.ok(fromMember, `会员线 PM 搜"会员积分"应命中 membership 文档, 实际: ${r.map((x) => x.source).join(', ')}`);
});
