// /api/feedback 占位 —— 第 12 步实现
const express = require('express');
const auth = require('../lib/auth');
const router = express.Router();
router.get('/health', auth.requireAuth, (req, res) => res.json({ ok: true, msg: '反馈路由已就位，待第 12 步接入' }));
module.exports = router;
