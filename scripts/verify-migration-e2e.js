#!/usr/bin/env node
/**
 * 端到端迁移验证脚本 —— 阶段 10
 *
 * 用途：在临时数据目录里跑一遍 scripts/migrate-to-layers.js 的真执行链路，
 *      验证真实 data/documents.json 全部 44 条记录（1 real + 43 garbage）
 *      能成功搬到四层 + checkInvariants 自检全过 + 幂等 + 异常恢复全 OK。
 *
 * 设计：临时改 config.paths.data 到 os.tmpdir()，**不**触碰真实 data/ 目录。
 *      跑完即清理。这是「拆闸门」端到端验收的"沙箱模式"——
 *      真实跑迁移（不改名 documents.json）仍需 PM 决策（写进展.md 顶部 ⚠️）。
 *
 * 流程：
 *   1. 备份 config.paths.data
 *   2. 在 tmpdir 建一个 data 目录，把真实 data/documents.json 复制过去
 *   3. 跑第一次 migrate：44 条全部应迁出，旧表被 rename 为 documents.legacy.json
 *   4. 跑 checkInvariants：应输出 []
 *   5. 跑第二次 migrate（旧表已 rename）：total=0 no-op
 *   6. 跑第三次（把旧表复制回 documents.json 模拟"运维恢复"）：全部 skipped
 *   7. 恢复 config.paths.data + 清理 tmpdir
 *
 * 用法：node scripts/verify-migration-e2e.js
 *      （也可被 `node --test` 之外直接执行；不在 npm scripts 里挂着）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const mig = require('./migrate-to-layers');

function step(n, msg) {
  console.log(`\n[${n}] ${msg}`);
}

function main() {
  const realDataDir = config.paths.data;
  const tmpDir = path.join(os.tmpdir(), `ai-assistant-migrate-e2e-${process.pid}`);
  const realLegacy = path.join(realDataDir, 'documents.json');
  const realArchived = path.join(realDataDir, 'documents.legacy.json');

  // 1. 准备临时数据目录
  step(1, `建临时数据目录: ${tmpDir}`);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.copyFileSync(realLegacy, path.join(tmpDir, 'documents.json'));
  const legacyCount = JSON.parse(fs.readFileSync(path.join(tmpDir, 'documents.json'), 'utf8')).length;
  console.log(`  复制了 ${legacyCount} 条旧记录到临时目录`);

  try {
    config.paths.data = tmpDir;

    // 2. 第一次迁移：应全部迁出
    step(2, '第一次跑 migrate —— 应迁移全部 44 条 + 自检全绿 + 旧表被 rename');
    const r1 = mig.migrate({ silent: true });
    console.log(`  实际: total=${r1.total}, migrated=${r1.migrated}, skipped=${r1.skipped}, chunkCount=${r1.chunkCount}`);
    console.log(`  violations=${JSON.stringify(r1.violations)}, renamed=${r1.renamed}, confirmed=${r1.confirmed}`);
    if (r1.migrated !== legacyCount) {
      throw new Error(`[端到端失败] 第一次迁移 migrate=${r1.migrated}，期望 ${legacyCount}`);
    }
    if (r1.chunkCount !== 43) {
      throw new Error(`[端到端失败] 第一次迁移 chunkCount=${r1.chunkCount}，期望 43（1 real + 43 garbage × 1 chunk）`);
    }
    if (!r1.renamed) {
      throw new Error('[端到端失败] 第一次迁移后旧表未 rename');
    }

    // 3. checkInvariants 自检
    step(3, '跑 checkInvariants —— 应输出 []');
    const kl = require('../lib/knowledge-layers');
    const violations = kl.checkInvariants();
    console.log(`  violations: ${JSON.stringify(violations)}`);
    if (violations.length !== 0) {
      throw new Error(`[端到端失败] checkInvariants 不为空：${violations.length} 项`);
    }
    // 顺带验证：raw / std / chunk / vector 数量符合预期
    const raws = kl.listRaws();
    const allChunks = [];
    for (const raw of raws) {
      for (const std of kl.listStdByRaw(raw.id)) {
        allChunks.push(...kl.listChunksByStd(std.id));
      }
    }
    console.log(`  四层落点: raw=${raws.length}, chunks=${allChunks.length}`);
    if (raws.length !== legacyCount) {
      throw new Error(`[端到端失败] raw 数量 ${raws.length} ≠ ${legacyCount}`);
    }
    if (allChunks.length !== 43) {
      throw new Error(`[端到端失败] chunks 数量 ${allChunks.length} ≠ 43（应与 migrate 返回的 chunkCount 一致）`);
    }

    // 4. 第二次迁移（旧表已 rename）：应是 no-op
    step(4, '第二次跑 migrate（旧表已 rename）—— 应 total=0 no-op');
    const r2 = mig.migrate({ silent: true });
    console.log(`  实际: total=${r2.total}, migrated=${r2.migrated}, renamed=${r2.renamed}`);
    if (r2.total !== 0 || r2.migrated !== 0 || r2.renamed) {
      throw new Error('[端到端失败] 第二次迁移应 no-op');
    }

    // 5. 第三次：把旧表复制回 documents.json 模拟"运维恢复"——应全部 skipped
    step(5, '把 documents.legacy.json 复制回 documents.json（模拟运维恢复），再跑 —— 应全部 skipped');
    fs.copyFileSync(path.join(tmpDir, 'documents.legacy.json'), path.join(tmpDir, 'documents.json'));
    const r3 = mig.migrate({ silent: true });
    console.log(`  实际: total=${r3.total}, migrated=${r3.migrated}, skipped=${r3.skipped}`);
    if (r3.migrated !== 0 || r3.skipped !== legacyCount) {
      throw new Error(`[端到端失败] 第三次迁移应 migrated=0 skipped=${legacyCount}，实际 migrated=${r3.migrated} skipped=${r3.skipped}`);
    }

    // 6. 闸门逃生通道：CONFIRM_MIGRATE=0 等价行为
    step(6, '闸门逃生通道 —— mig.migrate({confirmed:false}) 应 blocked=true no-op');
    const r4 = mig.migrate({ confirmed: false, silent: true });
    console.log(`  实际: blocked=${r4.blocked}, migrated=${r4.migrated}, renamed=${r4.renamed}`);
    if (!r4.blocked || r4.migrated !== 0) {
      throw new Error('[端到端失败] confirmed=false 应 blocked');
    }

    console.log('\n✅ 端到端验证全过');
    console.log('   - 44 条真实数据可成功迁移到四层 + 自检全绿');
    console.log('   - 幂等 no-op / 运维恢复全部 skipped / 闸门逃生 blocked 三路径都正确');
    console.log('   - 真实 data/documents.json 一根头发未动（已用 tmpDir 隔离）');
  } finally {
    config.paths.data = realDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[清理] 临时目录已删: ${tmpDir}`);
    console.log(`[真实数据状态] documents.json 存在=${fs.existsSync(realLegacy)}, documents.legacy.json 存在=${fs.existsSync(realArchived)}`);
  }
}

main();
