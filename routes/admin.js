// /api/admin 占位 —— 第 14 步再做完整管理后台
const express = require('express');
const auth = require('../lib/auth');
const router = express.Router();

router.get('/users', auth.requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: '仅管理员可查看' });
  const users = auth.loadUsers().map((u) => auth.publicView(u));
  res.json({ ok: true, users });
});

router.get('/stats', auth.requireAuth, (req, res) => {
  const store = require('../lib/store');
  const docs = store.read('documents', []);
  res.json({
    ok: true,
    stats: {
      users: auth.loadUsers().length,
      documents: docs.length,
      documentsPending: docs.filter((d) => d.status === 'pending').length,
      documentsApproved: docs.filter((d) => d.status === 'approved').length,
      documentsRejected: docs.filter((d) => d.status === 'rejected').length,
      totalChunks: docs.reduce((s, d) => s + (d.chunkCount || 0), 0),
    },
  });
});

module.exports = router;
