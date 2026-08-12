// /api/admin 管理后台
const express = require('express');
const auth = require('../lib/auth');
const kl = require('../lib/knowledge-layers');
const docs = require('../lib/documents');
const qa = require('../lib/qa-store');
const router = express.Router();

router.get('/users', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const users = auth.loadUsers().map((u) => auth.publicView(u));
  res.json({ ok: true, users });
});

/**
 * 管理后台统计 —— 阶段 6 切到四层聚合
 *
 * 旧实现：直接 store.read('documents', []) 拉旧扁平表，
 *   字段 users / documents / documentsPending / documentsApproved /
 *   documentsRejected / totalChunks 全部从旧表统计。
 *   问题：旧表里只有 pending / approved / rejected 3 值，没有 lifecycleStatus 的 8 态语义。
 *
 * 新实现：kl.listRaws() 拿全部 raw → docs.getDocumentView(rawId) 拿聚合视图 →
 *   在 view 基础上做投影聚合：
 *     - 状态分布：按 view.lifecycleStatus 8 态聚合（不是 view.status 3 值）
 *     - 业务线 / 安全等级 / 上传者：按 view 对应字段聚合
 *     - 最近 N 条：取 view.createdAt 最新 N 条
 *
 * **关键决策**：
 *   1. 状态聚合按 view.lifecycleStatus 而非 view.status —
 *      view.status 是 3 值兼容层（前端用），view.lifecycleStatus 是 8 态（精确）。
 *      把 lifecycleStatus 投影出来，前端 admin.html 就能看到"草稿 / 待审 / 已发 / 复审中"的真实分布。
 *   2. 保留旧字段（users / documents / documentsPending / documentsApproved /
 *      documentsRejected / totalChunks）按 view.status 聚合 ——
 *      现有 admin.html 仍读这些字段（s.users / s.documents / s.documentsPending / s.totalChunks），
 *      改字段名会破前端，所以**保持字段名一致**，新字段另起（byStatus / byBizLine / ...）。
 *   3. 空库防御：kl.listRaws() 返空数组时聚合全 0，不 500。
 *
 * **性能**：N 个 raw 调 N 次 getDocumentView —— 每个 getDocumentView 内部
 *   listStdByRaw + listChunksByStd 一次。N 大时会慢，本阶段接受 N 次扫描
 *   （admin 后台接口，N 不会很大），阶段 9 重写时考虑加缓存。
 */
const RECENT_LIMIT = 10;

router.get('/stats', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  // 1. 走四层链路：listRaws + getDocumentView 投影
  const raws = kl.listRaws();
  const views = raws
    .map((raw) => docs.getDocumentView(raw.id))
    .filter((v) => v != null);

  // 2. 现有 admin.html 字段（保持不变，按 view.status 3 值聚合）
  let documentsPending = 0;
  let documentsApproved = 0;
  let documentsRejected = 0;
  let totalChunks = 0;

  // 3. 新聚合字段（按 lifecycleStatus 8 态 + 业务线 / 密级 / 上传者）
  const byStatus = {
    draft: 0, qc_failed: 0, pending: 0, approved: 0,
    published: 0, need_review: 0, rejected: 0, archived: 0,
  };
  const byBizLine = { trade: 0, membership: 0, all: 0 };
  const bySecurityLevel = { public: 0, internal: 0, confidential: 0, secret: 0 };
  const byUploader = {};

  // 4. 最近 N 条（按 createdAt 降序）
  const recent = views
    .slice()
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, RECENT_LIMIT)
    .map((v) => ({
      id: v.id,
      title: v.title,
      bizLine: v.bizLine,
      securityLevel: v.securityLevel,
      uploadedBy: v.uploadedBy,
      status: v.status,
      lifecycleStatus: v.lifecycleStatus,
      chunkCount: v.chunkCount,
      createdAt: v.createdAt,
    }));

  // 5. 一次循环把所有聚合算完
  for (const v of views) {
    // 旧字段（view.status 3 值）
    if (v.status === 'pending') documentsPending += 1;
    else if (v.status === 'approved') documentsApproved += 1;
    else if (v.status === 'rejected') documentsRejected += 1;
    totalChunks += v.chunkCount || 0;

    // 新字段：lifecycleStatus 8 态
    if (byStatus[v.lifecycleStatus] != null) byStatus[v.lifecycleStatus] += 1;
    // 业务线（防御：未知 bizLine 归到 __other__）
    if (byBizLine[v.bizLine] != null) byBizLine[v.bizLine] += 1;
    else byBizLine.__other__ = (byBizLine.__other__ || 0) + 1;
    // 安全等级
    if (bySecurityLevel[v.securityLevel] != null) bySecurityLevel[v.securityLevel] += 1;
    else bySecurityLevel.__other__ = (bySecurityLevel.__other__ || 0) + 1;
    // 上传者（任意用户名都允许，统计时按实际值分组）
    const uploader = v.uploadedBy || '__unknown__';
    byUploader[uploader] = (byUploader[uploader] || 0) + 1;
  }

  res.json({
    ok: true,
    stats: {
      // 旧字段（保持不变 —— 现有 admin.html 仍读这些）
      users: auth.loadUsers().length,
      documents: views.length,
      documentsPending,
      documentsApproved,
      documentsRejected,
      totalChunks,
      // 新增聚合（阶段 6：四层聚合）
      byStatus,
      byBizLine,
      bySecurityLevel,
      byUploader,
      recent,
    },
  });
});

// ---------- GET /api/admin/qa-history 问答历史列表 ----------

router.get('/qa-history', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);

  const sessions = qa.listSessions(limit + offset);
  const sliced = sessions.slice(offset, offset + limit);

  // 为每条 session 补充 userName / role / bizLine（从首条 user record 取）
  const enriched = sliced.map((s) => {
    const records = qa.listBySession(s.sessionId);
    const firstUserRecord = records.find((r) => r.type === 'user');
    return {
      sessionId: s.sessionId,
      lastTimestamp: s.lastTimestamp,
      recordCount: s.recordCount,
      summary: s.summary,
      userName: firstUserRecord?.userName || '未知',
      role: firstUserRecord?.role || '',
      bizLine: firstUserRecord?.bizLine || '',
    };
  });

  res.json({
    ok: true,
    sessions: enriched,
    total: sessions.length,
  });
});

// ---------- GET /api/admin/qa-history/:sessionId Session 详情 ----------

router.get('/qa-history/:sessionId', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });

  const { sessionId } = req.params;
  const records = qa.listBySession(sessionId);

  if (records.length === 0) {
    return res.status(404).json({ ok: false, error: `session 不存在: ${sessionId}` });
  }

  res.json({
    ok: true,
    session: {
      sessionId,
      records,
    },
  });
});

module.exports = router;
