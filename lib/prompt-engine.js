/**
 * Prompt 组装引擎 —— 需求 4 B3（动态 few-shot）+ 完整 skill 框架（plan 第 8 步）
 *
 * 职责：
 *   1) buildDynamicFewShot —— 从 data/qa-examples.json 按"语义"检索 top N 优秀问答对
 *      作为动态 few-shot，输出格式化字符串数组
 *   2) assemblePrompt —— 主组装函数，把 [角色设定] / [Few-shot] / [RAG] / [用户问题] 等段拼成完整 prompt
 *   3) getSkillPrompt —— 按角色返回该角色的 skill 定义（PRD/测试用例/组件/客服）
 *
 * 设计要点：
 *   - 复用 lib/vector-store.js 的 TF-IDF + 余弦相似度（**不**自己重写）
 *   - 复用 lib/store.js 读 qa-examples（缓存友好，错误时 fallback 到空）
 *   - 全部异常路径（文件不存在 / JSON 损坏 / 字段缺失 / role 不匹配 / 无相似命中）静默降级到 []
 *   - 4 个 skill 各有独立的角色设定 + 任务描述 + 输出格式约束
 *   - role 严格匹配（===），不做模糊
 *   - 阈值 0.3 默认（防噪声 / 防注入）
 *   - 静态 few-shot 保留 1-2 条，动态 few-shot 紧跟其后
 *
 * 零新依赖：仅用项目内已有的 store / vector-store / config。
 */

"use strict";

const store = require("./store");
const vectorStore = require("./vector-store");

// ============================================================
// Skill 定义（4 个角色）
// ============================================================

const SKILLS = {
  product: {
    role: "product",
    title: "产品经理",
    description: "专业的产品经理，擅长编写 PRD 文档、需求评审、用户故事、验收标准。",
    outputFormat: `
输出格式：Markdown 结构
1. 需求背景与目标
2. 功能范围
3. 业务流程（含流程图描述）
4. 页面设计
5. 字段说明
6. 异常流程
7. 验收标准（性能 / 兼容性 / 安全）
    `.trim(),
  },
  test: {
    role: "test",
    title: "测试工程师",
    description: "专业的测试工程师，擅长编写测试用例、边界分析、覆盖率规划、自动化测试。",
    outputFormat: `
输出格式：Markdown 结构
1. 功能测试（主流程 / 分支流程）
2. 边界测试（参数边界 / 数据边界）
3. 异常测试（错误处理 / 容错能力）
4. 兼容性测试（浏览器 / 移动设备 / 网络）
5. 性能测试（响应时间 / 吞吐量）
6. 安全测试（权限控制 / 数据校验）
7. 回归测试清单
    `.trim(),
  },
  frontend: {
    role: "frontend",
    title: "前端工程师",
    description: "专业的前端工程师，擅长组件封装、响应式设计、状态管理、可访问性。",
    outputFormat: `
输出格式：Markdown 结构
1. 组件设计与分解
2. 状态管理方案
3. 交互设计细节
4. 响应式设计（桌面 / 平板 / 移动）
5. 可访问性要求（WCAG）
6. 性能优化（懒加载 / 缓存 / 代码分割）
7. 浏览器兼容性
    `.trim(),
  },
  cs: {
    role: "cs",
    title: "客服代表",
    description: "专业的客服代表，以用户的语言和痛点出发，提供简洁、亲切的解决方案。",
    outputFormat: `
输出格式：Markdown 结构
1. 问题场景识别
2. 解决步骤（逐步指导）
3. 常见衍生问题
4. 何时转人工客服
5. 常用快捷回复模板
6. 用户满意度检查点
    `.trim(),
  },
};

// ============================================================
// 1. 读 qa-examples 顶层
// ============================================================

/** qa-examples.json 的空文档形态（store.read 拿不到文件 / JSON 损坏时 fallback） */
function emptyExamplesDoc() {
  return { version: 1, updatedAt: new Date().toISOString(), examples: [] };
}

/**
 * 安全读 qa-examples.json。store.read 已有文件不存在 / JSON 损坏的兜底，
 * 这里再补一道"examples 字段不是数组"防御。
 */
function readExamples() {
  let v;
  try {
    v = store.read("qa-examples", emptyExamplesDoc());
  } catch (_) {
    return emptyExamplesDoc();
  }
  if (!v || typeof v !== "object" || !Array.isArray(v.examples)) {
    return emptyExamplesDoc();
  }
  return v;
}

// ============================================================
// 2. 动态 few-shot 检索
// ============================================================

/**
 * 从 qa-examples.json 检索 top N 与 question 语义最相似的 examples。
 *
 * 算法：
 *   1) 读 qa-examples → 过滤 example.role === role（严格匹配）
 *   2) 用 vector-store.buildIndex 建索引（以 example.question 为语料）
 *   3) vectorize(question) + cosine 求相似度
 *   4) 过滤 score > threshold，按 score 倒序，取前 n
 *   5) 格式化为 `[示例 Q]: ...\n[示例 A]: ...\n---\n` 字符串
 *
 * @param {string} question  用户问题
 * @param {string} role      当前用户角色（product / test / frontend / cs）
 * @param {number} n         返回 top N，默认 3
 * @param {number} threshold 相似度阈值（> 此值才入选），默认 0.3
 * @returns {string[]} 格式化后的 few-shot 数组（空数组 = 静默降级，调用方按"无 few-shot"处理）
 */
function buildDynamicFewShot(question, role, n = 3, threshold = 0.3) {
  // 输入校验：空问题 / 空 role → 直接 []
  if (typeof question !== "string" || !question.trim() || !role) return [];
  if (typeof n !== "number" || n <= 0) return [];

  // 1) 读 + 过滤 role
  const doc = readExamples();
  const candidates = doc.examples.filter(
    (e) =>
      e &&
      e.role === role &&
      typeof e.question === "string" &&
      e.question.trim() &&
      typeof e.answer === "string" &&
      e.answer.trim()
  );
  if (candidates.length === 0) return [];

  // 2) 用 vector-store 建索引（content = example.question）
  const chunks = candidates.map((e) => ({
    id: e.id,
    content: e.question,
    heading: null,
    keywords: [],
    fingerprint: `qa-ex-${e.id}`,
  }));

  let index;
  try {
    index = vectorStore.buildIndex(chunks);
  } catch (_) {
    return [];
  }
  if (!index || !Array.isArray(index.vectors) || index.vectors.length === 0) return [];

  // 3) 向量化 query + 计算每条候选的相似度
  let qVec;
  try {
    qVec = vectorStore.vectorize(question, index.vocab, index.idfMap);
  } catch (_) {
    return [];
  }

  // 4) 过滤阈值 + 排序 + top n
  const scored = candidates
    .map((e, i) => ({
      example: e,
      score: vectorStore.cosine(qVec, index.vectors[i].vec),
    }))
    .filter((s) => s.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);

  // 5) 格式化（稳定顺序：分数相同按 candidates 原顺序，JS Array.sort 是稳定排序）
  return scored.map(({ example }) => {
    return `[示例 Q]: ${example.question}\n[示例 A]: ${example.answer}\n---\n`;
  });
}

// ============================================================
// 3. Skill 提取
// ============================================================

/**
 * 按角色返回该角色的 skill 定义（包含角色设定、任务、输出格式）。
 * 用于 assemblePrompt 时的 staticFewShot 前缀。
 *
 * @param {string} role 角色（product / test / frontend / cs）
 * @returns {object} skill 对象，含 { description, outputFormat, ... }
 */
function getSkillPrompt(role) {
  return SKILLS[role] || SKILLS.product; // 默认回退到 product
}

// ============================================================
// 4. 主组装函数
// ============================================================

/**
 * 组装完整 Prompt —— 主组装函数
 *
 * 输入：{ role, bizLine, userQuestion, ragChunks, ... }
 * 输出：完整 prompt 字符串
 *
 * 段结构（与《技术方案-聊天控制台.md》2.2 一致）：
 *   [角色设定]
 *   [Few-shot 示例]  ← 静态（skill 定义） + 动态 top 3（从 qa-examples 按语义检索）
 *   [RAG 召回]
 *   [用户问题]
 *
 * 健壮性：所有底层失败都静默降级 —— 动态 few-shot 取不到就只用静态，RAG 召回为空就省略该段。
 *
 * @param {object} params
 * @param {string} [params.role='product']         当前用户角色
 * @param {string} [params.bizLine='all']          业务线
 * @param {string} [params.userQuestion='']        用户问题
 * @param {Array<{heading?:string, content:string}>} [params.ragChunks=[]]
 * @returns {string} 完整 prompt
 */
function assemblePrompt(params = {}) {
  const {
    role = "product",
    bizLine = "all",
    userQuestion = "",
    ragChunks = [],
  } = params || {};

  // 获取该角色的 skill 定义
  const skill = getSkillPrompt(role);

  // 静态 few-shot（skill 定义中的描述 + 输出格式）
  const staticFewShot = [
    `[${skill.title}设定] ${skill.description}`,
    `[输出格式要求]\n${skill.outputFormat}`,
  ];

  // 动态 few-shot（异常路径已静默降级到 []）
  const dynamicFewShot = buildDynamicFewShot(userQuestion, role);

  // Few-shot 段：静态 + 动态
  const fewShotBlock = [...staticFewShot, ...dynamicFewShot].join("\n\n").trim();

  // RAG 召回段
  const ragLines = (Array.isArray(ragChunks) ? ragChunks : [])
    .map((c, i) => `[${i + 1}] ${(c && c.heading) || ""}\n${(c && c.content) || ""}`.trim())
    .filter((s) => s.length > 0);

  const sections = [
    `[角色与业务线] 你是一名${skill.title}，服务于${bizLine}业务线。`,
    ``,
    `[Few-shot 示例]`,
    fewShotBlock || "（无 few-shot 示例）",
    ``,
    `[RAG 召回的知识]`,
    ragLines.length > 0 ? ragLines.join("\n\n") : "（无 RAG 召回）",
    ``,
    `[用户问题]`,
    userQuestion || "",
  ];

  return sections.join("\n");
}

module.exports = {
  buildDynamicFewShot,
  assemblePrompt,
  getSkillPrompt,
  SKILLS,
};
