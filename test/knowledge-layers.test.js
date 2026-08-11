/**
 * 四层知识模型测试 —— 第 8 步
 *
 * 覆盖（对应《技术方案-四层模型.md》第 9 节）：
 *   1. 第一层 raw_documents 的创建与解析状态
 *   2. 第二层 std_documents 的版本号、参数快照
 *   3. 不变量 I1 —— 同 raw 下只有一个生效版本
 *   4. 不变量 I2 —— 同 chunk + 同 model 下只有一份生效向量
 *   5. 不变量 I3/I4 —— 权限判据字段强制从上层继承，调用方传入一律忽略
 *   6. 不变量 I5 —— 无孤儿记录（级联删除）
 *   7. 不变量 I6 —— 只有 published / need_review 且生效的向量参与检索
 *   8. 状态机 —— 全部合法流转通过、全部非法流转拒绝（409）
 *   9. 级联同步 —— 发布 / 归档 / 转复审时下游两层跟随
 *
 * 测试隔离：
 *   `node --test` 并行跑多个测试文件（各自独立进程），
 *   若直接读写真实 data/*.json 会互相覆盖导致随机失败。
 *   因此把 config.paths.data 临时指向本进程独占目录 ——
 *   store.filePath() 每次调用都重读 config，改指针即完全隔离。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');

// ============================================================
// 隔离夹具
// ============================================================

/**
 * 隔离靠"临时改全局 config.paths.data"实现，因此：
 *
 *   **本文件所有用例必须保持同步执行。**
 *   一旦某个用例改成 async / 用 await，或给测试运行器开 concurrency，
 *   两个用例的 withLayers 就会交错，后进入的那个会把 config.paths.data
 *   改到自己的目录，前一个用例剩下的断言于是读到别人的库 ——
 *   隔离静默失效，表现为随机失败或更糟的"随机通过"。
 *
 * 临时目录放在 os.tmpdir()：不能放在 test/ 下面，
 * `npm test` 的 glob 是 test/**\/*.test.js，临时目录残留会被当成测试文件扫。
 */
function withLayers(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-kl-${process.pid}`);
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

/** 造一个原始文档 */
function seedRaw(over = {}) {
  return kl.createRaw({
    title: '退款流程规范',
    fileName: 'refund.md',
    fileType: 'md',
    fileSize: 1234,
    content: '# 退款流程\n\n用户提交退款申请后进入审核环节。',
    knowledgeType: 'business_rule',
    version: 'v1.2',
    tags: ['退款'],
    owner: 'pm_zhang',
    uploadedBy: 'admin',
    bizLine: 'trade',
    securityLevel: 'confidential',
    ...over,
  });
}

/** 造一条完整四层链：raw → std → 2 chunks → 2 vectors */
function seedTree(over = {}) {
  const raw = seedRaw(over.raw);
  const std = kl.createStdVersion(raw.id, { content: '标准化后的退款流程全文', ...over.std });
  const chunks = kl.createChunks(std.id, over.chunks || [
    { content: '片段一：用户提交退款申请后系统进入审核环节。', heading: '退款' },
    { content: '片段二：审核时效为四十八小时内给出结论。', heading: '时效' },
  ]);
  const vectors = chunks.map((c) => kl.createVector(c.id, {
    model: 'tfidf-v1', dim: 2, vec: [0.1, 0.9], indexName: 'main',
  }));
  return { raw, std, chunks, vectors };
}

/** 把 std 推到指定状态（沿合法路径） */
function driveStdTo(stdId, target) {
  const S = kl.STD_STATUS;
  switch (target) {
    case S.DRAFT: return kl.getStd(stdId);
    case S.QC_FAILED: return kl.setStdStatus(stdId, S.QC_FAILED);
    case S.PENDING: return kl.setStdStatus(stdId, S.PENDING);
    case S.REJECTED:
      kl.setStdStatus(stdId, S.PENDING);
      return kl.setStdStatus(stdId, S.REJECTED);
    case S.APPROVED:
      kl.setStdStatus(stdId, S.PENDING);
      return kl.setStdStatus(stdId, S.APPROVED);
    case S.PUBLISHED:
      kl.setStdStatus(stdId, S.PENDING);
      kl.setStdStatus(stdId, S.APPROVED);
      return kl.publishStd(stdId);
    case S.NEED_REVIEW:
      kl.setStdStatus(stdId, S.PENDING);
      kl.setStdStatus(stdId, S.APPROVED);
      kl.publishStd(stdId);
      return kl.markNeedReview(stdId);
    case S.ARCHIVED:
      kl.setStdStatus(stdId, S.PENDING);
      kl.setStdStatus(stdId, S.APPROVED);
      return kl.archiveStd(stdId);
    default:
      throw new Error(`未知目标状态: ${target}`);
  }
}

// ============================================================
// 1. 第一层 raw_documents
// ============================================================

test('第一层：createRaw 写入全部字段，初始状态 uploaded，id 带 raw_ 前缀', () => {
  withLayers(() => {
    const raw = seedRaw();
    assert.ok(/^raw_\d+$/.test(raw.id), `id 前缀不对: ${raw.id}`);
    assert.strictEqual(raw.status, kl.RAW_STATUS.UPLOADED);
    assert.strictEqual(raw.bizLine, 'trade');
    assert.strictEqual(raw.securityLevel, 'confidential');
    assert.strictEqual(raw.knowledgeType, 'business_rule');
    assert.strictEqual(raw.version, 'v1.2');
    assert.strictEqual(raw.owner, 'pm_zhang');
    assert.strictEqual(raw.currentStdId, null);
    assert.strictEqual(raw.parseError, null);
    assert.ok(raw.content.includes('退款'), '原文必须保留，否则无法重新加工');
    assert.ok(raw.createdAt && raw.updatedAt);
  });
});

test('第一层：createRaw 校验业务线 / 密级 / 知识类型白名单', () => {
  withLayers(() => {
    assert.throws(() => seedRaw({ bizLine: 'nosuchline' }), /业务线/);
    assert.throws(() => seedRaw({ securityLevel: 'topsecret' }), /安全分级|密级/);
    assert.throws(() => seedRaw({ knowledgeType: 'gossip' }), /知识类型/);
    assert.throws(() => kl.createRaw({ bizLine: 'trade', securityLevel: 'public' }), /内容/);
  });
});

test('第一层：knowledgeType 缺省为 other', () => {
  withLayers(() => {
    const raw = seedRaw({ knowledgeType: undefined });
    assert.strictEqual(raw.knowledgeType, 'other');
  });
});

test('第一层：markParseFailed 记录原因，markReady 清空原因', () => {
  withLayers(() => {
    const raw = seedRaw();
    const failed = kl.markParseFailed(raw.id, 'PDF 加密无法解析');
    assert.strictEqual(failed.status, kl.RAW_STATUS.PARSE_FAILED);
    assert.strictEqual(failed.parseError, 'PDF 加密无法解析');

    const ready = kl.markReady(raw.id);
    assert.strictEqual(ready.status, kl.RAW_STATUS.READY);
    assert.strictEqual(ready.parseError, null);
  });
});

test('第一层：getRaw 不存在返回 null；markReady 不存在抛 404', () => {
  withLayers(() => {
    assert.strictEqual(kl.getRaw('raw_999'), null);
    assert.throws(() => kl.markReady('raw_999'), (e) => e.status === 404);
  });
});

// ============================================================
// 2. 第二层 std_documents
// ============================================================

test('第二层：createStdVersion 的 procVersion 同 raw 下从 1 递增，初始 draft 且不生效', () => {
  withLayers(() => {
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, { content: 'A' });
    const v2 = kl.createStdVersion(raw.id, { content: 'B' });
    const v3 = kl.createStdVersion(raw.id, { content: 'C' });
    assert.deepStrictEqual([v1.procVersion, v2.procVersion, v3.procVersion], [1, 2, 3]);
    for (const v of [v1, v2, v3]) {
      assert.strictEqual(v.status, kl.STD_STATUS.DRAFT);
      assert.strictEqual(v.isCurrent, false, '草稿不能生效');
      assert.strictEqual(v.rawId, raw.id);
      assert.ok(/^std_\d+$/.test(v.id));
    }
  });
});

test('第二层：procVersion 按 raw 各自独立编号', () => {
  withLayers(() => {
    const r1 = seedRaw();
    const r2 = seedRaw({ fileName: 'other.md' });
    kl.createStdVersion(r1.id, {});
    kl.createStdVersion(r1.id, {});
    const b1 = kl.createStdVersion(r2.id, {});
    assert.strictEqual(b1.procVersion, 1, '另一个 raw 应从 1 开始');
  });
});

test('第二层：params 默认取 config.processing 快照，input.params 可覆盖（cleanLevel 深合并）', () => {
  withLayers(() => {
    const raw = seedRaw();
    const def = kl.createStdVersion(raw.id, {});
    assert.strictEqual(def.params.splitMode, config.processing.splitMode);
    assert.strictEqual(def.params.prependHeading, config.processing.prependHeading);
    assert.strictEqual(def.params.cleanLevel.stripRevision, config.processing.cleanLevel.stripRevision);

    const custom = kl.createStdVersion(raw.id, {
      params: { splitMode: 'fixed', fixedSize: 200, cleanLevel: { mergeShortParagraphs: true } },
    });
    assert.strictEqual(custom.params.splitMode, 'fixed');
    assert.strictEqual(custom.params.fixedSize, 200);
    assert.strictEqual(custom.params.cleanLevel.mergeShortParagraphs, true);
    assert.strictEqual(custom.params.cleanLevel.stripRevision, config.processing.cleanLevel.stripRevision,
      'cleanLevel 未覆盖的项应保留默认值');
    // 快照独立：改 config 不应影响已存快照
    assert.notStrictEqual(custom.params.cleanLevel, config.processing.cleanLevel);
  });
});

test('第二层：createStdVersion 的 raw 不存在抛 404；listStdByRaw 按 procVersion 降序', () => {
  withLayers(() => {
    assert.throws(() => kl.createStdVersion('raw_999', {}), (e) => e.status === 404);
    const raw = seedRaw();
    kl.createStdVersion(raw.id, {});
    kl.createStdVersion(raw.id, {});
    kl.createStdVersion(raw.id, {});
    const list = kl.listStdByRaw(raw.id);
    assert.deepStrictEqual(list.map((s) => s.procVersion), [3, 2, 1]);
    assert.strictEqual(kl.getStd('std_999'), null);
  });
});

// ============================================================
// 3. 不变量 I1 —— 同 raw 下只有一个生效版本
// ============================================================

test('I1：连续建 3 个 std 版本后发布第 2 个，同 raw 下 isCurrent 恰好 1 条', () => {
  withLayers(() => {
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, { content: 'v1' });
    const v2 = kl.createStdVersion(raw.id, { content: 'v2' });
    const v3 = kl.createStdVersion(raw.id, { content: 'v3' });

    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);

    const list = kl.listStdByRaw(raw.id);
    const currents = list.filter((s) => s.isCurrent);
    assert.strictEqual(currents.length, 1, `isCurrent 的 std 应恰好 1 条，实际 ${currents.length}`);
    assert.strictEqual(currents[0].id, v2.id);
    assert.strictEqual(kl.getStd(v1.id).isCurrent, false);
    assert.strictEqual(kl.getStd(v3.id).isCurrent, false);
    assert.strictEqual(kl.getStd(v2.id).status, kl.STD_STATUS.PUBLISHED);
    assert.ok(kl.getStd(v2.id).publishedAt, 'publishedAt 应写入');
    assert.strictEqual(kl.getRaw(raw.id).currentStdId, v2.id, 'raw.currentStdId 应指向生效版本');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I1：发布新版本时旧的已发布版本自动归档，且其下游 chunks/vectors 同步归档', () => {
  withLayers(() => {
    const raw = seedRaw();
    // v1：发布并带下游数据
    const v1 = kl.createStdVersion(raw.id, { content: 'v1' });
    const v1Chunks = kl.createChunks(v1.id, [{ content: 'v1 的第一段内容，足够长以便入库。' }]);
    const v1Vectors = v1Chunks.map((c) => kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] }));
    driveStdTo(v1.id, kl.STD_STATUS.PUBLISHED);
    assert.strictEqual(kl.getChunk(v1Chunks[0].id).status, kl.STD_STATUS.PUBLISHED);

    // v2：发布
    const v2 = kl.createStdVersion(raw.id, { content: 'v2' });
    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);

    const after1 = kl.getStd(v1.id);
    assert.strictEqual(after1.status, kl.STD_STATUS.ARCHIVED, 'v1 应自动归档');
    assert.strictEqual(after1.isCurrent, false);
    assert.strictEqual(kl.getChunk(v1Chunks[0].id).status, kl.STD_STATUS.ARCHIVED, 'v1 的片段应跟随归档');
    const vecs = kl.listVectorsByChunk(v1Chunks[0].id);
    assert.strictEqual(vecs.length, 1);
    assert.strictEqual(vecs[0].status, kl.STD_STATUS.ARCHIVED, 'v1 的向量应跟随归档');
    assert.strictEqual(v1Vectors[0].status, kl.STD_STATUS.DRAFT,
      '创建时返回的对象是当时的快照（值语义），后续状态变化只体现在库里');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I1：重复发布已生效版本被拒（published → published 非法）', () => {
  withLayers(() => {
    const { std } = seedTree();
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    assert.throws(() => kl.publishStd(std.id), (e) => e.status === 409);
  });
});

// ============================================================
// 4. 不变量 I2 —— 同 chunk + 同 model 下只有一份生效向量
// ============================================================

test('I2：同一 chunk 同一 model 再建向量，旧的 isCurrent 置 false', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const c = chunks[0];
    const a = kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] });
    const b = kl.createVector(c.id, { model: 'tfidf-v1', vec: [0, 1] });
    const all = kl.listVectorsByChunk(c.id).filter((v) => v.model === 'tfidf-v1');
    const currents = all.filter((v) => v.isCurrent);
    assert.strictEqual(currents.length, 1, `同 chunk+model 下 isCurrent 应恰好 1 条，实际 ${currents.length}`);
    assert.strictEqual(currents[0].id, b.id);
    assert.strictEqual(kl.listVectorsByChunk(c.id).find((v) => v.id === a.id).isCurrent, false);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I2：不同 model 各自独立，两个 model 各有一条 isCurrent', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const c = chunks[0];
    kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] });
    kl.createVector(c.id, { model: 'tfidf-v1', vec: [0, 1] });
    kl.createVector(c.id, { model: 'bge-small', vec: [0.5, 0.5] });

    const byModel = {};
    for (const v of kl.listVectorsByChunk(c.id)) {
      if (!v.isCurrent) continue;
      byModel[v.model] = (byModel[v.model] || 0) + 1;
    }
    assert.strictEqual(byModel['tfidf-v1'], 1);
    assert.strictEqual(byModel['bge-small'], 1);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I2：createVector 的 chunk 不存在抛 404，缺 model 抛 400', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    assert.throws(() => kl.createVector('chk_999', { model: 'm', vec: [1] }), (e) => e.status === 404);
    assert.throws(() => kl.createVector(chunks[0].id, { vec: [1] }), (e) => e.status === 400);
  });
});

// ============================================================
// 5. 不变量 I3 / I4 —— 权限判据字段强制继承，调用方传入一律忽略
// ============================================================

test('I3：createStdVersion 传入的 bizLine/securityLevel 被忽略，强制继承 raw', () => {
  withLayers(() => {
    const raw = seedRaw({ bizLine: 'trade', securityLevel: 'confidential' });
    const std = kl.createStdVersion(raw.id, {
      content: 'x',
      bizLine: 'membership',        // 故意传错
      securityLevel: 'public',      // 故意传错
      status: 'published',          // 故意传错
      isCurrent: true,              // 故意传错
      procVersion: 99,              // 故意传错
    });
    assert.strictEqual(std.bizLine, 'trade', '越权：std 的业务线没继承 raw');
    assert.strictEqual(std.securityLevel, 'confidential', '越权：std 的密级没继承 raw');
    assert.strictEqual(std.status, kl.STD_STATUS.DRAFT, '状态必须是 draft，不能被调用方指定');
    assert.strictEqual(std.isCurrent, false);
    assert.strictEqual(std.procVersion, 1);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I4：createChunks 传入的 bizLine/securityLevel/status 被忽略，强制继承 std', () => {
  withLayers(() => {
    const raw = seedRaw({ bizLine: 'trade', securityLevel: 'confidential' });
    const std = kl.createStdVersion(raw.id, { content: 'x' }); // draft
    const [chunk] = kl.createChunks(std.id, [{
      content: 'x 片段正文足够长以便入库使用。',
      bizLine: 'membership',   // 故意传错
      securityLevel: 'public', // 故意传错
      status: 'published',     // 故意传错 —— 第 7 步真出过的事故就在这
    }]);
    assert.strictEqual(chunk.bizLine, 'trade');
    assert.strictEqual(chunk.securityLevel, 'confidential');
    assert.strictEqual(chunk.status, kl.STD_STATUS.DRAFT,
      '未审核的片段状态必须是 draft，否则整层状态过滤静默失效');
    assert.strictEqual(chunk.stdId, std.id);
    assert.strictEqual(chunk.rawId, raw.id, 'rawId 应自动从 std 带出');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I4：createChunks 自动补 seq / charCount / fingerprint / embeddingStatus', () => {
  withLayers(() => {
    const raw = seedRaw();
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    const chunks = kl.createChunks(std.id, [
      { content: '第一段正文内容足够长以便入库使用。', heading: '一', sectionPath: ['1. 总则'] },
      { content: '第二段正文内容足够长以便入库使用。' },
    ]);
    assert.deepStrictEqual(chunks.map((c) => c.seq), [1, 2]);
    assert.strictEqual(chunks[0].charCount, chunks[0].content.length);
    assert.ok(chunks[0].fingerprint, '应自动生成内容指纹');
    assert.notStrictEqual(chunks[0].fingerprint, chunks[1].fingerprint);
    assert.strictEqual(chunks[0].embeddingStatus, 'pending');
    assert.deepStrictEqual(chunks[0].sectionPath, ['1. 总则']);
    assert.deepStrictEqual(chunks[1].sectionPath, []);
    assert.ok(/^chk_\d+$/.test(chunks[0].id));
    // 第二批追加时 seq 继续递增，不从 1 重来
    const more = kl.createChunks(std.id, [{ content: '第三段正文内容足够长以便入库使用。' }]);
    assert.strictEqual(more[0].seq, 3);
    assert.deepStrictEqual(kl.listChunksByStd(std.id).map((c) => c.seq), [1, 2, 3]);
  });
});

test('I4：createChunks 的 std 不存在抛 404；空数组返回空数组', () => {
  withLayers(() => {
    assert.throws(() => kl.createChunks('std_999', [{ content: 'x' }]), (e) => e.status === 404);
    const { std } = seedTree();
    assert.deepStrictEqual(kl.createChunks(std.id, []), []);
  });
});

test('I4：createVector 的 bizLine/securityLevel/status 强制继承 chunk，传入被忽略', () => {
  withLayers(() => {
    const raw = seedRaw({ bizLine: 'trade', securityLevel: 'confidential' });
    const std = kl.createStdVersion(raw.id, { content: 'x' });
    const [chunk] = kl.createChunks(std.id, [{ content: '片段正文内容足够长以便入库。' }]);
    const vec = kl.createVector(chunk.id, {
      model: 'tfidf-v1', vec: [1, 0, 0], indexName: 'main',
      bizLine: 'membership', securityLevel: 'public', status: 'published', // 故意传错
    });
    assert.strictEqual(vec.bizLine, 'trade');
    assert.strictEqual(vec.securityLevel, 'confidential');
    assert.strictEqual(vec.status, kl.STD_STATUS.DRAFT);
    assert.strictEqual(vec.chunkId, chunk.id);
    assert.strictEqual(vec.stdId, std.id);
    assert.strictEqual(vec.rawId, raw.id);
    assert.strictEqual(vec.dim, 3, 'dim 未传时按向量长度推断');
    assert.strictEqual(vec.isCurrent, true);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I4 级联同步：publishStd 后下游 chunks 与 vectors 全部变 published', () => {
  withLayers(() => {
    const { std, chunks } = seedTree();
    assert.strictEqual(chunks[0].status, kl.STD_STATUS.DRAFT);
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    for (const c of kl.listChunksByStd(std.id)) {
      assert.strictEqual(c.status, kl.STD_STATUS.PUBLISHED, `片段 ${c.id} 未同步为 published`);
      for (const v of kl.listVectorsByChunk(c.id)) {
        assert.strictEqual(v.status, kl.STD_STATUS.PUBLISHED, `向量 ${v.id} 未同步为 published`);
      }
    }
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I4 级联同步：archiveStd 后下游 chunks 与 vectors 全部变 archived', () => {
  withLayers(() => {
    const { std, chunks } = seedTree();
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    kl.archiveStd(std.id);

    const s = kl.getStd(std.id);
    assert.strictEqual(s.status, kl.STD_STATUS.ARCHIVED);
    assert.strictEqual(s.isCurrent, false, '归档后不能还是生效版本');
    for (const c of kl.listChunksByStd(std.id)) {
      assert.strictEqual(c.status, kl.STD_STATUS.ARCHIVED);
      for (const v of kl.listVectorsByChunk(c.id)) {
        assert.strictEqual(v.status, kl.STD_STATUS.ARCHIVED);
      }
    }
    assert.strictEqual(kl.getRaw(chunks[0].rawId).currentStdId, null, '归档后 raw 不应再指向它');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I4 级联同步：markNeedReview 与中间态流转同样同步下游（否则 I4 会破）', () => {
  withLayers(() => {
    const { std } = seedTree();
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    assert.strictEqual(kl.listChunksByStd(std.id)[0].status, kl.STD_STATUS.PENDING);

    kl.setStdStatus(std.id, kl.STD_STATUS.APPROVED);
    kl.publishStd(std.id);
    kl.markNeedReview(std.id);
    for (const c of kl.listChunksByStd(std.id)) {
      assert.strictEqual(c.status, kl.STD_STATUS.NEED_REVIEW);
      for (const v of kl.listVectorsByChunk(c.id)) {
        assert.strictEqual(v.status, kl.STD_STATUS.NEED_REVIEW);
      }
    }
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 6. 不变量 I5 —— 级联删除不留孤儿
// ============================================================

test('I5：deleteRawCascade 的删除计数与实际建的数量一致，删完无孤儿', () => {
  withLayers(() => {
    const raw = seedRaw();
    // 两个版本，各 2 个片段，每片段 2 个模型的向量
    let chunkTotal = 0;
    let vectorTotal = 0;
    for (let i = 0; i < 2; i++) {
      const std = kl.createStdVersion(raw.id, { content: `v${i}` });
      const chunks = kl.createChunks(std.id, [
        { content: `第 ${i} 版第一段正文内容足够长以便入库。` },
        { content: `第 ${i} 版第二段正文内容足够长以便入库。` },
      ]);
      chunkTotal += chunks.length;
      for (const c of chunks) {
        kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] });
        kl.createVector(c.id, { model: 'bge-small', vec: [0, 1] });
        vectorTotal += 2;
      }
    }
    // 另建一个不相关的 raw，确认不会被误删
    const other = seedTree({ raw: { fileName: 'other.md' } });

    const counts = kl.deleteRawCascade(raw.id);
    assert.strictEqual(counts.rawCount, 1);
    assert.strictEqual(counts.stdCount, 2);
    assert.strictEqual(counts.chunkCount, chunkTotal);
    assert.strictEqual(counts.vectorCount, vectorTotal);

    assert.strictEqual(kl.getRaw(raw.id), null);
    assert.deepStrictEqual(kl.listStdByRaw(raw.id), []);
    assert.deepStrictEqual(kl.checkInvariants(), [], '级联删除后不应残留孤儿');
    // 不相关的数据仍在
    assert.ok(kl.getRaw(other.raw.id));
    assert.strictEqual(kl.listChunksByStd(other.std.id).length, 2);
  });
});

test('I5：deleteStdCascade 只删该版本，raw 的 currentStdId 被清空', () => {
  withLayers(() => {
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, { content: 'v1' });
    kl.createChunks(v1.id, [{ content: 'v1 第一段正文内容足够长以便入库。' }]);
    const v2 = kl.createStdVersion(raw.id, { content: 'v2' });
    const v2Chunks = kl.createChunks(v2.id, [
      { content: 'v2 第一段正文内容足够长以便入库。' },
      { content: 'v2 第二段正文内容足够长以便入库。' },
    ]);
    for (const c of v2Chunks) kl.createVector(c.id, { model: 'tfidf-v1', vec: [1, 0] });
    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);

    const counts = kl.deleteStdCascade(v2.id);
    assert.strictEqual(counts.stdCount, 1);
    assert.strictEqual(counts.chunkCount, 2);
    assert.strictEqual(counts.vectorCount, 2);
    assert.strictEqual(kl.getStd(v2.id), null);
    assert.strictEqual(kl.getRaw(raw.id).currentStdId, null);
    assert.strictEqual(kl.listChunksByStd(v1.id).length, 1, '别的版本不受影响');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I5：deleteRawCascade / deleteStdCascade 目标不存在时返回全 0 计数', () => {
  withLayers(() => {
    assert.deepStrictEqual(kl.deleteRawCascade('raw_999'),
      { rawCount: 0, stdCount: 0, chunkCount: 0, vectorCount: 0 });
    assert.deepStrictEqual(kl.deleteStdCascade('std_999'),
      { stdCount: 0, chunkCount: 0, vectorCount: 0 });
  });
});

test('I5：checkInvariants 能检出人为造出的孤儿记录', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    // 绕过 API 直接写脏数据：让 chunk 指向不存在的 std
    const list = store.read('chunks', []);
    list.push({ ...chunks[0], id: 'chk_900', stdId: 'std_missing', rawId: 'raw_missing' });
    store.write('chunks', list);

    const violations = kl.checkInvariants();
    const i5 = violations.filter((v) => v.code === 'I5');
    assert.ok(i5.length >= 1, `应检出 I5 违反项，实际: ${JSON.stringify(violations)}`);
    assert.ok(JSON.stringify(i5).includes('chk_900'));
  });
});

test('I5：checkInvariants 能检出被篡改的继承字段（I3 / I4）与重复生效（I1 / I2）', () => {
  withLayers(() => {
    const { raw, std, chunks, vectors } = seedTree();
    // 篡改 std 的密级 → I3
    const stds = store.read('std_documents', []);
    stds.find((s) => s.id === std.id).securityLevel = 'public';
    // 再造一个同 raw 的 isCurrent std → I1
    stds.push({ ...std, id: 'std_900', isCurrent: true, procVersion: 9 });
    stds.find((s) => s.id === std.id).isCurrent = true;
    store.write('std_documents', stds);
    // 篡改 chunk 的状态 → I4
    const cs = store.read('chunks', []);
    cs.find((c) => c.id === chunks[0].id).status = 'published';
    store.write('chunks', cs);
    // 造一个同 chunk+model 的重复 isCurrent 向量 → I2
    const vs = store.read('vectors', []);
    vs.push({ ...vectors[0], id: 'vec_900', isCurrent: true });
    store.write('vectors', vs);

    const codes = new Set(kl.checkInvariants().map((v) => v.code));
    for (const code of ['I1', 'I2', 'I3', 'I4']) {
      assert.ok(codes.has(code), `应检出 ${code}，实际检出 ${[...codes].join(',')}`);
    }
    assert.ok(kl.getRaw(raw.id));
  });
});

// ============================================================
// 7. 不变量 I6 —— 只有可检索状态且生效的向量参与检索
// ============================================================

test('I6：listRetrievableVectors 只返回 published / need_review 且 isCurrent 的向量', () => {
  withLayers(() => {
    const S = kl.STD_STATUS;
    const made = {};
    // 每个状态各造一条独立的 raw→std→chunk→vector 链
    for (const status of [S.DRAFT, S.QC_FAILED, S.PENDING, S.REJECTED, S.APPROVED,
      S.PUBLISHED, S.NEED_REVIEW, S.ARCHIVED]) {
      const raw = seedRaw({ fileName: `${status}.md` });
      const std = kl.createStdVersion(raw.id, { content: status });
      const [chunk] = kl.createChunks(std.id, [{ content: `${status} 状态的片段正文内容。` }]);
      const vec = kl.createVector(chunk.id, { model: 'tfidf-v1', vec: [1, 0] });
      driveStdTo(std.id, status);
      made[status] = { vecId: vec.id, chunkId: chunk.id };
    }
    // 再给 published 那条片段建一个同 model 的新向量：
    // 旧向量 status 仍是 published，但 isCurrent=false，不能参与检索
    const stale = made[S.PUBLISHED].vecId;
    const fresh = kl.createVector(made[S.PUBLISHED].chunkId, { model: 'tfidf-v1', vec: [0, 1] });

    const got = kl.listRetrievableVectors();
    const gotIds = got.map((v) => v.id);

    // 注意：这里不再遍历 got 断言"每条都满足 RETRIEVABLE 且 isCurrent" ——
    // 那是 listRetrievableVectors 自己的过滤条件，用同一个谓词断言过滤结果恒真，
    // 给的是虚假信心。有效的断言是下面的"该出现的出现、该排除的排除 + 总数"。
    assert.ok(gotIds.includes(fresh.id), '当前生效的 published 向量应参与检索');
    assert.ok(gotIds.includes(made[S.NEED_REVIEW].vecId), 'need_review 仍可检索（答案里另行标注过期）');
    assert.ok(!gotIds.includes(stale), '被顶掉的旧向量不应参与检索');
    for (const status of [S.DRAFT, S.QC_FAILED, S.PENDING, S.REJECTED, S.APPROVED, S.ARCHIVED]) {
      assert.ok(!gotIds.includes(made[status].vecId), `${status} 状态的向量不应参与检索`);
    }
    assert.strictEqual(got.length, 2, `可检索向量应恰好 2 条，实际 ${got.length}: ${gotIds.join(',')}`);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('I6：空库时 listRetrievableVectors 返回空数组，checkInvariants 无违反项', () => {
  withLayers(() => {
    assert.deepStrictEqual(kl.listRetrievableVectors(), []);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 8. 状态机 —— 全部合法 / 全部非法流转
// ============================================================

test('状态机：TRANSITIONS 表覆盖全部 8 个状态，archived 是终态', () => {
  const all = Object.values(kl.STD_STATUS);
  assert.strictEqual(all.length, 8);
  for (const s of all) {
    assert.ok(Array.isArray(kl.TRANSITIONS[s]), `缺少 ${s} 的流转定义`);
  }
  assert.deepStrictEqual(kl.TRANSITIONS[kl.STD_STATUS.ARCHIVED], []);
  assert.deepStrictEqual(kl.RETRIEVABLE, ['published', 'need_review']);
});

test('状态机：全部合法流转都能成功', () => {
  withLayers(() => {
    for (const [from, tos] of Object.entries(kl.TRANSITIONS)) {
      for (const to of tos) {
        const raw = seedRaw({ fileName: `${from}-${to}.md` });
        const std = kl.createStdVersion(raw.id, { content: 'x' });
        kl.createChunks(std.id, [{ content: `${from} 到 ${to} 的片段正文内容。` }]);
        driveStdTo(std.id, from);
        const after = kl.setStdStatus(std.id, to, { reviewedBy: 'reviewer_li', reviewNote: '测试' });
        assert.strictEqual(after.status, to, `合法流转 ${from} → ${to} 失败`);
      }
    }
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('状态机：全部非法流转一律抛 409（遍历 from × to 全组合）', () => {
  withLayers(() => {
    const all = Object.values(kl.STD_STATUS);
    let illegalChecked = 0;
    for (const from of all) {
      for (const to of all) {
        if ((kl.TRANSITIONS[from] || []).includes(to)) continue;
        const raw = seedRaw({ fileName: `bad-${from}-${to}.md` });
        const std = kl.createStdVersion(raw.id, { content: 'x' });
        driveStdTo(std.id, from);
        assert.throws(
          () => kl.setStdStatus(std.id, to),
          (e) => e.status === 409,
          `非法流转 ${from} → ${to} 应抛 409`
        );
        assert.strictEqual(kl.getStd(std.id).status, from, `非法流转 ${from} → ${to} 后状态不应改变`);
        illegalChecked += 1;
      }
    }
    assert.ok(illegalChecked >= 40, `非法组合数偏少（${illegalChecked}），检查遍历逻辑`);
  });
});

test('状态机：publishStd / archiveStd / markNeedReview 也受流转表约束', () => {
  withLayers(() => {
    const { std } = seedTree();                            // draft
    assert.throws(() => kl.publishStd(std.id), (e) => e.status === 409, 'draft 不能直接发布');
    assert.throws(() => kl.markNeedReview(std.id), (e) => e.status === 409, 'draft 不能转复审');
    // draft → archived 是合法的（废弃草稿），见 4.2 流转表

    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    kl.markNeedReview(std.id);
    assert.strictEqual(kl.getStd(std.id).status, kl.STD_STATUS.NEED_REVIEW);
    kl.publishStd(std.id);                                  // need_review → published 合法
    assert.strictEqual(kl.getStd(std.id).status, kl.STD_STATUS.PUBLISHED);
  });
});

test('状态机：未知状态值与不存在的 std 分别抛 400 / 404', () => {
  withLayers(() => {
    const { std } = seedTree();
    assert.throws(() => kl.setStdStatus(std.id, 'whatever'), (e) => e.status === 400);
    assert.throws(() => kl.setStdStatus('std_999', kl.STD_STATUS.PENDING), (e) => e.status === 404);
    assert.throws(() => kl.publishStd('std_999'), (e) => e.status === 404);
    assert.throws(() => kl.archiveStd('std_999'), (e) => e.status === 404);
  });
});

test('状态机：审核信息写入 reviewedBy / reviewedAt / reviewNote', () => {
  withLayers(() => {
    const { std } = seedTree();
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    const rejected = kl.setStdStatus(std.id, kl.STD_STATUS.REJECTED, {
      reviewedBy: 'reviewer_li', reviewNote: '术语不统一，退回修改',
    });
    assert.strictEqual(rejected.reviewedBy, 'reviewer_li');
    assert.strictEqual(rejected.reviewNote, '术语不统一，退回修改');
    assert.ok(rejected.reviewedAt, 'reviewedAt 应自动打时间戳');
  });
});

// ============================================================
// 9. 常量与存储布局
// ============================================================

test('存储布局：四层各写自己的 JSON 文件，不再碰 documents.json', () => {
  withLayers(() => {
    seedTree();
    const dir = config.paths.data;
    for (const f of ['raw_documents.json', 'std_documents.json', 'chunks.json', 'vectors.json']) {
      assert.ok(fs.existsSync(path.join(dir, f)), `缺少 ${f}`);
    }
    assert.ok(!fs.existsSync(path.join(dir, 'documents.json')), '不应再写旧的扁平表');
    assert.deepStrictEqual(kl.LAYERS, { RAW: 'raw', STD: 'std', CHUNK: 'chunk', VECTOR: 'vector' });
  });
});

// ============================================================
// 10. 追加片段的状态守卫（A）—— 已审核过的版本不能再塞新正文
// ============================================================

test('守卫：已发布版本被追加片段并配向量后立刻进检索池（攻击场景）必须被 409 拦死', () => {
  withLayers(() => {
    const raw = seedRaw();
    const std = kl.createStdVersion(raw.id, { content: '审核员看到的内容' });
    kl.createChunks(std.id, [{ content: '审核员看过的片段' }]);
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    // 审核员批的是 std 的正文；此时追加的片段正文可以和 std.content 毫无关系，
    // 六个不变量字面上全都成立，但 I6"未审核内容不得泄漏"被绕过了
    assert.throws(
      () => kl.createChunks(std.id, [{ content: '内部薪资表' }]),
      (e) => e.status === 409 && /已发布|重新加工/.test(e.message),
      '已发布版本追加片段必须抛 409'
    );
    assert.strictEqual(kl.listChunksByStd(std.id).length, 1, '不能真的写进去');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('守卫：createChunks 在 draft / qc_failed / pending / approved 四个状态下都能追加', () => {
  withLayers(() => {
    const S = kl.STD_STATUS;
    for (const status of [S.DRAFT, S.QC_FAILED, S.PENDING, S.APPROVED]) {
      const raw = seedRaw({ fileName: `append-${status}.md` });
      const std = kl.createStdVersion(raw.id, { content: status });
      driveStdTo(std.id, status);
      const made = kl.createChunks(std.id, [{ content: `${status} 状态下追加的片段正文。` }]);
      assert.strictEqual(made.length, 1, `${status} 状态应允许追加片段`);
      assert.strictEqual(made[0].status, status, '片段状态必须继承 std');
    }
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('守卫：createChunks 在 published / need_review / rejected / archived 下一律 409', () => {
  withLayers(() => {
    const S = kl.STD_STATUS;
    for (const status of [S.PUBLISHED, S.NEED_REVIEW, S.REJECTED, S.ARCHIVED]) {
      const raw = seedRaw({ fileName: `deny-${status}.md` });
      const std = kl.createStdVersion(raw.id, { content: status });
      driveStdTo(std.id, status);
      assert.throws(
        () => kl.createChunks(std.id, [{ content: `${status} 状态下不该能追加。` }]),
        (e) => e.status === 409,
        `${status} 状态追加片段应抛 409`
      );
    }
  });
});

test('守卫：createVector 允许给 published / need_review 的片段补建向量，但拒绝 archived', () => {
  withLayers(() => {
    const S = kl.STD_STATUS;
    // published：正常发布流程里向量就是在 approved→published 之间建的，
    // 补建 / 换模型重建也是合法运维动作
    const pub = seedTree({ raw: { fileName: 'vec-pub.md' } });
    driveStdTo(pub.std.id, S.PUBLISHED);
    const v = kl.createVector(pub.chunks[0].id, { model: 'bge-small', vec: [0, 1] });
    assert.strictEqual(v.status, S.PUBLISHED, '向量状态继承片段');

    const nr = seedTree({ raw: { fileName: 'vec-nr.md' } });
    driveStdTo(nr.std.id, S.NEED_REVIEW);
    assert.ok(kl.createVector(nr.chunks[0].id, { model: 'bge-small', vec: [0, 1] }));

    // archived 是终态，给它建向量只会造出永远不会被检索的垃圾
    const arc = seedTree({ raw: { fileName: 'vec-arc.md' } });
    driveStdTo(arc.std.id, S.ARCHIVED);
    assert.throws(
      () => kl.createVector(arc.chunks[0].id, { model: 'bge-small', vec: [0, 1] }),
      (e) => e.status === 409 && /归档/.test(e.message),
      'archived 版本的片段不该能建向量'
    );
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 11. 新增的两条流转 + 版本回滚（B）
// ============================================================

test('流转：draft → archived（废弃草稿）合法，下游片段跟随归档', () => {
  withLayers(() => {
    const { std, chunks } = seedTree();
    const after = kl.setStdStatus(std.id, kl.STD_STATUS.ARCHIVED);
    assert.strictEqual(after.status, kl.STD_STATUS.ARCHIVED);
    assert.strictEqual(after.isCurrent, false);
    assert.strictEqual(kl.getChunk(chunks[0].id).status, kl.STD_STATUS.ARCHIVED);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('流转：pending → draft（撤回送审）合法，下游片段跟随回到 draft', () => {
  withLayers(() => {
    const { std, chunks } = seedTree();
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    const back = kl.setStdStatus(std.id, kl.STD_STATUS.DRAFT);
    assert.strictEqual(back.status, kl.STD_STATUS.DRAFT);
    assert.strictEqual(kl.getChunk(chunks[0].id).status, kl.STD_STATUS.DRAFT);
    // 撤回后还能再送审
    assert.strictEqual(kl.setStdStatus(std.id, kl.STD_STATUS.PENDING).status, kl.STD_STATUS.PENDING);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('回滚：rollbackToVersion 复制旧版本内容建新版本，旧版本仍是 archived（版本号只增不减）', () => {
  withLayers(() => {
    const raw = seedRaw();
    const v1 = kl.createStdVersion(raw.id, {
      content: 'v1 的正文', params: { splitMode: 'fixed', fixedSize: 222 }, sections: [{ level: 1, heading: '一' }],
    });
    driveStdTo(v1.id, kl.STD_STATUS.PUBLISHED);
    const v2 = kl.createStdVersion(raw.id, { content: 'v2 的正文' });
    driveStdTo(v2.id, kl.STD_STATUS.PUBLISHED);
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.ARCHIVED);

    const v3 = kl.rollbackToVersion(v1.id);
    assert.strictEqual(v3.procVersion, 3, '回滚是新建版本，版本号继续往上走');
    assert.strictEqual(v3.status, kl.STD_STATUS.DRAFT, '回滚出来的版本要走正常审核发布流程');
    assert.strictEqual(v3.isCurrent, false);
    assert.strictEqual(v3.content, 'v1 的正文');
    assert.strictEqual(v3.params.splitMode, 'fixed');
    assert.strictEqual(v3.params.fixedSize, 222);
    assert.deepStrictEqual(v3.sections, [{ level: 1, heading: '一' }]);
    assert.strictEqual(kl.getStd(v1.id).status, kl.STD_STATUS.ARCHIVED, '旧版本不复活');
    assert.strictEqual(kl.getStd(v1.id).isCurrent, false);

    driveStdTo(v3.id, kl.STD_STATUS.PUBLISHED);
    const currents = kl.listStdByRaw(raw.id).filter((s) => s.isCurrent);
    assert.strictEqual(currents.length, 1, '发布回滚版本后 I1 仍成立');
    assert.strictEqual(currents[0].id, v3.id);
    assert.strictEqual(kl.getStd(v2.id).status, kl.STD_STATUS.ARCHIVED, 'v2 让位后归档');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('回滚：rollbackToVersion 的源版本不存在抛 404', () => {
  withLayers(() => {
    assert.throws(() => kl.rollbackToVersion('std_999'), (e) => e.status === 404);
  });
});

// ============================================================
// 12. I6 自检必须是真的（C）
// ============================================================

test('I6：向量留在检索池但其版本不可检索时，checkInvariants 必须报 I6', () => {
  withLayers(() => {
    const { std, chunks, vectors } = seedTree();          // 全链 draft
    // 绕过 API 直接篡改一条向量：状态改成 published 且生效，
    // 它的 chunk / std 仍是 draft —— 这条向量已经出现在检索池里
    const vs = store.read('vectors', []);
    vs.find((v) => v.id === vectors[0].id).status = kl.STD_STATUS.PUBLISHED;
    store.write('vectors', vs);

    assert.ok(
      kl.listRetrievableVectors().some((v) => v.id === vectors[0].id),
      '前提：被篡改的向量确实已经在检索池里'
    );
    const violations = kl.checkInvariants();
    const i6 = violations.filter((v) => v.code === 'I6');
    assert.ok(i6.length >= 1, `应报出 I6，实际只有: ${violations.map((v) => v.code).join(',')}`);
    assert.ok(JSON.stringify(i6).includes(vectors[0].id));
    assert.ok(kl.getStd(std.id).status === kl.STD_STATUS.DRAFT);
    assert.ok(kl.getChunk(chunks[0].id).status === kl.STD_STATUS.DRAFT);
  });
});

test('I6：向量状态与片段一致但所属版本已不生效时同样报 I6（自下往上核对）', () => {
  withLayers(() => {
    const { std } = seedTree();
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    // 只把 std 的 isCurrent 摘掉（不走 archiveStd，模拟脏数据 / 半途中断）
    const stds = store.read('std_documents', []);
    stds.find((s) => s.id === std.id).isCurrent = false;
    store.write('std_documents', stds);

    const codes = kl.checkInvariants().map((v) => v.code);
    assert.ok(codes.includes('I6'), `应报 I6，实际: ${codes.join(',')}`);
  });
});

// ============================================================
// 13. 返回值必须脱离缓存（D）
// ============================================================

test('返回值：篡改读取结果再触发任意一次写盘，数据不会被污染（不给第二条改 status 的路）', () => {
  withLayers(() => {
    const { std, chunks, vectors } = seedTree();

    // 拿到返回值后就地篡改 —— 以前这里改的是 store 缓存里的活对象
    const v = kl.listVectorsByChunk(chunks[0].id)[0];
    v.status = kl.STD_STATUS.PUBLISHED;
    v.isCurrent = true;
    v.vec[0] = 999;
    const s = kl.getStd(std.id);
    s.status = kl.STD_STATUS.PUBLISHED;
    const c = kl.getChunk(chunks[0].id);
    c.securityLevel = 'public';
    const r = kl.getRaw(chunks[0].rawId);
    r.bizLine = 'membership';
    const listed = kl.listRetrievableVectors();
    assert.deepStrictEqual(listed, [], '前提：篡改前后检索池都应是空的');

    // 触发一次该表的写操作（以前这一步会把内存里的篡改一起 stringify 落盘）
    kl.createVector(chunks[1].id, { model: 'bge-small', vec: [0, 1] });
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);

    store.clearCache();                                   // 重新读盘看真相
    const fresh = kl.listVectorsByChunk(chunks[0].id).find((x) => x.id === vectors[0].id);
    assert.strictEqual(fresh.status, kl.STD_STATUS.PENDING, '向量状态只能被状态机改');
    assert.strictEqual(fresh.vec[0], 0.1, 'vec 数组也必须是拷贝，否则向量值被外部改掉照样落盘');
    assert.strictEqual(kl.getChunk(chunks[0].id).securityLevel, 'confidential');
    assert.strictEqual(kl.getRaw(chunks[0].rawId).bizLine, 'trade');
    assert.ok(!kl.listRetrievableVectors().some((x) => x.id === vectors[0].id),
      '被篡改的向量不能出现在检索池里');
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('返回值：listStdByRaw / listChunksByStd / listRetrievableVectors 也返回拷贝', () => {
  withLayers(() => {
    const { std, chunks } = seedTree();
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);

    kl.listStdByRaw(chunks[0].rawId)[0].procVersion = 99;
    kl.listChunksByStd(std.id)[0].seq = 99;
    kl.listRetrievableVectors()[0].dim = 99;
    // 触发写盘
    kl.markNeedReview(std.id);
    store.clearCache();

    assert.strictEqual(kl.listStdByRaw(chunks[0].rawId)[0].procVersion, 1);
    assert.strictEqual(kl.listChunksByStd(std.id)[0].seq, 1);
    assert.strictEqual(kl.listRetrievableVectors()[0].dim, 2);
  });
});

// ============================================================
// 14. I7 —— raw.currentStdId 与 isCurrent 必须一致
// ============================================================

test('I7：raw.currentStdId 与该 raw 下 isCurrent 的版本不一致时报 I7', () => {
  withLayers(() => {
    const { raw, std } = seedTree();
    driveStdTo(std.id, kl.STD_STATUS.PUBLISHED);
    assert.deepStrictEqual(kl.checkInvariants(), [], '正常发布后两个真相源一致');

    // 只改冗余指针，不动 isCurrent —— 影响预览的 reprocess 用的正是这个指针
    const raws = store.read('raw_documents', []);
    raws.find((x) => x.id === raw.id).currentStdId = null;
    store.write('raw_documents', raws);

    const codes = kl.checkInvariants().map((v) => v.code);
    assert.ok(codes.includes('I7'), `应报 I7，实际: ${codes.join(',')}`);
  });
});

test('I7：raw 从未发布过任何版本时，currentStdId 与 isCurrent 同时为空也算一致', () => {
  withLayers(() => {
    seedTree();
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

// ============================================================
// 15. 批量建向量与存储开销（J）
// ============================================================

test('批量：createVectors 一次落盘建 N 条向量，结果正确且 I2 成立', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const chunkId = chunks[0].id;
    // 先把 seedTree 建的那条向量退位造成的写次数排除在统计之外
    const origWrite = store.write;
    let vectorWrites = 0;
    store.write = (name, value) => {
      if (name === 'vectors') vectorWrites += 1;
      return origWrite(name, value);
    };
    let made;
    try {
      made = kl.createVectors(chunkId, [
        { model: 'm1', vec: [1, 0] },
        { model: 'm2', vec: [0, 1] },
        { model: 'm3', vec: [1, 1] },
      ]);
    } finally {
      store.write = origWrite;
    }
    assert.strictEqual(vectorWrites, 1, `批量建 3 条向量应只落盘 1 次，实际 ${vectorWrites} 次`);
    assert.strictEqual(made.length, 3);
    assert.deepStrictEqual(made.map((v) => v.model), ['m1', 'm2', 'm3']);
    const ids = new Set(made.map((v) => v.id));
    assert.strictEqual(ids.size, 3, 'ID 必须各不相同（一次算好连续 ID）');
    for (const v of made) {
      assert.strictEqual(v.chunkId, chunkId);
      assert.strictEqual(v.status, kl.STD_STATUS.DRAFT, '状态继承片段');
      assert.strictEqual(v.isCurrent, true);
    }
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('批量：createVectorsBatch 跨片段一次写入；同 chunk+model 重复时只有最后一条生效', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const origWrite = store.write;
    let vectorWrites = 0;
    store.write = (name, value) => {
      if (name === 'vectors') vectorWrites += 1;
      return origWrite(name, value);
    };
    let made;
    try {
      made = kl.createVectorsBatch([
        { chunkId: chunks[0].id, model: 'bge-small', vec: [1, 0] },
        { chunkId: chunks[1].id, model: 'bge-small', vec: [0, 1] },
        { chunkId: chunks[0].id, model: 'bge-small', vec: [0.5, 0.5] },   // 同 chunk+model 重复
      ]);
    } finally {
      store.write = origWrite;
    }
    assert.ok(vectorWrites <= 2, `跨片段批量最多 2 次落盘（退位 + 插入），实际 ${vectorWrites}`);
    assert.strictEqual(made.length, 3);
    assert.strictEqual(made[0].isCurrent, false, '批内被后来者顶掉的不能还是生效');
    assert.strictEqual(made[2].isCurrent, true);
    assert.deepStrictEqual(kl.checkInvariants(), [], '批内重复不能破 I2');
  });
});

test('批量：createVector 是 createVectors 的薄封装，行为与以前一致', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const one = kl.createVector(chunks[0].id, { model: 'solo', dim: 2, vec: [1, 0], indexName: 'main' });
    assert.strictEqual(one.model, 'solo');
    assert.strictEqual(one.indexName, 'main');
    assert.strictEqual(one.isCurrent, true);
    assert.throws(() => kl.createVectors('chk_999', [{ model: 'm', vec: [1] }]), (e) => e.status === 404);
    assert.throws(() => kl.createVectors(chunks[0].id, [{ vec: [1] }]), (e) => e.status === 400);
    assert.deepStrictEqual(kl.createVectors(chunks[0].id, []), []);
  });
});

test('向量编码：encoding 默认 dense，可显式传 sparse，非法值抛 400', () => {
  withLayers(() => {
    const { chunks } = seedTree();
    const dense = kl.createVector(chunks[0].id, { model: 'd', vec: [1, 0] });
    assert.strictEqual(dense.encoding, 'dense', '存储层默认按稠密数组记录');

    const sparse = kl.createVector(chunks[0].id, {
      model: 's', encoding: 'sparse', dim: 11093, vec: [{ idx: 3, val: 0.7 }],
    });
    assert.strictEqual(sparse.encoding, 'sparse');
    assert.strictEqual(sparse.dim, 11093, 'dim 记录全维度，不是非零个数');

    assert.throws(
      () => kl.createVector(chunks[0].id, { model: 'x', encoding: 'compressed', vec: [1] }),
      (e) => e.status === 400
    );
  });
});

test('存储开销：vectors.json 不缩进，其他表仍缩进（便于人读）', () => {
  withLayers(() => {
    seedTree();
    const dir = config.paths.data;
    const vecText = fs.readFileSync(path.join(dir, 'vectors.json'), 'utf8');
    const chunkText = fs.readFileSync(path.join(dir, 'chunks.json'), 'utf8');
    assert.ok(!vecText.includes('\n'), 'vectors.json 应是单行紧凑 JSON（稠密向量缩进后体积翻倍）');
    assert.ok(chunkText.includes('\n  '), 'chunks.json 仍应缩进');
    assert.strictEqual(JSON.parse(vecText).length, 2, '紧凑写法仍必须是合法 JSON');
  });
});
