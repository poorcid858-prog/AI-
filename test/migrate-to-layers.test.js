/**
 * 迁移脚本测试 —— 第 8 步
 *
 * 两部分：
 *   1. 纯函数：一条旧扁平记录 → 四层记录入参的转换逻辑（无副作用）
 *   2. 真执行：幂等 / 中途失败回滚 / 自检不过不改名 / 改名时序 / 执行闸门
 *
 * 第 2 部分用临时数据目录（os.tmpdir()）跑真正的 migrate()，不碰仓库里的 data/。
 * 契约第 7 节把"幂等"写成硬要求，只测 legacyKey 这个纯函数是测不到的 ——
 * 幂等是"判重键 + 已有数据"两者配合的结果。
 *
 * 隔离靠临时改全局 config.paths.data，因此**本文件所有用例必须保持同步执行**。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const store = require('../lib/store');
const kl = require('../lib/knowledge-layers');
const mig = require('../scripts/migrate-to-layers');

function legacyDoc(over = {}) {
  return {
    id: 'doc_001',
    title: '退款流程规范',
    fileName: 'refund-process.md',
    bizLine: 'trade',
    securityLevel: 'internal',
    tags: ['退款', '交易'],
    status: 'approved',
    uploadedBy: 'admin',
    reviewedBy: 'reviewer_li',
    reviewedAt: '2026-01-02T03:04:05.000Z',
    reviewNote: '内容准确',
    content: '# 退款流程\n\n用户提交退款申请后进入审核环节。',
    chunks: [
      { id: 'doc_001_c001', content: '片段一正文', heading: '退款', keywords: ['退款'], fingerprint: 'fp_a' },
      { id: 'doc_001_c002', content: '片段二正文', heading: '时效', keywords: ['时效'], fingerprint: 'fp_b' },
    ],
    chunkCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

test('迁移转换：一条旧记录拆成 1 个 raw + 1 个 std + N 个 chunk，不生成向量', () => {
  const out = mig.convertLegacyRecord(legacyDoc());
  assert.ok(out.raw && out.std && Array.isArray(out.chunks));
  assert.strictEqual(out.chunks.length, 2);
  assert.strictEqual(out.vectors, undefined, '向量在第 12 步重建，迁移不生成');
  assert.strictEqual(out.raw.content.includes('退款流程'), true, '原文必须搬过去');
  assert.strictEqual(out.raw.bizLine, 'trade');
  assert.strictEqual(out.raw.securityLevel, 'internal');
  assert.deepStrictEqual(out.raw.tags, ['退款', '交易']);
  assert.strictEqual(out.raw.uploadedBy, 'admin');
  assert.strictEqual(out.raw.title, '退款流程规范');
});

test('迁移转换：std 的 procVersion=1，params 取 config 默认值快照', () => {
  const out = mig.convertLegacyRecord(legacyDoc());
  assert.strictEqual(out.std.procVersion, 1);
  assert.strictEqual(out.std.params.splitMode, config.processing.splitMode);
  assert.strictEqual(out.std.params.prependHeading, config.processing.prependHeading);
  assert.strictEqual(out.std.params.cleanLevel.stripRevision, config.processing.cleanLevel.stripRevision);
  assert.notStrictEqual(out.std.params, config.processing, '必须是快照副本，不能引用同一个对象');
  assert.strictEqual(out.std.content.includes('退款流程'), true);
  assert.strictEqual(out.std.reviewedBy, 'reviewer_li');
  assert.strictEqual(out.std.reviewNote, '内容准确');
});

test('迁移转换：旧 status 映射 —— approved→published+生效，pending/rejected 不生效', () => {
  const a = mig.convertLegacyRecord(legacyDoc({ status: 'approved' }));
  assert.strictEqual(a.targetStdStatus, 'published');
  assert.strictEqual(a.isCurrent, true);

  const p = mig.convertLegacyRecord(legacyDoc({ status: 'pending' }));
  assert.strictEqual(p.targetStdStatus, 'pending');
  assert.strictEqual(p.isCurrent, false);

  const r = mig.convertLegacyRecord(legacyDoc({ status: 'rejected' }));
  assert.strictEqual(r.targetStdStatus, 'rejected');
  assert.strictEqual(r.isCurrent, false);
});

test('迁移转换：未知旧状态兜底为 pending（不静默变成已发布）', () => {
  const out = mig.convertLegacyRecord(legacyDoc({ status: 'whatever' }));
  assert.strictEqual(out.targetStdStatus, 'pending');
  assert.strictEqual(out.isCurrent, false);
});

test('迁移转换：片段搬运保留正文/标题/关键词/指纹，且不带权限字段（由上层继承）', () => {
  const out = mig.convertLegacyRecord(legacyDoc());
  const c = out.chunks[0];
  assert.strictEqual(c.content, '片段一正文');
  assert.strictEqual(c.heading, '退款');
  assert.deepStrictEqual(c.keywords, ['退款']);
  assert.strictEqual(c.fingerprint, 'fp_a');
  assert.strictEqual(c.bizLine, undefined, '权限字段不由迁移指定，createChunks 从 std 继承');
  assert.strictEqual(c.securityLevel, undefined);
  assert.strictEqual(c.status, undefined);
});

test('迁移转换：旧记录没有 chunks 字段时返回空片段数组，不崩', () => {
  const out = mig.convertLegacyRecord(legacyDoc({ chunks: undefined }));
  assert.deepStrictEqual(out.chunks, []);
});

test('迁移转换：knowledgeType 缺省为 other，fileType 从文件名推断', () => {
  const md = mig.convertLegacyRecord(legacyDoc());
  assert.strictEqual(md.raw.knowledgeType, 'other');
  assert.strictEqual(md.raw.fileType, 'md');
  const docx = mig.convertLegacyRecord(legacyDoc({ fileName: '需求说明.docx' }));
  assert.strictEqual(docx.raw.fileType, 'docx');
  const none = mig.convertLegacyRecord(legacyDoc({ fileName: null }));
  assert.strictEqual(none.raw.fileType, 'md', '无文件名时按 md 兜底');
});

test('迁移判重键：按 fileName + createdAt，缺文件名时用旧 id 兜底', () => {
  const k1 = mig.legacyKey(legacyDoc());
  const k2 = mig.legacyKey(legacyDoc());
  assert.strictEqual(k1, k2, '同一条旧记录必须得到同一个键（幂等的基础）');

  const k3 = mig.legacyKey(legacyDoc({ createdAt: '2026-02-02T00:00:00.000Z' }));
  assert.notStrictEqual(k1, k3);

  const k4 = mig.legacyKey(legacyDoc({ fileName: null }));
  assert.ok(k4.includes('doc_001'), '无文件名时应退回用旧 id 判重');
});

test('迁移判重键：能从已迁移的 raw 记录还原同一个键（幂等靠这个对齐）', () => {
  const old = legacyDoc();
  const out = mig.convertLegacyRecord(old);
  // 转换出来的 raw 入参必须携带足以还原判重键的信息
  assert.strictEqual(mig.legacyKey(out.raw), mig.legacyKey(old));
});

test('迁移脚本被 require 时不执行迁移（真验证：require 后旧表与四层表都没被动过）', () => {
  withMigrateEnv([legacyDoc()], (dir) => {
    const resolved = require.resolve('../scripts/migrate-to-layers');
    const before = fs.readFileSync(path.join(dir, 'documents.json'), 'utf8');
    delete require.cache[resolved];
    const fresh = require('../scripts/migrate-to-layers');   // 重新求值整个模块

    assert.strictEqual(typeof fresh.migrate, 'function');
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')), 'require 不该改名旧表');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'documents.json'), 'utf8'), before);
    assert.ok(!fs.existsSync(path.join(dir, 'documents.legacy.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'raw_documents.json')), 'require 不该写出任何四层表');
    assert.strictEqual(kl.listRaws().length, 0);
  });
});

// ============================================================
// 真执行部分：幂等 / 回滚 / 闸门 / 改名时序
// ============================================================

/**
 * 临时数据目录夹具（与另外两个测试文件同款）。
 * 临时目录放 os.tmpdir()，不能放 test/ 下 —— `npm test` 会把它当测试文件扫。
 */
function withMigrateEnv(legacyDocs, fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-mig-${process.pid}`);
  const realDataDir = config.paths.data;
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    config.paths.data = tmpDir;
    store.clearCache();
    if (legacyDocs) {
      fs.writeFileSync(path.join(tmpDir, 'documents.json'), JSON.stringify(legacyDocs, null, 2), 'utf8');
    }
    return fn(tmpDir);
  } finally {
    config.paths.data = realDataDir;
    store.clearCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 第二条旧记录：待审核状态，1 个片段 */
function legacyDoc2(over = {}) {
  return legacyDoc({
    id: 'doc_002',
    title: '会员积分规则',
    fileName: 'member-points.md',
    bizLine: 'membership',
    status: 'pending',
    chunks: [{ id: 'doc_002_c001', content: '积分片段正文', heading: '积分' }],
    chunkCount: 1,
    createdAt: '2026-01-03T00:00:00.000Z',
    ...over,
  });
}

test('迁移执行：第一次迁移搬完全部记录，自检干净，只有全绿才改名旧表', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    const r = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(r.total, 2);
    assert.strictEqual(r.migrated, 2);
    assert.strictEqual(r.skipped, 0);
    assert.strictEqual(r.chunkCount, 3, '2 + 1 个片段');
    assert.deepStrictEqual(r.violations, []);
    assert.strictEqual(r.renamed, true);
    assert.deepStrictEqual(kl.checkInvariants(), [], '迁移完必须过完整性自检');

    assert.ok(!fs.existsSync(path.join(dir, 'documents.json')), '旧表应已改名');
    assert.ok(fs.existsSync(path.join(dir, 'documents.legacy.json')), '旧表留档备查');

    const raws = kl.listRaws();
    assert.strictEqual(raws.length, 2);
    assert.deepStrictEqual(raws.map((x) => x.legacyId).sort(), ['doc_001', 'doc_002']);
    assert.strictEqual(store.read('chunks', []).length, 3);
    assert.strictEqual(store.read('vectors', []).length, 0, '向量在第 12 步重建，迁移不生成');

    // approved 的那条应当已发布并生效；pending 的那条不生效
    const approved = raws.find((x) => x.legacyId === 'doc_001');
    const pending = raws.find((x) => x.legacyId === 'doc_002');
    const aStd = kl.listStdByRaw(approved.id)[0];
    assert.strictEqual(aStd.status, kl.STD_STATUS.PUBLISHED);
    assert.strictEqual(aStd.isCurrent, true);
    assert.strictEqual(approved.currentStdId, aStd.id);
    assert.strictEqual(aStd.reviewedBy, 'reviewer_li', '审核信息要留痕');
    const pStd = kl.listStdByRaw(pending.id)[0];
    assert.strictEqual(pStd.status, kl.STD_STATUS.PENDING);
    assert.strictEqual(pStd.isCurrent, false);
    // 片段状态跟随版本（不变量 I4）
    for (const c of kl.listChunksByStd(aStd.id)) {
      assert.strictEqual(c.status, kl.STD_STATUS.PUBLISHED);
    }
  });
});

test('迁移执行：旧表已改名后再执行是全 0 no-op；把旧表放回去再跑则全部 skipped（幂等）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    const first = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(first.migrated, 2);

    // 1) 旧表已改名 → 无事可做
    const second = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(second.total, 0);
    assert.strictEqual(second.migrated, 0);
    assert.strictEqual(second.skipped, 0);
    assert.strictEqual(second.chunkCount, 0);
    assert.strictEqual(second.renamed, false);

    // 2) 把旧表放回去（运维手滑 / 从备份恢复）→ 必须全部判重跳过，不产生重复数据
    fs.copyFileSync(path.join(dir, 'documents.legacy.json'), path.join(dir, 'documents.json'));
    store.clearCache();
    const third = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(third.total, 2);
    assert.strictEqual(third.migrated, 0, '幂等：一条都不该重新迁');
    assert.strictEqual(third.skipped, 2);
    assert.strictEqual(kl.listRaws().length, 2, '不能产生重复数据');
    assert.strictEqual(store.read('chunks', []).length, 3);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('迁移执行：数据里有非法业务线导致中途失败 → 抛错、回滚干净、旧表保留可重试', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2({ bizLine: 'nosuchline' })], (dir) => {
    assert.throws(() => mig.migrate({ confirmed: true, silent: true }), /业务线/);
    assert.strictEqual(kl.listRaws().length, 0, '第 1 条也要一起回滚');
    assert.deepStrictEqual(store.read('std_documents', []), []);
    assert.deepStrictEqual(store.read('chunks', []), []);
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')), '失败必须保留旧表，否则没法重试');
    assert.ok(!fs.existsSync(path.join(dir, 'documents.legacy.json')));
  });
});

test('迁移执行：raw 建好之后的步骤失败也要回滚它（否则重试时被判重跳过 → 静默丢数据）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    // 让第 2 条记录在 createChunks 这一步炸掉：此时它的 raw / std 已经落盘
    const orig = kl.createChunks;
    let calls = 0;
    kl.createChunks = (stdId, inputs) => {
      calls += 1;
      if (calls === 2) throw new Error('模拟第 2 条切片写入失败');
      return orig(stdId, inputs);
    };
    try {
      assert.throws(() => mig.migrate({ confirmed: true, silent: true }), /模拟第 2 条/);
    } finally {
      kl.createChunks = orig;
    }

    assert.strictEqual(kl.listRaws().length, 0,
      '半条数据（raw + 空 std）不能残留，否则重试时判重键命中被 skip，片段永久为 0');
    assert.deepStrictEqual(store.read('std_documents', []), []);
    assert.deepStrictEqual(store.read('chunks', []), []);
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')));

    // 重试：两条都要真的迁进来，一条都不能被跳过
    const retry = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(retry.migrated, 2);
    assert.strictEqual(retry.skipped, 0);
    assert.strictEqual(retry.chunkCount, 3);
    assert.deepStrictEqual(kl.checkInvariants(), []);
  });
});

test('迁移执行：完整性自检有违反项时回滚并且**不改名**旧表', () => {
  withMigrateEnv([legacyDoc()], (dir) => {
    // 预先埋一条孤儿片段：自检必然报 I5，且回滚删不掉它（不是本次建的）
    store.write('chunks', [{
      id: 'chk_900', stdId: 'std_missing', rawId: 'raw_missing',
      seq: 1, content: '脏数据', status: 'draft', bizLine: 'trade', securityLevel: 'internal',
    }]);

    assert.throws(
      () => mig.migrate({ confirmed: true, silent: true }),
      (e) => Array.isArray(e.violations) && e.violations.some((v) => v.code === 'I5')
    );
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')), '自检不过必须保留旧表以便修完重试');
    assert.ok(!fs.existsSync(path.join(dir, 'documents.legacy.json')));
    assert.strictEqual(kl.listRaws().length, 0, '本次新建的数据要回滚干净');
    assert.strictEqual(store.read('chunks', []).length, 1, '只剩那条预埋的脏数据');
  });
});

test('迁移闸门：没有显式确认时只打印警告、什么都不做（上传/审核/检索还没接到新结构）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    const r = mig.migrate({ silent: true });
    assert.strictEqual(r.blocked, true, '未确认时必须被闸门挡住');
    assert.strictEqual(r.migrated, 0);
    assert.strictEqual(r.renamed, false);
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')), '旧表一根头发都不能动');
    assert.strictEqual(kl.listRaws().length, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'raw_documents.json')));

    // 显式确认后才真的执行
    const go = mig.migrate({ confirmed: true, silent: true });
    assert.strictEqual(go.blocked, undefined);
    assert.strictEqual(go.migrated, 2);
  });
});
