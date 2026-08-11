/**
 * 全局配置
 *
 * 所有可变配置集中在此，通过环境变量覆盖默认值。
 * 上云时只需设置环境变量，无需改代码。
 */

const path = require('path');

// 读取 .env（可选，不存在则忽略）——避免引入 dotenv 依赖
try {
  const fs = require('fs');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch (_) {
  // .env 解析失败不应阻断启动
}

const ROOT = __dirname;

module.exports = {
  // ---------- 服务 ----------
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',

  /**
   * 只读模式：上云对外传阅时开启。
   * 开启后 guest 角色的所有写操作在后端中间件层被拦截，
   * 而非仅在前端隐藏按钮——前端隐藏是体验，后端拦截才是安全。
   */
  readonlyMode: process.env.READONLY_MODE === 'true',

  // ---------- 路径 ----------
  paths: {
    root: ROOT,
    mockData: path.join(ROOT, 'mock-data'),
    documents: path.join(ROOT, 'mock-data', 'documents'),
    users: path.join(ROOT, 'mock-data', 'users.json'),
    promptExamples: path.join(ROOT, 'mock-data', 'prompt-examples.json'),
    data: path.join(ROOT, 'data'),
    public: path.join(ROOT, 'public'),
  },

  // ---------- 大模型适配层 ----------
  llm: {
    /** mock = 本地按提示词规则组装（默认，无需 Key）；real = 调用真实大模型 */
    mode: process.env.LLM_MODE === 'real' ? 'real' : 'mock',
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || '',
    model: process.env.LLM_MODEL || '',
    temperature: Number(process.env.LLM_TEMPERATURE) || 0.3,
    maxTokens: Number(process.env.LLM_MAX_TOKENS) || 4096,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS) || 60000,
  },

  // ---------- RAG ----------
  rag: {
    /** 段落切分后，短于此长度的片段丢弃（清洗去噪） */
    minChunkLength: 30,
    /** 单个切片最大长度，超出则二次切分 */
    maxChunkLength: 600,
    /** 检索召回数量（重排序前） */
    recallTopK: 12,
    /** 重排序后最终送入 Prompt 的数量 */
    rerankTopK: 5,
    /** 相似度低于此阈值的切片不召回 */
    minScore: 0.02,
  },

  // ---------- 安全分级 ----------
  /**
   * 数值越大越敏感。客服分支只能检索 public(0)。
   * 内部岗位可检索 public/internal/confidential，secret 需单独授权。
   */
  securityLevels: {
    public: 0,
    internal: 1,
    confidential: 2,
    secret: 3,
  },

  // ---------- 业务线 ----------
  bizLines: {
    trade: '交易线',
    membership: '会员线',
    all: '全业务线',
  },

  // ---------- 知识类型白名单（四层模型第一层 raw.knowledgeType）----------
  /**
   * 上传时必须归类，决定了复审周期与提示词模板的选择。
   * 不在白名单内的类型一律拒绝 —— 避免前端随手传个新值就悄悄绕过分类统计。
   */
  knowledgeTypes: {
    requirement: '需求文档',
    api: '接口文档',
    test_spec: '测试规范',
    business_rule: '业务规则',
    faq: '常见问题',
    other: '其他',
  },

  // ---------- 文档加工默认参数（四层模型第二层 std.params 的默认值）----------
  /**
   * 每次加工都会把这套参数**快照**进 std.params，
   * 这样"这个版本是用什么参数加工的"永远可查，也才能做新旧参数对比。
   * 改这里只影响之后新建的版本，不会篡改历史版本的快照。
   */
  processing: {
    /** 切分粒度：section 按章节 / paragraph 按段落 / fixed 按固定字数 */
    splitMode: 'section',
    /** splitMode=fixed 时的每片字数 */
    fixedSize: 400,
    /** 固定字数模式下相邻片段的重叠字数，避免把一句话切断 */
    overlap: 50,
    minChunkLength: 30,
    maxChunkLength: 600,
    /** 表格转 Markdown 而非拉平成一行，保住行列对应关系 */
    keepTableStructure: true,
    /** 把章节标题拼进片段正文 —— 对命中率影响最大的一个开关 */
    prependHeading: true,
    cleanLevel: {
      stripHeaderFooter: true,
      stripRevision: true,
      mergeShortParagraphs: false,
    },
    /** 1.0 = 内容完全相同才算重复 */
    dedupThreshold: 1.0,
  },

  // ---------- 角色 ----------
  roles: {
    admin: { label: '系统管理员', canWrite: true, canReview: false, canUse: true },
    reviewer: { label: '审核专员', canWrite: false, canReview: true, canUse: true },
    product: { label: '产品经理', canWrite: false, canReview: false, canUse: true },
    test: { label: '测试工程师', canWrite: false, canReview: false, canUse: true },
    frontend: { label: '前端工程师', canWrite: false, canReview: false, canUse: true },
    cs: { label: '客服专员', canWrite: false, canReview: false, canUse: true },
    guest: { label: '演示访客', canWrite: false, canReview: false, canUse: true },
  },
};
