/**
 * 知识库四层架构 API 路由
 *
 * 提供对四层知识模型的CRUD访问、追踪链路、完整数据查询。
 * 数据来源：lib/knowledge-layers.js（四层模型）+ lib/traceability.js（追踪）
 */

const express = require('express');
const auth = require('../lib/auth');
const kl = require('../lib/knowledge-layers');
const tb = require('../lib/traceability');
const docs = require('../lib/documents');

const router = express.Router();

// 用 lib/auth 的 requireAuth：它会从 x-token / Bearer 解析出 req.user
router.use(auth.requireAuth);

// ============================================================
// 辅助函数：字段映射（四层内部模型 → 前端响应模型）
// ============================================================

/**
 * 映射原始文档为前端格式
 * 兼容旧 snake_case 字段名，取自 docs.getDocumentView() 或直接从 raw/std 合成
 */
function mapDocument(view) {
  // view 来自 docs.getDocumentView()，已经有 id/title/fileName/...
  return {
    id: view.id,
    filename: view.fileName || view.title || '未命名',
    name: view.title || view.fileName || '未命名',
    file_type: view.fileName ? (/\.(pdf|docx|pptx|txt|md)$/.exec(view.fileName) || [, 'md'])[1] : 'md',
    file_size: 0, // 原始数据不带文件大小，前端不依赖此字段
    uploader: view.uploadedBy || '-',
    upload_time: view.createdAt,
    review_status: view.status,  // view.status 已经是旧三值 pending/approved/rejected
    created_at: view.createdAt,
    metadata: {
      keywords: view.tags || [],
      knowledge_type: view.knowledgeType || 'other',
    },
  };
}

/**
 * 映射标准化文档为前端格式
 */
function mapStdDocument(std, raw) {
  const statusMap = {
    'qc_failed': 'failed',
    'published': 'completed',
    'need_review': 'completed',
    'pending': 'processing',
    'draft': 'processing',
    'approved': 'processing',
    'rejected': 'failed',
    'archived': 'failed',
  };
  return {
    id: std.id,
    doc_id: std.rawId,
    processed_content: std.content.substring(0, 200),
    category: raw && raw.knowledgeType ? raw.knowledgeType : 'other',
    tags: raw && raw.tags ? raw.tags : [],
    processing_status: statusMap[std.status] || 'processing',
    created_at: std.createdAt,
  };
}

/**
 * 映射 Chunk 为前端格式
 */
function mapChunk(chunk, std) {
  const position = chunk.sectionPath && Array.isArray(chunk.sectionPath)
    ? chunk.sectionPath.join(' > ')
    : chunk.heading || '';
  return {
    id: chunk.id,
    standardized_doc_id: chunk.stdId,
    doc_id: chunk.rawId,
    chunk_content: chunk.content,
    chunk_order: chunk.seq || 1,
    position,
    split_strategy: std && std.params && std.params.splitMode ? std.params.splitMode : 'paragraph',
    created_at: chunk.createdAt,
  };
}

/**
 * 映射 Vector 为前端格式
 */
function mapVector(vec) {
  return {
    id: vec.id,
    chunk_id: vec.chunkId,
    model: vec.model,
    dimensions: vec.dim,
    index_name: vec.indexName || 'default',
    is_current: vec.isCurrent,
    created_at: vec.createdAt,
  };
}

// ============================================================
// 路由：获取四层数据列表
// ============================================================

/**
 * GET /:layer?q=...
 * 获取某一层的数据列表，支持关键词搜索
 *
 * layer: documents / standardized / chunks / embeddings
 */
router.get('/:layer', (req, res) => {
  try {
    const layer = req.params.layer;
    const keyword = (req.query.q || '').toLowerCase();

    let items = [];

    switch (layer) {
      case 'documents': {
        // documents 层：任何人都能看（受权限约束的列表）
        const views = docs.listForUser(req.user).map(v => docs.publicView(v, req.user));
        items = views.map(v => mapDocument(v));
        break;
      }

      case 'standardized': {
        // standardized 层：仅 admin/reviewer 可见（暴露原文内容）
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const stds = kl.listStds();
        const rawMap = new Map(kl.listRaws().map(r => [r.id, r]));
        items = stds.map(s => mapStdDocument(s, rawMap.get(s.rawId)));
        break;
      }

      case 'chunks': {
        // chunks 层：仅 admin/reviewer 可见
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const chunks = kl.listChunks();
        const stdMap = new Map(kl.listStds().map(s => [s.id, s]));
        items = chunks.map(c => mapChunk(c, stdMap.get(c.stdId)));
        break;
      }

      case 'embeddings': {
        // embeddings 层：仅 admin/reviewer 可见
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const vecs = kl.listVectors();
        items = vecs.map(v => mapVector(v));
        break;
      }

      default:
        return res.status(400).json({ ok: false, error: '无效的层级' });
    }

    // 关键词过滤
    if (keyword) {
      items = items.filter(item => {
        const text = JSON.stringify(item).toLowerCase();
        return text.includes(keyword);
      });
    }

    res.json({ ok: true, items, total: items.length });
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：获取单条数据详情
// ============================================================

router.get('/:layer/:id', (req, res) => {
  try {
    const { layer, id } = req.params;

    let data = null;

    switch (layer) {
      case 'documents': {
        const view = docs.getDocumentView(id);
        if (!view) return res.status(404).json({ ok: false, error: '未找到数据' });
        data = mapDocument(view);
        break;
      }

      case 'standardized': {
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const std = kl.getStd(id);
        if (!std) return res.status(404).json({ ok: false, error: '未找到数据' });
        const raw = kl.getRaw(std.rawId);
        data = mapStdDocument(std, raw);
        break;
      }

      case 'chunks': {
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const chunk = kl.getChunk(id);
        if (!chunk) return res.status(404).json({ ok: false, error: '未找到数据' });
        const std = kl.getStd(chunk.stdId);
        data = mapChunk(chunk, std);
        break;
      }

      case 'embeddings': {
        if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
          return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
        }
        const vec = kl.listVectors().find(v => v.id === id);
        if (!vec) return res.status(404).json({ ok: false, error: '未找到数据' });
        data = mapVector(vec);
        break;
      }

      default:
        return res.status(400).json({ ok: false, error: '无效的层级' });
    }

    res.json({ ok: true, data });
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：追踪链路
// ============================================================

/**
 * GET /trace/:layer/:id
 * 从某一层追溯到原始文档（或完整链路）
 *
 * layer: documents(raw) / standardized(std) / chunks(chunk) / embeddings(vector)
 */
router.get('/trace/:layer/:id', (req, res) => {
  try {
    const { layer, id } = req.params;

    // 前端层名 → kl 层名 映射
    const layerMap = {
      'documents': kl.LAYERS.RAW,
      'standardized': kl.LAYERS.STD,
      'chunks': kl.LAYERS.CHUNK,
      'embeddings': kl.LAYERS.VECTOR,
    };

    const klLayer = layerMap[layer];
    if (!klLayer) {
      return res.status(400).json({ ok: false, error: '无效的层级' });
    }

    // 调用 traceability.breadcrumb 拿完整面包屑
    const crumbs = tb.breadcrumb(klLayer, id);
    if (crumbs.length === 0) {
      return res.status(404).json({ ok: false, error: '记录不存在或追踪链路断裂' });
    }

    // 转换为前端格式
    const path = crumbs.map(crumb => {
      const record = kl.listAll(crumb.layer).find(r => r.id === crumb.id);
      let content = null;

      if (!record) return { layer: crumb.layer, id: crumb.id, name: crumb.label };

      if (crumb.layer === kl.LAYERS.RAW) {
        return {
          layer: 'documents',
          id: record.id,
          name: record.title || record.fileName || '未命名',
          title: record.title,
          filename: record.fileName,
          content: record.tags ? record.tags.join(', ') : '',
        };
      } else if (crumb.layer === kl.LAYERS.STD) {
        return {
          layer: 'standardized',
          id: record.id,
          name: crumb.label,
          content: record.content ? record.content.substring(0, 100) : '',
        };
      } else if (crumb.layer === kl.LAYERS.CHUNK) {
        return {
          layer: 'chunks',
          id: record.id,
          name: crumb.label,
          content: record.content ? record.content.substring(0, 100) : '',
        };
      } else if (crumb.layer === kl.LAYERS.VECTOR) {
        return {
          layer: 'embeddings',
          id: record.id,
          name: crumb.label,
          content: `模型: ${record.model}, 维度: ${record.dim}`,
        };
      }

      return { layer: crumb.layer, id: crumb.id, name: crumb.label };
    });

    res.json({ ok: true, path });
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：获取原始文档的全部四层数据
// ============================================================

/**
 * GET /raw/:docId/layers
 * 获取某个原始文档对应的全部四层数据（及其所有版本和片段）
 */
router.get('/raw/:docId/layers', (req, res) => {
  try {
    const { docId } = req.params;
    const raw = kl.getRaw(docId);

    if (!raw) {
      return res.status(404).json({ ok: false, error: '文档不存在' });
    }

    // 权限检查：详情页允许，其他层仅 admin/reviewer
    const isAllowed = req.user.role === 'admin' || req.user.role === 'reviewer';

    const view = docs.getDocumentView(docId);

    // 构造四层响应
    const stds = kl.listStdByRaw(docId);
    const chunks = [];
    for (const std of stds) {
      chunks.push(...kl.listChunksByStd(std.id));
    }
    const embeddings = [];
    for (const chunk of chunks) {
      embeddings.push(...kl.listVectorsByChunk(chunk.id));
    }

    const response = {
      ok: true,
      raw: mapDocument(view),
      standardized: isAllowed ? stds.map(s => mapStdDocument(s, raw)) : [],
      chunks: isAllowed ? chunks.map(c => mapChunk(c, kl.getStd(c.stdId))) : [],
      embeddings: isAllowed ? embeddings.map(e => mapVector(e)) : [],
    };

    res.json(response);
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：下架 / 替换 / 归档操作
// ============================================================

/**
 * POST /api/knowledge/archive/:stdId
 * 下架文档（归档）
 */
router.post('/archive/:stdId', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }
    const archived = kl.archiveStd(req.params.stdId);
    res.json({ ok: true, data: { id: archived.id, status: archived.status }, message: '文档已下架' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/replace/:rawId
 * 替换文档（新建版本）
 */
router.post('/replace/:rawId', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }
    const { content } = req.body;
    if (!content) return res.status(400).json({ ok: false, error: '请提供新内容' });
    const raw = kl.getRaw(req.params.rawId);
    if (!raw) return res.status(404).json({ ok: false, error: '文档不存在' });
    const std = kl.createStdVersion(raw.id, { content });
    kl.setStdStatus(std.id, kl.STD_STATUS.PENDING);
    res.json({ ok: true, data: { id: std.id, rawId: raw.id, status: std.status }, message: '新版本已创建，等待审核' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：版本详情
// ============================================================

/**
 * GET /api/knowledge/:versionId
 * 获取版本详情
 */
router.get('/:versionId', (req, res) => {
  try {
    const versionId = req.params.versionId;
    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    const document = kl.getDocument(version.document_id);
    const raw = kl.getRawByVersionId(versionId);
    const std = kl.getStdByVersionId(versionId);

    res.json({
      ok: true,
      data: {
        version,
        document,
        raw: raw ? mapDocument(docs.getDocumentView(raw.id)) : null,
        standardized: std ? mapStdDocument(std, raw) : null,
      }
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：重新发起审核
// ============================================================

/**
 * POST /api/knowledge/:versionId/re-review
 * 重新发起审核
 */
router.post('/:versionId/re-review', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const versionId = req.params.versionId;
    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    // 检查状态：只有审核失败的状态才能重新发起审核
    if (version.review_status !== 'rejected') {
      return res.status(400).json({ ok: false, error: '只有审核失败的状态才能重新发起审核' });
    }

    // 更新审核状态为待审核
    const updated = kl.updateDocumentVersion(versionId, {
      review_status: 'pending',
    });

    res.json({ ok: true, data: updated, message: '已重新发起审核' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：上线/下线
// ============================================================

/**
 * POST /api/knowledge/:versionId/online
 * 上线文档
 */
router.post('/:versionId/online', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const versionId = req.params.versionId;
    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    // 检查状态：只有未上线或已下线的状态才能上线
    if (version.online_status !== 'not_online' && version.online_status !== 'offline') {
      return res.status(400).json({ ok: false, error: '当前状态不允许上线' });
    }

    // 检查处理状态：必须处理成功才能上线
    if (version.processing_status !== 'success') {
      return res.status(400).json({ ok: false, error: '只有处理成功的文档才能上线' });
    }

    // 更新生效状态为已上线
    const updated = kl.updateDocumentVersion(versionId, {
      online_status: 'online',
    });

    res.json({ ok: true, data: updated, message: '已上线' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/:versionId/offline
 * 下线文档
 */
router.post('/:versionId/offline', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const versionId = req.params.versionId;
    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    // 检查状态：只有已上线的状态才能下线
    if (version.online_status !== 'online') {
      return res.status(400).json({ ok: false, error: '只有已上线的文档才能下线' });
    }

    // 更新生效状态为已下线
    const updated = kl.updateDocumentVersion(versionId, {
      online_status: 'offline',
    });

    res.json({ ok: true, data: updated, message: '已下线' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：发布新版本
// ============================================================

/**
 * POST /api/knowledge/:documentId/new-version
 * 发布新版本
 */
router.post('/:documentId/new-version', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const documentId = req.params.documentId;
    const document = kl.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ ok: false, error: '文档不存在' });
    }

    // 创建新版本
    const newVersion = kl.createDocumentVersion(documentId, {
      sourceFileId: document.current_version_id,
      metadata: {},
    });

    res.json({ ok: true, data: newVersion, message: '新版本已创建' });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：删除
// ============================================================

/**
 * DELETE /api/knowledge/:versionId
 * 删除文档版本
 */
router.delete('/:versionId', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const versionId = req.params.versionId;
    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    // 检查是否允许删除：只有未完成向量化处理时才能删除
    if (version.processing_status === 'success') {
      return res.status(400).json({ ok: false, error: '已完成向量化处理的文档不能删除，只能下线' });
    }

    // 删除原始文档及其所有子数据
    const raw = kl.getRawByVersionId(versionId);
    if (raw) {
      const counts = kl.deleteRawCascade(raw.id);
      res.json({ ok: true, data: counts, message: '已删除' });
    } else {
      // 如果没有原始文档，只删除版本记录
      res.json({ ok: true, data: { versionId }, message: '已删除版本记录' });
    }
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 路由：待审核版本列表（需求第 8 节 - 审核联动）
// ============================================================

/**
 * GET /api/knowledge/pending-review
 * 获取待审核的文档版本列表（审核状态=待审核）
 */
router.get('/pending-review', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可访问' });
    }

    const versions = kl.listVersionsByReviewStatus('pending');

    // 为每个版本附加文档信息
    const result = versions.map((version) => {
      const document = kl.getDocument(version.document_id);
      return {
        ...version,
        document_name: document ? document.document_name : '未知文档',
      };
    });

    res.json({ ok: true, versions: result, total: result.length });
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：审核通过/驳回（需求第 8 节 - 审核联动）
// ============================================================

/**
 * POST /api/knowledge/:versionId/review
 * 审核通过或驳回文档版本
 *
 * Body: { decision: 'approved' | 'rejected', note?: string }
 */
router.post('/:versionId/review', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const versionId = req.params.versionId;
    const { decision, note } = req.body;

    // 校验 decision 参数
    if (!decision || !['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ ok: false, error: '审核决定非法，必须为 approved 或 rejected' });
    }

    const version = kl.getDocumentVersion(versionId);
    if (!version) {
      return res.status(404).json({ ok: false, error: '版本不存在' });
    }

    // 检查状态：只有待审核的状态才能审核
    if (version.review_status !== 'pending') {
      return res.status(400).json({ ok: false, error: `当前审核状态为 ${version.review_status}，只有待审核版本才能审核` });
    }

    // 更新审核状态
    const updated = kl.updateDocumentVersion(versionId, {
      review_status: decision,
    });

    res.json({
      ok: true,
      data: updated,
      message: decision === 'approved' ? '审核通过' : '已驳回',
    });
  } catch (err) {
    console.error('[KNOWLEDGE ERROR]', err.message);
    res.status(500).json({ ok: false, error: err.message || '服务器错误' });
  }
});

// ============================================================
// 路由：批量操作
// ============================================================

/**
 * POST /api/knowledge/batch-online
 * 批量上线
 */
router.post('/batch-online', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const { versionIds } = req.body;
    if (!Array.isArray(versionIds) || versionIds.length === 0) {
      return res.status(400).json({ ok: false, error: '请提供 versionIds 数组' });
    }

    const results = [];
    for (const versionId of versionIds) {
      try {
        const version = kl.getDocumentVersion(versionId);
        if (!version) {
          results.push({ versionId, ok: false, error: '版本不存在' });
          continue;
        }

        if (version.online_status !== 'not_online' && version.online_status !== 'offline') {
          results.push({ versionId, ok: false, error: '当前状态不允许上线' });
          continue;
        }

        if (version.processing_status !== 'success') {
          results.push({ versionId, ok: false, error: '只有处理成功的文档才能上线' });
          continue;
        }

        kl.updateDocumentVersion(versionId, { online_status: 'online' });
        results.push({ versionId, ok: true });
      } catch (e) {
        results.push({ versionId, ok: false, error: e.message });
      }
    }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    res.json({
      ok: true,
      data: { results, successCount, failCount },
      message: `批量上线完成：成功 ${successCount} 个，失败 ${failCount} 个`
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/knowledge/batch-offline
 * 批量下线
 */
router.post('/batch-offline', (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ ok: false, error: '仅管理员和审核员可操作' });
    }

    const { versionIds } = req.body;
    if (!Array.isArray(versionIds) || versionIds.length === 0) {
      return res.status(400).json({ ok: false, error: '请提供 versionIds 数组' });
    }

    const results = [];
    for (const versionId of versionIds) {
      try {
        const version = kl.getDocumentVersion(versionId);
        if (!version) {
          results.push({ versionId, ok: false, error: '版本不存在' });
          continue;
        }

        if (version.online_status !== 'online') {
          results.push({ versionId, ok: false, error: '只有已上线的文档才能下线' });
          continue;
        }

        kl.updateDocumentVersion(versionId, { online_status: 'offline' });
        results.push({ versionId, ok: true });
      } catch (e) {
        results.push({ versionId, ok: false, error: e.message });
      }
    }

    const successCount = results.filter(r => r.ok).length;
    const failCount = results.length - successCount;

    res.json({
      ok: true,
      data: { results, successCount, failCount },
      message: `批量下线完成：成功 ${successCount} 个，失败 ${failCount} 个`
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// 错误处理
// ============================================================

router.use((err, req, res, next) => {
  console.error('[KNOWLEDGE ERROR]', err.message);
  res.status(err.status || 500).json({ ok: false, error: err.message || '服务器错误' });
});

module.exports = router;
