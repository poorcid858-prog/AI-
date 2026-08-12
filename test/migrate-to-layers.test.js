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

test('迁移判重键：按 legacyId 优先，fallback 到 id/fileName/title —— 缺文件名也能算同一个键', () => {
  const k1 = mig.legacyKey(legacyDoc());
  const k2 = mig.legacyKey(legacyDoc());
  assert.strictEqual(k1, k2, '同一条旧记录必须得到同一个键（幂等的基础）');

  const k3 = mig.legacyKey(legacyDoc({ createdAt: '2026-02-02T00:00:00.000Z' }));
  assert.notStrictEqual(k1, k3);

  const k4 = mig.legacyKey(legacyDoc({ fileName: null }));
  assert.ok(k4.includes('doc_001'), '无文件名时 fallback 到旧 id 判重');
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

test('迁移闸门：闸门已降级 —— 不传 opts 直接执行，confirmed=false 才跳过（CI 调试用）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    // 1) 不传 confirmed → 默认执行（旧行为是挡住，新行为是直接跑）
    const run = mig.migrate({ silent: true });
    assert.strictEqual(run.blocked, undefined, '默认不再被闸门挡住');
    assert.strictEqual(run.confirmed, true, '默认即为已确认');
    assert.strictEqual(run.migrated, 2, '默认应当执行迁移');
    assert.strictEqual(run.renamed, true);

    // 2) 显式 confirmed=false → 跳过（对应 CONFIRM_MIGRATE=0）
    const skip = mig.migrate({ confirmed: false, silent: true });
    assert.strictEqual(skip.blocked, true, '显式跳过时仍打 blocked 标识');
    assert.strictEqual(skip.migrated, 0);
    assert.strictEqual(skip.skipped, 0);
    assert.strictEqual(skip.renamed, false);
  });
});

// ============================================================
// 阶段 8 补充：legacyKey 幂等性 bug + 闸门降级
// ============================================================

/**
 * 35 条样本，贴近真实 data/documents.json 的分布（1 有 fileName=test.md，其余无 fileName）。
 * 用来测"重跑迁移"场景下 legacyId 优先判重是否真能命中已建好的 raw。
 */
function legacyDocs35() {
  const out = [];
  for (let i = 1; i <= 35; i++) {
    const id = `doc_${String(i).padStart(3, '0')}`;
    out.push(legacyDoc({
      id,
      title: `文档${i}`,
      fileName: i === 1 ? 'test.md' : null,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i - 1, 0)).toISOString(),
    }));
  }
  return out;
}

test('【阶段 8 / t1】迁移执行：35 条旧数据第一次跑 → 建 35 raw，migrated=35', () => {
  withMigrateEnv(legacyDocs35(), (dir) => {
    const r = mig.migrate({ silent: true });
    assert.strictEqual(r.migrated, 35, '默认应直接执行迁移，35 条全部迁出');
    assert.strictEqual(r.skipped, 0);
    assert.strictEqual(r.confirmed, true, '闸门降级后默认即为已确认');
    assert.strictEqual(kl.listRaws().length, 35, 'raw_documents 应有 35 条');
  });
});

test('【阶段 8 / t2】迁移执行：35 条旧数据第二次跑（同名 legacy 仍存在）→ 全部 skipped，不建新 raw', () => {
  withMigrateEnv(legacyDocs35(), (dir) => {
    const r1 = mig.migrate({ silent: true });
    assert.strictEqual(r1.migrated, 35);

    // 模拟"运维从备份恢复 documents.json / 脚本重跑"：旧表被放回去
    fs.copyFileSync(path.join(dir, 'documents.legacy.json'), path.join(dir, 'documents.json'));
    store.clearCache();

    const r2 = mig.migrate({ silent: true });
    assert.strictEqual(r2.migrated, 0, '第二次跑不能再造 35 个孤儿 raw');
    assert.strictEqual(r2.skipped, 35, '35 条必须全部通过 legacyId 判重命中');
    assert.strictEqual(kl.listRaws().length, 35, '总数不变');
  });
});

test('【阶段 8 / t3】迁移执行：doc_001 + fileName=test.md 单独验证 legacyId 优先判重命中（幂等）', () => {
  const doc = legacyDoc({ id: 'doc_001', fileName: 'test.md' });
  withMigrateEnv([doc], (dir) => {
    const r1 = mig.migrate({ silent: true });
    assert.strictEqual(r1.migrated, 1);
    const raws1 = kl.listRaws();
    assert.strictEqual(raws1.length, 1);
    assert.strictEqual(raws1[0].legacyId, 'doc_001');

    // 把旧表放回去
    fs.copyFileSync(path.join(dir, 'documents.legacy.json'), path.join(dir, 'documents.json'));
    store.clearCache();

    const r2 = mig.migrate({ silent: true });
    assert.strictEqual(r2.migrated, 0);
    assert.strictEqual(r2.skipped, 1, 'doc_001 必须命中已建好的 raw（legacyId 优先对齐）');
    assert.strictEqual(kl.listRaws().length, 1, '无孤儿');
  });
});

test('【阶段 8 / t4】迁移执行：不传任何 opts 也直接执行迁移（闸门降级为默认 execute）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    const r = mig.migrate({ silent: true });
    assert.strictEqual(r.migrated, 2, '默认直接执行，不需要任何确认');
    assert.strictEqual(r.skipped, 0);
    assert.strictEqual(r.renamed, true);
    assert.strictEqual(r.confirmed, true, '返回里要带 confirmed:true 标识');
    assert.strictEqual(r.blocked, undefined, '不再有 blocked 状态');
    assert.ok(!fs.existsSync(path.join(dir, 'documents.json')), '旧表已改名');
  });
});

test('【阶段 8 / t5】迁移执行：confirmed=false 显式跳过（CONFIRM_MIGRATE=0 路径），不写库', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    const r = mig.migrate({ confirmed: false, silent: true });
    assert.strictEqual(r.migrated, 0);
    assert.strictEqual(r.skipped, 0);
    assert.strictEqual(r.renamed, false);
    assert.ok(fs.existsSync(path.join(dir, 'documents.json')), '旧表一根头发都不能动');
    assert.strictEqual(kl.listRaws().length, 0);
    assert.ok(!fs.existsSync(path.join(dir, 'raw_documents.json')));
  });
});

test('【阶段 8 / t6】迁移执行：闸门挡住需显式设置 confirmed=false（不再默认拦截）', () => {
  withMigrateEnv([legacyDoc(), legacyDoc2()], (dir) => {
    // 不传 confirmed → 不再被闸门挡住，直接执行
    const noOpts = mig.migrate({ silent: true });
    assert.strictEqual(noOpts.blocked, undefined, '默认不再有 blocked');
    assert.strictEqual(noOpts.migrated, 2);

    // 显式 confirmed=false → 才会被闸门挡住（CI 调试用）
    const explicitSkip = mig.migrate({ confirmed: false, silent: true });
    assert.strictEqual(explicitSkip.migrated, 0);
    assert.strictEqual(explicitSkip.skipped, 0);
    assert.strictEqual(explicitSkip.renamed, false);
  });
});
