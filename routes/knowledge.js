/**
 * 知识库四层架构 API 路由
 * 包含 mock 数据，用于前端开发和测试
 * 实际的数据库实现在任务6完成后替换此模块
 */

const express = require('express');
const router = express.Router();

// Mock API 无需认证（开发和测试用）
// 生产环境应添加认证和权限检查

// ============ Mock 数据 ============

const mockDocuments = [
  {
    id: 'doc_001',
    filename: '售后政策指南.pdf',
    name: '售后政策指南',
    file_type: 'pdf',
    file_size: 1024 * 250,
    uploader: '张三',
    upload_time: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    review_status: 'approved',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { pages: 12, keywords: ['售后', '退货', '换货'] },
  },
  {
    id: 'doc_002',
    filename: '会员积分规则.docx',
    name: '会员积分规则',
    file_type: 'docx',
    file_size: 1024 * 180,
    uploader: '李四',
    upload_time: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    review_status: 'approved',
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { pages: 8, keywords: ['积分', '会员', '兑换'] },
  },
  {
    id: 'doc_003',
    filename: '订单流程说明.md',
    name: '订单流程说明',
    file_type: 'md',
    file_size: 1024 * 95,
    uploader: '王五',
    upload_time: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    review_status: 'pending',
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { pages: 5, keywords: ['订单', '流程', '状态'] },
  },
  {
    id: 'doc_004',
    filename: '支付方式指南.txt',
    name: '支付方式指南',
    file_type: 'txt',
    file_size: 1024 * 65,
    uploader: '赵六',
    upload_time: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    review_status: 'approved',
    created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    metadata: { pages: 3, keywords: ['支付', '银行卡', '支付宝', '微信'] },
  },
];

const mockStandardizedDocs = [
  {
    id: 'std_001',
    doc_id: 'doc_001',
    processed_content: '售后政策主要包括：1. 退货条件 2. 换货流程 3. 维修服务 4. 发票处理',
    tags: ['退货', '换货', '维修'],
    keywords: ['售后', '服务', '保障'],
    category: '售后服务',
    processing_status: 'completed',
    processed_time: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'std_002',
    doc_id: 'doc_001',
    processed_content: '详细的售后流程：1. 申请 2. 审核 3. 寄回 4. 检测 5. 处理 6. 回寄',
    tags: ['流程', '步骤', '时间'],
    keywords: ['流程', '时间线'],
    category: '售后流程',
    processing_status: 'completed',
    processed_time: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'std_003',
    doc_id: 'doc_002',
    processed_content: '会员积分规则：购物每 1 元积 1 分，签到每日 5 分，分享 10 分',
    tags: ['积分', '获取', '规则'],
    keywords: ['积分', '获取', '兑换'],
    category: '会员系统',
    processing_status: 'completed',
    processed_time: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const mockChunks = [
  {
    id: 'chunk_001',
    standardized_doc_id: 'std_001',
    doc_id: 'doc_001',
    chunk_content: '退货条件：1. 商品未使用 2. 包装完整 3. 在有效期内（通常 7-30 天）4. 提供购买凭证',
    chunk_order: 1,
    position: 'section_1',
    split_strategy: 'paragraph',
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'chunk_002',
    standardized_doc_id: 'std_001',
    doc_id: 'doc_001',
    chunk_content: '换货流程：1. 在线申请 2. 上传凭证照片 3. 等待审核（1-2 个工作日）4. 快递寄回',
    chunk_order: 2,
    position: 'section_2',
    split_strategy: 'paragraph',
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'chunk_003',
    standardized_doc_id: 'std_002',
    doc_id: 'doc_001',
    chunk_content: '售后申请步骤详解：进入"我的订单"→ 选择需要退货的商品 → 点击"退货"→ 填写退货原因',
    chunk_order: 1,
    position: 'subsection_2.1',
    split_strategy: 'sentence',
    created_at: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'chunk_004',
    standardized_doc_id: 'std_003',
    doc_id: 'doc_002',
    chunk_content: '积分获取：购物每消费 1 元获得 1 分积分。VIP 用户双倍积分。积分可用于兑换商品或折扣',
    chunk_order: 1,
    position: 'section_1',
    split_strategy: 'paragraph',
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const mockEmbeddings = [
  {
    id: 'emb_001',
    chunk_id: 'chunk_001',
    model: 'text-embedding-3-large',
    dimensions: 1536,
    index_name: 'knowledge_index_v1',
    is_current: true,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'emb_002',
    chunk_id: 'chunk_002',
    model: 'text-embedding-3-large',
    dimensions: 1536,
    index_name: 'knowledge_index_v1',
    is_current: true,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'emb_003',
    chunk_id: 'chunk_003',
    model: 'text-embedding-3-large',
    dimensions: 1536,
    index_name: 'knowledge_index_v1',
    is_current: true,
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'emb_004',
    chunk_id: 'chunk_004',
    model: 'text-embedding-3-large',
    dimensions: 1536,
    index_name: 'knowledge_index_v1',
    is_current: true,
    created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// ============ 路由处理 ============

// 获取四层数据列表（支持搜索）
router.get('/:layer', (req, res) => {
  const layer = req.params.layer;
  const keyword = req.query.q || '';

  let data = [];

  switch (layer) {
    case 'documents':
      data = mockDocuments;
      break;
    case 'standardized':
      data = mockStandardizedDocs;
      break;
    case 'chunks':
      data = mockChunks;
      break;
    case 'embeddings':
      data = mockEmbeddings;
      break;
    default:
      return res.status(400).json({ ok: false, error: '无效的层级' });
  }

  // 搜索过滤
  if (keyword) {
    data = data.filter((item) => {
      const text = JSON.stringify(item).toLowerCase();
      return text.includes(keyword.toLowerCase());
    });
  }

  res.json({
    ok: true,
    items: data,
    total: data.length,
  });
});

// 获取单条数据详情
router.get('/:layer/:id', (req, res) => {
  const layer = req.params.layer;
  const id = req.params.id;

  let data = [];

  switch (layer) {
    case 'documents':
      data = mockDocuments;
      break;
    case 'standardized':
      data = mockStandardizedDocs;
      break;
    case 'chunks':
      data = mockChunks;
      break;
    case 'embeddings':
      data = mockEmbeddings;
      break;
    default:
      return res.status(400).json({ ok: false, error: '无效的层级' });
  }

  const item = data.find((i) => i.id === id);
  if (!item) {
    return res.status(404).json({ ok: false, error: '未找到数据' });
  }

  res.json({
    ok: true,
    data: item,
  });
});

// 追踪链路（从某一层追溯回原始文档）
router.get('/trace/:layer/:id', (req, res) => {
  const layer = req.params.layer;
  const id = req.params.id;

  let tracePath = [];

  try {
    if (layer === 'chunks') {
      const chunk = mockChunks.find((c) => c.id === id);
      if (!chunk) {
        return res.status(404).json({ ok: false, error: '未找到数据' });
      }

      const std = mockStandardizedDocs.find((s) => s.id === chunk.standardized_doc_id);
      const doc = mockDocuments.find((d) => d.id === chunk.doc_id);

      tracePath = [
        {
          layer: 'documents',
          id: doc?.id || 'unknown',
          name: doc?.filename || 'Unknown',
          title: doc?.filename,
          content: doc?.metadata?.keywords?.join(', '),
        },
        {
          layer: 'standardized',
          id: std?.id || 'unknown',
          name: `标准化文档 ${std?.id}`,
          content: std?.processed_content?.substring(0, 100),
        },
        {
          layer: 'chunks',
          id: chunk.id,
          name: `Chunk ${chunk.id}`,
          content: chunk.chunk_content.substring(0, 100),
        },
      ];
    } else if (layer === 'embeddings') {
      const emb = mockEmbeddings.find((e) => e.id === id);
      if (!emb) {
        return res.status(404).json({ ok: false, error: '未找到数据' });
      }

      const chunk = mockChunks.find((c) => c.id === emb.chunk_id);
      const std = chunk ? mockStandardizedDocs.find((s) => s.id === chunk.standardized_doc_id) : null;
      const doc = chunk ? mockDocuments.find((d) => d.id === chunk.doc_id) : null;

      tracePath = [
        {
          layer: 'documents',
          id: doc?.id || 'unknown',
          name: doc?.filename || 'Unknown',
          content: doc?.metadata?.keywords?.join(', '),
        },
        {
          layer: 'standardized',
          id: std?.id || 'unknown',
          name: `标准化文档 ${std?.id}`,
          content: std?.processed_content?.substring(0, 100),
        },
        {
          layer: 'chunks',
          id: chunk?.id || 'unknown',
          name: `Chunk ${chunk?.id}`,
          content: chunk?.chunk_content?.substring(0, 100),
        },
        {
          layer: 'embeddings',
          id: emb.id,
          name: `向量 ${emb.id}`,
          content: `模型: ${emb.model}, 维度: ${emb.dimensions}`,
        },
      ];
    } else if (layer === 'standardized') {
      const std = mockStandardizedDocs.find((s) => s.id === id);
      if (!std) {
        return res.status(404).json({ ok: false, error: '未找到数据' });
      }

      const doc = mockDocuments.find((d) => d.id === std.doc_id);

      tracePath = [
        {
          layer: 'documents',
          id: doc?.id || 'unknown',
          name: doc?.filename || 'Unknown',
          content: doc?.metadata?.keywords?.join(', '),
        },
        {
          layer: 'standardized',
          id: std.id,
          name: `标准化文档 ${std.id}`,
          content: std.processed_content.substring(0, 100),
        },
      ];
    }

    res.json({
      ok: true,
      path: tracePath,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: '追踪失败: ' + err.message });
  }
});

// 获取某个原始文档的所有四层数据
router.get('/raw/:docId/layers', (req, res) => {
  const docId = req.params.docId;

  const doc = mockDocuments.find((d) => d.id === docId);
  if (!doc) {
    return res.status(404).json({ ok: false, error: '未找到文档' });
  }

  const stds = mockStandardizedDocs.filter((s) => s.doc_id === docId);
  const chunks = mockChunks.filter((c) => c.doc_id === docId);
  const embeddings = mockEmbeddings.filter((e) => chunks.some((c) => c.id === e.chunk_id));

  res.json({
    ok: true,
    raw: doc,
    standardized: stds,
    chunks,
    embeddings,
  });
});

// 错误处理
router.use((err, req, res, next) => {
  console.error('[KNOWLEDGE ERROR]', err.message);
  res.status(err.status || 500).json({ ok: false, error: err.message || '服务器错误' });
});

module.exports = router;
