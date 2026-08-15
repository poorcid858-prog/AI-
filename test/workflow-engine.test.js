/**
 * Workflow 引擎单元测试 —— 任务 1a（Workflow 数据模型与种子数据）
 *
 * 覆盖：
 *   T1. seedIfEmpty 首次调用初始化 4 个种子 Workflow
 *   T2. 各 Workflow 节点结构正确（类型/入口/next 有序）
 *   T3. listWorkflows 返回全部
 *   T4. getWorkflow 按 id 查 / 不存在返回 null
 *   T5. createWorkflow 创建新 Workflow（缺字段报错 / 自动补 createdAt/updatedAt）
 *   T6. updateWorkflow 更新（不存在返回 null）
 *   T7. deleteWorkflow 删除（不存在返回 false）
 *   T8. 数据校验：非法节点类型 / 缺入口节点报错
 *   T9. classifyIntent 意图识别匹配正确 Workflow
 *   T10. executeWorkflow 返回完整执行链路
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../config');
const store = require('../lib/store');

// ============================================================
// 隔离夹具（同步执行！异步会破坏隔离）
// ============================================================

function withTempDataDir(fn) {
  const tmpDir = path.join(os.tmpdir(), `ai-wf-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
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

// ============================================================
// T1. 种子数据初始化
// ============================================================

test('T1: seedIfEmpty 首次调用初始化 4 个种子 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    const out = wf.seedIfEmpty();
    assert.strictEqual(out.seeded, true, '首次应写入种子');
    assert.strictEqual(out.count, 4, '应有 4 个 Workflow');
    assert.strictEqual(wf.listWorkflows().length, 4, 'listWorkflows 应返回 4 个');
  });
});

test('T1b: seedIfEmpty 不会覆盖已有数据', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const out2 = wf.seedIfEmpty();
    assert.strictEqual(out2.seeded, false, '已有数据时不应覆盖');
  });
});

test('T1c: 4 个 Workflow 的 id 正确（wf_prd/wf_test/wf_fe/wf_cs）', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const ids = wf.listWorkflows().map((w) => w.id).sort();
    assert.deepStrictEqual(ids, ['wf_cs', 'wf_fe', 'wf_prd', 'wf_test']);
  });
});

// ============================================================
// T2. 节点结构
// ============================================================

test('T2: 各 Workflow 节点结构正确', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const prd = wf.getWorkflow('wf_prd');
    assert.ok(prd, 'wf_prd 应存在');
    assert.strictEqual(prd.role, 'product');
    assert.strictEqual(prd.status, 'published');
    assert.ok(Array.isArray(prd.nodes) && prd.nodes.length > 0, '应有节点');
    assert.ok(prd.entryNode, '应有入口节点');
    // 入口节点必须存在于 nodes 中
    assert.ok(prd.nodes.some((n) => n.id === prd.entryNode), '入口节点应在 nodes 中');

    // 节点字段齐全
    for (const n of prd.nodes) {
      assert.ok(typeof n.id === 'string' && n.id, '节点应有 id');
      assert.ok(typeof n.type === 'string' && n.type, '节点应有 type');
      assert.ok(typeof n.name === 'string' && n.name, '节点应有 name');
      assert.ok(Array.isArray(n.next), '节点应有 next 数组');
    }
  });
});

test('T2b: wf_test/wf_fe/wf_cs 角色正确', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    assert.strictEqual(wf.getWorkflow('wf_test').role, 'test');
    assert.strictEqual(wf.getWorkflow('wf_fe').role, 'frontend');
    assert.strictEqual(wf.getWorkflow('wf_cs').role, 'cs');
  });
});

// ============================================================
// T3. listWorkflows
// ============================================================

test('T3: listWorkflows 返回全部 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const list = wf.listWorkflows();
    assert.strictEqual(list.length, 4);
    // 每项含核心字段
    for (const w of list) {
      assert.ok(w.id && w.name && w.role && w.status, '应含 id/name/role/status');
      assert.ok(Array.isArray(w.nodes), '应含 nodes');
    }
  });
});

// ============================================================
// T4. getWorkflow
// ============================================================

test('T4: getWorkflow 按 id 查', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    assert.ok(wf.getWorkflow('wf_prd'), 'wf_prd 存在');
    assert.strictEqual(wf.getWorkflow('wf_nonexist'), null, '不存在返回 null');
  });
});

// ============================================================
// T5. createWorkflow
// ============================================================

test('T5: createWorkflow 创建新 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    const created = wf.createWorkflow({
      id: 'wf_custom',
      name: '自定义 Workflow',
      description: '测试自定义',
      role: 'product',
      nodes: [
        { id: 'node_a', type: 'intent', name: '意图', config: {}, next: ['node_b'], condition: null },
        { id: 'node_b', type: 'output', name: '输出', config: {}, next: [], condition: null },
      ],
      entryNode: 'node_a',
    });
    assert.strictEqual(created.id, 'wf_custom');
    assert.strictEqual(created.status, 'draft', '新建默认 draft');
    assert.ok(created.createdAt && created.updatedAt, '应自动补时间戳');
    assert.ok(wf.getWorkflow('wf_custom'), '应能读到');

    // listWorkflows 现在 1 个（未 seed）
    assert.strictEqual(wf.listWorkflows().length, 1);
  });
});

test('T5b: createWorkflow 缺必填字段报错', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    assert.throws(() => wf.createWorkflow({}), /name|role|nodes.*required/i, '缺字段应抛错');
  });
});

test('T5c: createWorkflow 校验非法节点类型', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    assert.throws(() => wf.createWorkflow({
      id: 'wf_bad',
      name: 'x',
      role: 'product',
      nodes: [{ id: 'n1', type: 'unknown_type', name: 'x', next: [], condition: null }],
      entryNode: 'n1',
    }), /type|unknown/i, '非法节点类型应抛错');
  });
});

// ============================================================
// T6. updateWorkflow
// ============================================================

test('T6: updateWorkflow 更新 Workflow 并刷新 updatedAt', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const before = wf.getWorkflow('wf_prd').updatedAt;
    const updated = wf.updateWorkflow('wf_prd', { name: 'PRD 生成 Workflow V2', status: 'disabled' });
    assert.ok(updated, '应返回更新后对象');
    assert.strictEqual(updated.name, 'PRD 生成 Workflow V2');
    assert.strictEqual(updated.status, 'disabled');
    assert.ok(updated.updatedAt >= before, 'updatedAt 应刷新');
  });
});

test('T6b: updateWorkflow 不存在返回 null', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    assert.strictEqual(wf.updateWorkflow('wf_ghost', { name: 'x' }), null);
  });
});

// ============================================================
// T7. deleteWorkflow
// ============================================================

test('T7: deleteWorkflow 删除 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const ok = wf.deleteWorkflow('wf_prd');
    assert.strictEqual(ok, true);
    assert.strictEqual(wf.getWorkflow('wf_prd'), null);
    assert.strictEqual(wf.listWorkflows().length, 3);
  });
});

test('T7b: deleteWorkflow 不存在返回 false', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    assert.strictEqual(wf.deleteWorkflow('wf_ghost'), false);
  });
});

// ============================================================
// T8. 入口节点校验
// ============================================================

test('T8: createWorkflow 校验入口节点必须存在于 nodes', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    assert.throws(() => wf.createWorkflow({
      id: 'wf_missing',
      name: 'x',
      role: 'product',
      nodes: [{ id: 'n1', type: 'intent', name: 'x', next: [], condition: null }],
      entryNode: 'nope',
    }), /entryNode|entry/i, '入口节点不在 nodes 中应抛错');
  });
});

// ============================================================
// T9. 意图识别
// ============================================================

test('T9: classifyIntent 匹配正确 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    // PRD / 需求 → wf_prd
    const r1 = wf.classifyIntent('请帮我生成一个退款流程的PRD', 'product');
    assert.strictEqual(r1.workflowId, 'wf_prd');
    assert.strictEqual(r1.role, 'product');
    assert.ok(r1.taskType);
    assert.ok(r1.confidence > 0, '应有置信度');
  });
});

test('T9b: classifyIntent 测试用例 → wf_test', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const r = wf.classifyIntent('写一组登录功能的测试用例', 'test');
    assert.strictEqual(r.workflowId, 'wf_test');
  });
});

test('T9c: 未知意图按 role 兜底到对应默认 Workflow', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    // 无关键词命中 → 按 role 映射兜底
    const r = wf.classifyIntent('随便聊聊天', 'cs');
    assert.strictEqual(r.workflowId, 'wf_cs', 'cs 角色应兜底到 wf_cs');
    assert.ok(r.confidence <= 0.5, '兜底置信度应较低');
  });
});

// ============================================================
// T10. 执行引擎
// ============================================================

test('T10: executeWorkflow 返回完整执行链路', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const user = { id: 'u_1', role: 'admin', name: 'Admin' };
    const out = wf.executeWorkflow('wf_prd', { userQuestion: '退款流程PRD', role: 'product', user });
    assert.ok(out.ok, '执行应成功');
    assert.ok(out.executionId, '应有 executionId');
    assert.strictEqual(out.workflowId, 'wf_prd');
    assert.ok(out.result, '应有结果内容');
    assert.ok(Array.isArray(out.chain) && out.chain.length > 0, '应有执行链路');
    // 链路每项含节点信息
    for (const step of out.chain) {
      assert.ok(step.nodeId && step.nodeType, '链路每步应含 nodeId/nodeType');
    }
  });
});

test('T10b: 执行不存在的 Workflow 返回错误', () => {
  withTempDataDir(() => {
    const wf = require('../lib/workflow-engine');
    wf.seedIfEmpty();
    const out = wf.executeWorkflow('wf_ghost', { userQuestion: 'x', role: 'product' });
    assert.strictEqual(out.ok, false);
  });
});