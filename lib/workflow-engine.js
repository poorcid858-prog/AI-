/**
 * Workflow 引擎 —— 数据模型 + CRUD + 种子数据 + 执行引擎（任务 1a/1b）
 *
 * 这是整条 AI 执行链路的核心编排引擎。Workflow 定义"一次 AI 任务怎么组织"
 * —— 节点顺序、条件分支、调用哪些能力（Skill/RAG/Reference/Prompt/LLM/QC）。
 * Workflow 本身不生产内容，只负责流程控制。
 *
 * 设计要点：
 *   - 数据存 data/workflows.json，复用 lib/store.js
 *   - 首启动 seedIfEmpty() 写 4 个种子 Workflow（product/test/frontend/cs）
 *   - 节点类型：intent / skill / rag / reference / prompt / llm / qc / output
 *   - executeWorkflow 按 entryNode 从节点图顺序执行，产出 chain（执行链路）
 *     + result（最终输出）
 *   - classifyIntent 做 mock 意图识别（关键词匹配 → 路由到对应 Workflow）
 *   - mock 模式不连真实 LLM，用 skill/llm 节点的确定逻辑生成模拟输出
 *
 * 零新依赖：仅用 store / rag-engine / prompt-engine / capability-engine。
 */

'use strict';

const store = require('./store');

const WORKFLOWS_FILE = 'workflows';

/** 合法节点类型 */
const NODE_TYPES = new Set([
  'intent', 'skill', 'rag', 'reference', 'prompt', 'llm', 'qc', 'output',
]);

/** 合法 Workflow 状态 */
const WF_STATUS = new Set(['draft', 'published', 'disabled']);

// ============================================================
// 1. 种子数据（4 个角色各一个）
// ============================================================

/** 每个种子 Workflow 的公共节点模板，按角色差异填充 */
function buildSeed(role) {
  const now = new Date().toISOString();
  const map = {
    product: {
      id: 'wf_prd',
      name: 'PRD 生成 Workflow',
      description: '面向产品经理：整理需求、检索知识、输出 PRD 需求文档',
      role: 'product',
      skillName: '需求分析',
      skillDesc: '对用户需求进行结构化分析，提取业务规则、功能点、异常场景',
    },
    test: {
      id: 'wf_test',
      name: '测试用例生成 Workflow',
      description: '面向测试工程师：分析功能、检索知识、输出测试用例',
      role: 'test',
      skillName: '测试分析',
      skillDesc: '分析功能主流程、边界、异常与接口，规划覆盖清单',
    },
    frontend: {
      id: 'wf_fe',
      name: '组件设计 Workflow',
      description: '面向前端工程师：分析需求、检索知识、输出组件设计与实现建议',
      role: 'frontend',
      skillName: '组件分析',
      skillDesc: '分析交互、状态、响应式与可访问性，规划组件拆分',
    },
    cs: {
      id: 'wf_cs',
      name: '客服应答 Workflow',
      description: '面向客服专员：识别问题、检索知识、输出客服应答话术',
      role: 'cs',
      skillName: '问题识别',
      skillDesc: '识别客户问题场景、痛点，规划标准答复与转人工判断',
    },
  };
  const cfg = map[role] || map.product;

  return {
    id: cfg.id,
    name: cfg.name,
    description: cfg.description,
    role: cfg.role,
    status: 'published',
    entryNode: 'node_1_intent',
    nodes: [
      { id: 'node_1_intent', type: 'intent', name: '意图识别',
        config: {}, next: ['node_2_skill'], condition: null },
      { id: 'node_2_skill', type: 'skill', name: cfg.skillName,
        config: { skillName: cfg.skillName, description: cfg.skillDesc },
        next: ['node_3_rag'], condition: null },
      { id: 'node_3_rag', type: 'rag', name: '知识检索 (RAG)',
        config: { topK: 5 }, next: ['node_4_reference'], condition: null },
      { id: 'node_4_reference', type: 'reference', name: '参考资料',
        config: {}, next: ['node_5_prompt'], condition: null },
      { id: 'node_5_prompt', type: 'prompt', name: 'Prompt 组装',
        config: {}, next: ['node_6_llm'], condition: null },
      { id: 'node_6_llm', type: 'llm', name: 'LLM 生成',
        config: {}, next: ['node_7_qc'], condition: null },
      { id: 'node_7_qc', type: 'qc', name: '质量检查',
        config: {}, next: ['node_8_output'], condition: null },
      { id: 'node_8_output', type: 'output', name: '输出结果',
        config: {}, next: [], condition: null },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/** 生成全部 4 个种子 Workflow */
function seedData() {
  return ['product', 'test', 'frontend', 'cs'].map(buildSeed);
}

/**
 * 首次启动写入种子数据。已有数据时**不**覆盖。
 * @returns {{seeded: boolean, count: number}}
 */
function seedIfEmpty() {
  const existing = store.read(WORKFLOWS_FILE, []);
  if (Array.isArray(existing) && existing.length > 0) {
    return { seeded: false, count: existing.length };
  }
  store.write(WORKFLOWS_FILE, seedData());
  return { seeded: true, count: 4 };
}

// ============================================================
// 2. 校验器
// ============================================================

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

/** 校验一个节点对象结构；非法抛错 */
function validateNode(node) {
  if (!node || typeof node !== 'object') throw fail('节点必须是对象', 400);
  if (typeof node.id !== 'string' || !node.id) throw fail('节点必须有 id', 400);
  if (!NODE_TYPES.has(node.type)) {
    throw fail(`未知节点类型: ${node.type || '(空)'}（合法: ${[...NODE_TYPES].join('/')}）`, 400);
  }
  if (typeof node.name !== 'string' || !node.name) throw fail(`节点 ${node.id} 必须有 name`, 400);
  if (!Array.isArray(node.next)) throw fail(`节点 ${node.id} 必须有 next 数组`, 400);
}

/** 校验整个 Workflow 输入；非法抛错 */
function validateWorkflow(input) {
  const it = input || {};
  if (!it.name || typeof it.name !== 'string') throw fail('缺少 name 字段', 400);
  if (!it.role || typeof it.role !== 'string') throw fail('缺少 role 字段', 400);
  if (!Array.isArray(it.nodes) || it.nodes.length === 0) {
    throw fail('缺少 nodes 数组', 400);
  }
  for (const n of it.nodes) validateNode(n);
  if (!it.entryNode) throw fail('缺少 entryNode 字段', 400);
  if (!it.nodes.some((n) => n.id === it.entryNode)) {
    throw fail(`入口节点 entryNode=${it.entryNode} 不在 nodes 中`, 400);
  }
}

// ============================================================
// 3. CRUD
// ============================================================

/**
 * 读取所有 Workflow。文件为空或损坏时返回 []。
 * @returns {Array}
 */
function listWorkflows() {
  const list = store.read(WORKFLOWS_FILE, []);
  return Array.isArray(list) ? list : [];
}

/** 按 id 查单个 Workflow；不存在返回 null */
function getWorkflow(id) {
  if (!id) return null;
  return listWorkflows().find((w) => w && w.id === id) || null;
}

/**
 * 创建新 Workflow。校验通过后 push，默认 status=draft。
 * @param {object} input { id?, name, description?, role, nodes[], entryNode, status? }
 * @returns {object} 新 Workflow
 */
function createWorkflow(input) {
  validateWorkflow(input);
  const now = new Date().toISOString();
  const created = {
    id: input.id || store.nextId(WORKFLOWS_FILE, 'wf'),
    name: input.name,
    description: input.description || '',
    role: input.role,
    status: WF_STATUS.has(input.status) ? input.status : 'draft', // 新建默认 draft
    nodes: input.nodes,
    entryNode: input.entryNode,
    createdAt: now,
    updatedAt: now,
  };
  const list = listWorkflows();
  list.push(created);
  store.write(WORKFLOWS_FILE, list);
  return created;
}

/**
 * 更新 Workflow。不存在返回 null。
 * 允许部分更新（只合并传入的字段）。
 * @returns {object|null}
 */
function updateWorkflow(id, patch) {
  const list = listWorkflows();
  const idx = list.findIndex((w) => w && w.id === id);
  if (idx === -1) return null;
  const it = patch || {};
  const updated = {
    ...list[idx],
    ...it,
    id,
    updatedAt: new Date().toISOString(),
  };
  list[idx] = updated;
  store.write(WORKFLOWS_FILE, list);
  return updated;
}

/**
 * 删除 Workflow。返回是否删除成功。
 * @returns {boolean}
 */
function deleteWorkflow(id) {
  const list = listWorkflows();
  const next = list.filter((w) => w && w.id !== id);
  if (next.length === list.length) return false;
  store.write(WORKFLOWS_FILE, next);
  return true;
}

// ============================================================
// 4. 意图识别（mock）
// ============================================================

/** 角色 → 默认兜底 Workflow id */
const ROLE_DEFAULT_WF = {
  product: 'wf_prd',
  test: 'wf_test',
  frontend: 'wf_fe',
  cs: 'wf_cs',
};

/**
 * 关键词 → Workflow 路由规则。
 * 每个 role 一组关键词，命中即路由到对应 Workflow。
 */
const INTENT_KEYWORDS = {
  product: [
    { keys: ['prd', '需求文档', '需求书', '需求分析', '写一份', '生成prd'],
      taskType: 'PRD生成', workflowId: 'wf_prd' },
    { keys: ['用户故事', '需求评审', '验收标准', '用户画像'],
      taskType: '需求分析', workflowId: 'wf_prd' },
  ],
  test: [
    { keys: ['测试用例', '测试案例', '用例', 'test', '测试计划'],
      taskType: '测试用例生成', workflowId: 'wf_test' },
    { keys: ['边界', '异常', '兼容性', '性能测试', '接口测试'],
      taskType: '测试分析', workflowId: 'wf_test' },
  ],
  frontend: [
    { keys: ['组件', '前端', '页面', '响应式', '布局', '交互'],
      taskType: '组件设计', workflowId: 'wf_fe' },
    { keys: ['状态管理', '性能优化', '加载', '缓存'],
      taskType: '前端优化', workflowId: 'wf_fe' },
  ],
  cs: [
    { keys: ['退款', '物流', '优惠券', '发票', '售后', '退换'],
      taskType: '客服应答', workflowId: 'wf_cs' },
    { keys: ['咨询', '问题', '请问'],
      taskType: '客服咨询', workflowId: 'wf_cs' },
  ],
};

/**
 * 模拟意图识别：基于关键词匹配把用户问题路由到对应 Workflow。
 *
 * @param {string} userQuestion 用户自然语言
 * @param {string} role 当前角色（product/test/frontend/cs）
 * @returns {object} {
 *   taskType, confidence, role, workflowId, entities
 * }
 */
function classifyIntent(userQuestion, role) {
  const q = String(userQuestion || '').toLowerCase();
  const rules = INTENT_KEYWORDS[role] || INTENT_KEYWORDS.product;

  for (const r of rules) {
    const matched = r.keys.some((k) => q.includes(k.toLowerCase()));
    if (matched) {
      return {
        taskType: r.taskType,
        confidence: 0.88,
        role,
        workflowId: r.workflowId,
        entities: [],
      };
    }
  }

  // 无命中 → 按 role 兜底到默认 Workflow，置信度降低
  return {
    taskType: role === 'cs' ? '客服咨询' : '通用生成',
    confidence: 0.45,
    role,
    workflowId: ROLE_DEFAULT_WF[role] || ROLE_DEFAULT_WF.product,
    entities: [],
  };
}

// ============================================================
// 5. 执行引擎
// ============================================================

/**
 * 执行一个 Workflow 节点，并把输出合并进 context。
 * @param {object} node 节点定义
 * @param {object} context 执行上下文 { userQuestion, role, bizLine, user, ... }
 * @returns {object} 节点输出 { ok, output, content?, ragChunks?, ... }
 */
function executeNode(node, context) {
  const { userQuestion, role, bizLine, user } = context || {};
  switch (node.type) {
    case 'intent': {
      // 意图识别在外层 classifyIntent 已完成，这里把结果写进 context
      const intent = context.intent || classifyIntent(userQuestion, role);
      context.intent = intent;
      return { ok: true, nodeId: node.id, output: intent };
    }
    case 'skill': {
      const name = (node.config && node.config.skillName) || node.name;
      const desc = (node.config && node.config.description) || '';
      const output = `[Skill: ${name}] ${desc}\n基于需求「${userQuestion}」进行专业分析。`;
      context.skillResult = output;
      return { ok: true, nodeId: node.id, name, output };
    }
    case 'rag': {
      // 调用 RAG 引擎检索（权限隔离在 rag-engine 内部强制）
      let chunks = [];
      try {
        const rag = require('./rag-engine');
        const index = rag.loadApprovedIndex();
        chunks = rag.retrieve(user, userQuestion, index,
          (node.config && node.config.topK) || 5);
        chunks = chunks.map((c) => ({
          id: c.id,
          heading: c.heading,
          content: c.content,
          score: c.score,
          docId: c.docId,
        }));
      } catch (_) { /* RAG 失败静默降级到 [] */ }
      context.ragChunks = chunks;
      return { ok: true, nodeId: node.id, output: chunks };
    }
    case 'reference': {
      // 从 prompt-engine 拿角色 skill 定义作为基础 Reference
      let refs = [];
      try {
        const pe = require('./prompt-engine');
        const skill = pe.getSkillPrompt(role);
        refs = [{
          name: skill.title,
          type: 'skill',
          content: skill.description,
        }];
      } catch (_) { refs = []; }
      context.references = refs;
      return { ok: true, nodeId: node.id, output: refs };
    }
    case 'prompt': {
      // 分层组装 Prompt：角色 → Workflow → Skill → Reference → RAG → 用户输入
      let promptText = '';
      try {
        const pe = require('./prompt-engine');
        promptText = pe.assemblePrompt({
          role,
          bizLine,
          userQuestion,
          ragChunks: context.ragChunks || [],
        });
      } catch (_) {
        promptText = `[角色] ${role}\n[问题] ${userQuestion}`;
      }
      context.promptText = promptText;
      return { ok: true, nodeId: node.id, output: promptText };
    }
    case 'llm': {
      // mock 模式：用确定性规则生成模拟输出
      const content = generateMockOutput(role, userQuestion, context);
      context.llmResult = content;
      return { ok: true, nodeId: node.id, output: content };
    }
    case 'qc': {
      const score = 8; // mock 质量分
      const output = { passed: true, score, issues: [] };
      context.qualityCheck = output;
      return { ok: true, nodeId: node.id, output };
    }
    case 'output': {
      return { ok: true, nodeId: node.id, output: context.promptText || context.llmResult || '' };
    }
    default:
      return { ok: false, nodeId: node.id, output: null, error: `未知节点类型 ${node.type}` };
  }
}

/** 生成 mock 模式的模拟 LLM 输出（确定性，便于测试） */
function generateMockOutput(role, userQuestion, context) {
  const skillName = (context.skillResult || '').toString();
  const ragCount = (context.ragChunks || []).length;
  return [
    `## 模拟输出（${role}）`,
    ``,
    `基于您的需求：${userQuestion}`,
    ``,
    `### 需求分析`,
    `根据意图识别，本次任务的核心是完成一次「${(context.intent && context.intent.taskType) || 'AI 任务'}」。`,
    skillName ? `\n> ${skillName.split('\n')[0]}` : '',
    ``,
    `### 知识引用`,
    ragCount > 0
      ? `检索到 ${ragCount} 条相关知识，已作为上下文注入。`
      : `本次未检索到相关知识（知识库可能为空或权限不足）。`,
    ``,
    `### 方案输出`,
    `（mock 模式下为结构化模拟内容，接入真实 LLM 后生成真实结果。）`,
    ``,
    `---`,
    `*生成时间：${new Date().toISOString()}*`,
  ].filter(Boolean).join('\n');
}

/** 记录当前节点执行信息到链路 */
function recordStep(context, node, stepResult, startTs) {
  context.chain.push({
    nodeId: node.id,
    nodeType: node.type,
    nodeName: node.name,
    latencyMs: Date.now() - startTs,
    output: stepResult.output,
    ok: stepResult.ok !== false,
  });
}

/**
 * 核心执行引擎：从 entryNode 开始按节点图顺序执行，产出完整链路 + 最终结果。
 *
 * @param {string} workflowId Workflow id
 * @param {object} params { userQuestion, role, bizLine, user, intent? }
 * @returns {object} {
 *   ok, executionId, workflowId, result, chain[], nodes[]
 * }
 */
function executeWorkflow(workflowId, params) {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    return { ok: false, error: `Workflow 不存在: ${workflowId}` };
  }
  if (workflow.status !== 'published' && workflow.status !== 'draft') {
    return { ok: false, error: `Workflow ${workflowId} 已禁用` };
  }

  const it = params || {};
  const context = {
    userQuestion: it.userQuestion || '',
    role: it.role || workflow.role || 'product',
    bizLine: it.bizLine || 'trade',
    user: it.user || null,
    intent: it.intent || null,
    ragChunks: [],
    references: [],
    promptText: null,
    skillResult: null,
    llmResult: null,
    qualityCheck: null,
    chain: [],
  };

  const executionId = `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startAll = Date.now();

  // 从入口节点开始，沿 next 顺序执行（简单顺序遍历，循环保护）
  let nodeId = workflow.entryNode;
  const visited = new Set();
  const maxSteps = workflow.nodes.length * 3 + 10; // 防止环死循环

  while (nodeId && visited.size < maxSteps) {
    if (visited.has(nodeId)) {
      // 已访问过 → 视为环，跳到 next 或退出
      const node = getNodeById(workflow, nodeId);
      const nx = (node && node.next && node.next[0]) || null;
      if (!nx || visited.has(nx)) break;
      nodeId = nx;
      continue;
    }
    visited.add(nodeId);
    const node = getNodeById(workflow, nodeId);
    if (!node) break;

    const startNode = Date.now();
    const stepResult = executeNode(node, context);
    recordStep(context, node, stepResult, startNode);

    // 条件分支：若命中 condition.next，则走分支
    if (node.condition && node.condition.next) {
      nodeId = node.condition.next;
    } else if (Array.isArray(node.next) && node.next.length > 0) {
      nodeId = node.next[0];
    } else {
      nodeId = null; // 无后继 → 结束
    }
  }

  // 最终输出 = llmResult（或最后一个节点的输出）
  const finalOutput = context.llmResult
    || (context.chain.length > 0 && context.chain[context.chain.length - 1].output)
    || '';

  return {
    ok: true,
    executionId,
    workflowId,
    role: context.role,
    result: finalOutput,
    chain: context.chain,
    nodes: workflow.nodes,
    intent: context.intent,
    ragChunks: context.ragChunks,
    references: context.references,
    promptText: context.promptText,
    llmResult: context.llmResult,
    qualityCheck: context.qualityCheck,
    qualityScore: context.qualityCheck ? context.qualityCheck.score : null,
    latencyMs: Date.now() - startAll,
  };
}

/** 按 id 取 workflow 内节点 */
function getNodeById(workflow, nodeId) {
  return (workflow.nodes || []).find((n) => n.id === nodeId) || null;
}

module.exports = {
  // CRUD
  listWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  seedIfEmpty,
  seedData,
  // 意图识别
  classifyIntent,
  ROLE_DEFAULT_WF,
  // 执行引擎
  executeWorkflow,
  executeNode,
  generateMockOutput,
  // 常量
  NODE_TYPES,
  WF_STATUS,
};