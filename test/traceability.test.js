/**
 * 逐层溯源与影响预览测试 —— 第 8 步
 *
 * 覆盖（对应《技术方案-四层模型.md》第 6、9 节）：
 *   1. traceUp   —— 从向量一路走到原始文档，原始文档再往上是 null
 *   2. traceDown —— 向下展开一层，向量层为空
 *   3. breadcrumb—— 任意层都能拿到从 raw 起的完整路径
 *   4. fullChain —— 从中间层同时拿到上游单条记录与下游数组
 *   5. impactOf  —— 影响面计数；引用统计表不存在时优雅降级（不抛错）
 *   6. findOrphans —— 孤儿检测
 *
 * 测试隔离同 knowledge-layers.test.js：临时把 config.paths.data 指向
 * 本进程独占目录，避免并行测试互相覆盖真实 data/*.json。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const trace = require('../lib/traceability');

// ============================================================
// 隔离夹具
// ============================================================

/**
 * 同 knowledge-layers.test.js：隔离靠临时改全局 config.paths.data 实现，
 * 所以**本文件所有用例必须保持同步执行**。改成 async 或开 concurrency，
 * 两个用例的夹具就会交错，隔离静默失效（随机失败，或更糟的随机通过）。
 *
 * 临时目录必须放 os.tmpdir()，不能放 test/ 下 —— `npm test` 扫的是
 * test 目录下的 *.test.js，残留的临时目录会被当成测试文件。
 */
function withLayers(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-trace-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    return fn();
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 写入检索快照表（第 14 步才真正产生，这里手工造用于验证统计逻辑） */
function writeSnapshots(rows) {
  fs.writeFileSync(
    path.join(config.paths.data, 'retrieval_snapshots.json'),
    JSON.stringify(rows, null, 2), 'utf8'
  );
  store.clearCache();
}

function seedTree(opts = {}) {
  const raw = kl.createRaw({
    title: opts.title || '退款流程规范',
    fileName: opts.fileName || 'refund.md',
    fileType: 'md',
    content: '# 退款流程\n\n用户提交退款申请后进入审核环节。',
    knowledgeType: 'business_rule',
    bizLine: 'trade',
    securityLevel: 'internal',
    uploadedBy: 'admin',
  });
  const std = kl.createStdVersion(raw.id, { content: '标准化后的退款流程全文' });
  const chunks = kl.createChunks(std.id, [
    { content: '片段一：用户提交退款申请后系统进入审核环节。', heading: '退款受理', sectionPath: ['3. 退款流程'] },
    { content: '片段二：审核时效为四十八小时内给出结论。', heading: '审核时效', sectionPath: ['3. 退款流程', '3.2 审核时效'] },
  ]);
  const vectors = [];
  for (const c of chunks) {
    vectors.push(kl.createVector(c.id, { model: 'tfidf-v1', dim: 2, vec: [1, 0], indexName: 'main' }));
  }
  return { raw, std, chunks, vectors };
}

function publish(stdId) {
  kl.setStdStatus(stdId, kl.STD_STATUS.PENDING);
  kl.setStdStatus(stdId, kl.STD_STATUS.APPROVED);
  return kl.publishStd(stdId);
}

// ============================================================
// 1. traceUp
// ============================================================

test('traceUp：从向量逐层向上到原始文档，raw 再往上是 null', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();

    const up1 = trace.traceUp('vector', vectors[0].id);
    assert.strictEqual(up1.layer, 'chunk');
    assert.strictEqual(up1.record.id, chunks[0].id);

    const up2 = trace.traceUp('chunk', up1.record.id);
    assert.strictEqual(up2.layer, 'std');
    assert.strictEqual(up2.record.id, std.id);

    const up3 = trace.traceUp('std', up2.record.id);
    assert.strictEqual(up3.layer, 'raw');
    assert.strictEqual(up3.record.id, raw.id);

    assert.strictEqual(trace.traceUp('raw', raw.id), null, '原始文档已是顶层');
  });
});

test('traceUp：id 不存在返回 null；层名非法抛 400', () => {
  withLayers(() => {
    seedTree();
    assert.strictEqual(trace.traceUp('vector', 'vec_999'), null);
    assert.strictEqual(trace.traceUp('chunk', 'chk_999'), null);
    assert.throws(() => trace.traceUp('nosuchlayer', 'x'), (e) => e.status === 400);
  });
});

// ============================================================
// 2. traceDown
// ============================================================

test('traceDown：向下展开一层，向量层返回空数组', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();

    const d1 = trace.traceDown('raw', raw.id);
    assert.strictEqual(d1.layer, 'std');
    assert.deepStrictEqual(d1.records.map((r) => r.id), [std.id]);

    const d2 = trace.traceDown('std', std.id);
    assert.strictEqual(d2.layer, 'chunk');
    assert.deepStrictEqual(d2.records.map((r) => r.id), chunks.map((c) => c.id));

    const d3 = trace.traceDown('chunk', chunks[0].id);
    assert.strictEqual(d3.layer, 'vector');
    assert.deepStrictEqual(d3.records.map((r) => r.id), [vectors[0].id]);

    const d4 = trace.traceDown('vector', vectors[0].id);
    assert.deepStrictEqual(d4.records, [], '向量已是最底层');
  });
});

// ============================================================
// 3. breadcrumb
// ============================================================

test('breadcrumb：从向量层拿到 raw→std→chunk→vector 完整四段路径', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    const crumbs = trace.breadcrumb('vector', vectors[1].id);
    assert.deepStrictEqual(crumbs.map((c) => c.layer), ['raw', 'std', 'chunk', 'vector']);
    assert.deepStrictEqual(crumbs.map((c) => c.id), [raw.id, std.id, chunks[1].id, vectors[1].id]);
    // 四层 label 逐个断言真实内容 —— 只断言"非空字符串"等于没验证
    assert.deepStrictEqual(crumbs.map((c) => c.label), [
      '退款流程规范',            // raw：标题
      '加工版本 v1',             // std：加工版本号（此时未生效，不带后缀）
      '片段 #2 审核时效',        // chunk：序号 + 小节标题
      '向量 tfidf-v1（生效中）', // vector：模型名 + 生效标记
    ]);
  });
});

test('breadcrumb：std 生效后 label 带「生效中」标记', () => {
  withLayers(() => {
    const { std } = seedTree();
    publish(std.id);
    const crumbs = trace.breadcrumb('std', std.id);
    assert.strictEqual(crumbs[1].label, '加工版本 v1（生效中）');
  });
});

test('breadcrumb：从中间层与顶层都能拿到正确长度的路径', () => {
  withLayers(() => {
    const { raw, std, chunks } = seedTree();
    assert.strictEqual(trace.breadcrumb('raw', raw.id).length, 1);
    assert.strictEqual(trace.breadcrumb('std', std.id).length, 2);
    assert.strictEqual(trace.breadcrumb('chunk', chunks[0].id).length, 3);
    assert.deepStrictEqual(trace.breadcrumb('chunk', 'chk_999'), [], '不存在的 id 返回空路径');
  });
});

// ============================================================
// 4. fullChain
// ============================================================

test('fullChain：从片段层同时拿到上游 raw/std 与下游 vectors', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    // 同一片段再加一个模型的向量，确认下游是数组
    const extra = kl.createVector(chunks[0].id, { model: 'bge-small', vec: [0, 1] });

    const chain = trace.fullChain('chunk', chunks[0].id);
    assert.strictEqual(chain.raw.id, raw.id);
    assert.strictEqual(chain.std.id, std.id);
    assert.strictEqual(chain.chunk.id, chunks[0].id);
    assert.ok(Array.isArray(chain.vector), '下游向量应是数组');
    const ids = chain.vector.map((v) => v.id).sort();
    assert.deepStrictEqual(ids, [vectors[0].id, extra.id].sort());
  });
});

test('fullChain：从原始文档层，std/chunk/vector 三层全是数组', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    const chain = trace.fullChain('raw', raw.id);
    assert.strictEqual(chain.raw.id, raw.id);
    assert.deepStrictEqual(chain.std.map((s) => s.id), [std.id]);
    assert.deepStrictEqual(chain.chunk.map((c) => c.id).sort(), chunks.map((c) => c.id).sort());
    assert.deepStrictEqual(chain.vector.map((v) => v.id).sort(), vectors.map((v) => v.id).sort());
  });
});

test('fullChain：从向量层四层都是单条记录', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    const chain = trace.fullChain('vector', vectors[0].id);
    assert.strictEqual(chain.raw.id, raw.id);
    assert.strictEqual(chain.std.id, std.id);
    assert.strictEqual(chain.chunk.id, chunks[0].id);
    assert.strictEqual(chain.vector.id, vectors[0].id);
  });
});

test('fullChain：从标准化层，上游单条、下游数组', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    const chain = trace.fullChain('std', std.id);
    assert.strictEqual(chain.raw.id, raw.id);
    assert.strictEqual(chain.std.id, std.id);
    assert.strictEqual(chain.chunk.length, chunks.length);
    assert.strictEqual(chain.vector.length, vectors.length);
  });
});

test('fullChain：id 不存在时四层全 null，不抛错', () => {
  withLayers(() => {
    const chain = trace.fullChain('chunk', 'chk_999');
    assert.deepStrictEqual(chain, { raw: null, std: null, chunk: null, vector: null });
  });
});

// ============================================================
// 5. impactOf —— 影响预览
// ============================================================

test('impactOf：删除原始文档时的影响面计数与实际建的数量一致', () => {
  withLayers(() => {
    const raw = kl.createRaw({
      title: 'A', content: 'x', bizLine: 'trade', securityLevel: 'public', uploadedBy: 'admin',
    });
    let chunkTotal = 0;
    let vecTotal = 0;
    for (let i = 0; i < 2; i++) {
      const std = kl.createStdVersion(raw.id, { content: `v${i}` });
      const chunks = kl.createChunks(std.id, [
        { content: `第 ${i} 版第一段正文内容足够长以便入库。` },
        { content: `第 ${i} 版第二段正文内容足够长以便入库。` },
      ]);
      chunkTotal += chunks.length;
      for (const c of chunks) {
        kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] });
        vecTotal += 1;
      }
    }

    const impact = trace.impactOf('delete', 'raw', raw.id);
    assert.strictEqual(impact.action, 'delete');
    assert.strictEqual(impact.targetLayer, 'raw');
    assert.strictEqual(impact.targetId, raw.id);
    assert.strictEqual(impact.destructive, true);
    assert.strictEqual(impact.stdCount, 2);
    assert.strictEqual(impact.chunkCount, chunkTotal);
    assert.strictEqual(impact.vectorCount, vecTotal);

    // 预览的计数应与真实级联删除结果一致 —— 否则预览没有意义
    const counts = kl.deleteRawCascade(raw.id);
    assert.strictEqual(counts.stdCount, impact.stdCount);
    assert.strictEqual(counts.chunkCount, impact.chunkCount);
    assert.strictEqual(counts.vectorCount, impact.vectorCount);
  });
});

test('impactOf：重新加工不是破坏性操作，只统计当前生效版本', () => {
  withLayers(() => {
    const { raw, std, chunks } = seedTree();
    publish(std.id);
    // 再加一个未发布的历史草稿版本，它不该被算进"重新加工"的影响面
    const draft = kl.createStdVersion(raw.id, { content: 'draft' });
    kl.createChunks(draft.id, [{ content: '草稿版本的片段正文内容足够长。' }]);

    const impact = trace.impactOf('reprocess', 'raw', raw.id);
    assert.strictEqual(impact.destructive, false, '重新加工产生新版本，不销毁数据');
    assert.strictEqual(impact.stdCount, 1, '只统计当前生效版本');
    assert.strictEqual(impact.chunkCount, chunks.length);
    assert.strictEqual(impact.vectorCount, chunks.length);
  });
});

test('impactOf：归档标准化版本是破坏性操作，统计自身与下游两层', () => {
  withLayers(() => {
    const { std, chunks, vectors } = seedTree();
    publish(std.id);
    const impact = trace.impactOf('archive', 'std', std.id);
    assert.strictEqual(impact.destructive, true);
    assert.strictEqual(impact.stdCount, 1);
    assert.strictEqual(impact.chunkCount, chunks.length);
    assert.strictEqual(impact.vectorCount, vectors.length);
    assert.ok(impact.warnings.some((w) => w.includes('检索')), '应提示这些内容将退出检索');
  });
});

test('impactOf：片段层与向量层的影响面只算自己往下', () => {
  withLayers(() => {
    const { chunks, vectors } = seedTree();
    kl.createVector(chunks[0].id, { model: 'bge-small', vec: [0, 1] });

    const c = trace.impactOf('delete', 'chunk', chunks[0].id);
    assert.strictEqual(c.stdCount, 0);
    assert.strictEqual(c.chunkCount, 1);
    assert.strictEqual(c.vectorCount, 2);

    const v = trace.impactOf('delete', 'vector', vectors[0].id);
    assert.strictEqual(v.stdCount, 0);
    assert.strictEqual(v.chunkCount, 0);
    assert.strictEqual(v.vectorCount, 1);
  });
});

test('impactOf 优雅降级：retrieval_snapshots 表不存在时引用数为 0 且不抛错', () => {
  withLayers(() => {
    const { raw } = seedTree();
    // 明确断言：第 8 步这张表确实还不存在
    assert.ok(!fs.existsSync(path.join(config.paths.data, 'retrieval_snapshots.json')));

    let impact;
    assert.doesNotThrow(() => { impact = trace.impactOf('delete', 'raw', raw.id); },
      '引用统计表不存在不能让影响预览崩掉');
    assert.strictEqual(impact.citedChunkCount, 0);
    assert.strictEqual(impact.citationCount, 0);
    assert.strictEqual(typeof impact.recentDays, 'number');
    assert.ok(Array.isArray(impact.warnings));
    assert.ok(impact.warnings.some((w) => w.includes('引用统计')),
      `warnings 应提示引用统计不可用，实际: ${JSON.stringify(impact.warnings)}`);
  });
});

test('impactOf 优雅降级：retrieval_snapshots 表存在但为空时同样返回 0 并给出警告', () => {
  withLayers(() => {
    const { raw } = seedTree();
    writeSnapshots([]);
    const impact = trace.impactOf('delete', 'raw', raw.id);
    assert.strictEqual(impact.citedChunkCount, 0);
    assert.strictEqual(impact.citationCount, 0);
    // 契约第 6 节：表不存在**或为空**时都要给"暂不可用"的提示。
    // 空表和"确实一次都没被引用过"在第 8 步无法区分，报不可用才不会误导删除决策。
    assert.ok(impact.warnings.some((w) => w.includes('引用统计数据暂不可用')),
      `空表也必须提示引用统计不可用，实际: ${JSON.stringify(impact.warnings)}`);
  });
});

test('impactOf：recentDays 默认 7 天（与需求文档「过去 7 天被引用 45 次」对齐）', () => {
  withLayers(() => {
    const { raw, chunks } = seedTree();
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    writeSnapshots([
      { id: 'snap_001', at: new Date(now - 3 * day).toISOString(), chunkIds: [chunks[0].id] },
      { id: 'snap_002', at: new Date(now - 20 * day).toISOString(), chunkIds: [chunks[1].id] }, // 7 天窗口外
    ]);
    const impact = trace.impactOf('delete', 'raw', raw.id);
    assert.strictEqual(impact.recentDays, 7);
    assert.strictEqual(impact.citationCount, 1, '默认窗口是 7 天，20 天前那次不该算进来');
    assert.strictEqual(impact.citedChunkCount, 1);
  });
});

test('impactOf：recentDays 传 0 / 负数 / 非数字一律抛 400（不能静默变默认值或把窗口甩到未来）', () => {
  withLayers(() => {
    const { raw } = seedTree();
    for (const bad of [0, -1, -30, 'abc', NaN, Infinity, {}]) {
      assert.throws(
        () => trace.impactOf('delete', 'raw', raw.id, { recentDays: bad }),
        (e) => e.status === 400,
        `recentDays=${JSON.stringify(bad)} 应抛 400`
      );
    }
    // 不传或显式 undefined / null 走默认值
    assert.strictEqual(trace.impactOf('delete', 'raw', raw.id, {}).recentDays, 7);
    assert.strictEqual(trace.impactOf('delete', 'raw', raw.id, { recentDays: undefined }).recentDays, 7);
  });
});

test('impactOf：同一条快照里重复出现的片段 id 只算一次引用', () => {
  withLayers(() => {
    const { raw, chunks } = seedTree();
    const at = new Date().toISOString();
    writeSnapshots([
      // 同一条快照同时用了三种写法指向同一个片段 —— 定义上这只是"1 次引用"
      {
        id: 'snap_001',
        at,
        chunkIds: [chunks[0].id, chunks[0].id],
        citedChunkIds: [chunks[0].id],
        citations: [{ chunkId: chunks[0].id }],
      },
      { id: 'snap_002', at, chunkIds: [chunks[0].id, chunks[1].id] },
    ]);
    const impact = trace.impactOf('delete', 'raw', raw.id);
    assert.strictEqual(impact.citedChunkCount, 2);
    assert.strictEqual(impact.citationCount, 3, '引用次数 = 快照条数 × 命中片段（每条快照内先去重）');
  });
});

test('impactOf：引用统计表可用时按时间窗口统计被引用片段数与引用次数', () => {
  withLayers(() => {
    const { raw, chunks } = seedTree();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    writeSnapshots([
      { id: 'snap_001', at: new Date(now - 1 * day).toISOString(), chunkIds: [chunks[0].id] },
      { id: 'snap_002', at: new Date(now - 2 * day).toISOString(), chunkIds: [chunks[0].id, chunks[1].id] },
      { id: 'snap_003', at: new Date(now - 90 * day).toISOString(), chunkIds: [chunks[1].id] }, // 超出窗口
      { id: 'snap_004', at: new Date(now - 3 * day).toISOString(), chunkIds: ['chk_other'] },   // 与本次无关
    ]);

    const impact = trace.impactOf('delete', 'raw', raw.id, { recentDays: 30 });
    assert.strictEqual(impact.recentDays, 30);
    assert.strictEqual(impact.citedChunkCount, 2, '窗口内被引用过的片段数');
    assert.strictEqual(impact.citationCount, 3, '窗口内引用总次数');
    assert.ok(!impact.warnings.some((w) => w.includes('引用统计数据暂不可用')));

    // 窗口收窄后只剩 1 天内那一次
    const narrow = trace.impactOf('delete', 'raw', raw.id, { recentDays: 1.5 });
    assert.strictEqual(narrow.citedChunkCount, 1);
    assert.strictEqual(narrow.citationCount, 1);
  });
});

test('impactOf：非法 action 抛 400，目标不存在抛 404', () => {
  withLayers(() => {
    const { raw } = seedTree();
    assert.throws(() => trace.impactOf('nuke', 'raw', raw.id), (e) => e.status === 400);
    assert.throws(() => trace.impactOf('delete', 'raw', 'raw_999'), (e) => e.status === 404);
    assert.throws(() => trace.impactOf('delete', 'nosuchlayer', 'x'), (e) => e.status === 400);
  });
});

// ============================================================
// 6. findOrphans
// ============================================================

test('findOrphans：干净的库没有孤儿', () => {
  withLayers(() => {
    seedTree();
    assert.deepStrictEqual(trace.findOrphans(), []);
  });
});

test('findOrphans：检出指向不存在上层的 std / chunk / vector', () => {
  withLayers(() => {
    const { std, chunks, vectors } = seedTree();

    const stds = store.read('std_documents', []);
    stds.push({ ...std, id: 'std_900', rawId: 'raw_missing' });
    store.write('std_documents', stds);

    const cs = store.read('chunks', []);
    cs.push({ ...chunks[0], id: 'chk_900', stdId: 'std_missing' });
    store.write('chunks', cs);

    const vs = store.read('vectors', []);
    vs.push({ ...vectors[0], id: 'vec_900', chunkId: 'chk_missing', isCurrent: false });
    store.write('vectors', vs);

    const orphans = trace.findOrphans();
    const byId = {};
    for (const o of orphans) byId[o.id] = o;
    assert.ok(byId.std_900, '应检出孤儿 std');
    assert.strictEqual(byId.std_900.layer, 'std');
    assert.strictEqual(byId.std_900.missingLayer, 'raw');
    assert.strictEqual(byId.std_900.missingId, 'raw_missing');
    assert.ok(byId.chk_900, '应检出孤儿 chunk');
    assert.ok(byId.vec_900, '应检出孤儿 vector');
    // 溯源在孤儿上不应抛错，只是断链
    assert.strictEqual(trace.traceUp('chunk', 'chk_900'), null);
    assert.deepStrictEqual(trace.breadcrumb('chunk', 'chk_900'), []);
  });
});

test('findOrphans：vector 的冗余 stdId / rawId 失效也算孤儿（契约 3.5 说这两个字段就是给跨层查询用的）', () => {
  withLayers(() => {
    const { vectors } = seedTree();
    // chunkId 完好，只把两个冗余字段指向不存在的记录 ——
    // 以前这种向量报不出来，跨层查询（按 rawId 找向量）会静默查空
    const vs = store.read('vectors', []);
    const target = vs.find((v) => v.id === vectors[0].id);
    target.stdId = 'std_missing';
    target.rawId = 'raw_missing';
    store.write('vectors', vs);

    const orphans = trace.findOrphans().filter((o) => o.id === vectors[0].id);
    assert.ok(orphans.length >= 1, '冗余 stdId / rawId 失效必须被检出');
    const missing = orphans.map((o) => o.missingLayer);
    assert.ok(missing.includes('std') || missing.includes('raw'), `实际: ${JSON.stringify(orphans)}`);
    const codes = kl.checkInvariants().map((v) => v.code);
    assert.ok(codes.includes('I5'), 'checkInvariants 也要跟着报 I5');
  });
});

test('findOrphans：chunk 层与 vector 层对称 —— 两层都同时检查上层 ID 与冗余 ID', () => {
  withLayers(() => {
    const { chunks, vectors } = seedTree();
    const cs = store.read('chunks', []);
    cs.find((c) => c.id === chunks[1].id).rawId = 'raw_missing';
    store.write('chunks', cs);
    const vs = store.read('vectors', []);
    vs.find((v) => v.id === vectors[1].id).rawId = 'raw_missing';
    store.write('vectors', vs);

    const ids = trace.findOrphans().map((o) => o.id);
    assert.ok(ids.includes(chunks[1].id), 'chunk 的冗余 rawId 断了要报');
    assert.ok(ids.includes(vectors[1].id), 'vector 的冗余 rawId 断了同样要报');
  });
});
