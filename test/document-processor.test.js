const { test } = require('node:test');
const assert = require('node:assert');
const dp = require('../lib/document-processor');

// ============================================================
// 1. frontmatter 解析与剥离
//    文档头部的 YAML 携带 bizLine / securityLevel，权限过滤要用它。
//    必须解析出来，且绝不能当作正文切进第一个知识片段 —— 否则检索
//    会命中 "docId: TRADE-PRD-001" 这类元数据噪音。
// ============================================================

test('解析 frontmatter，取出元数据字段', () => {
  const raw = `---
title: 订单管理系统 PRD
docId: TRADE-PRD-001
bizLine: trade
securityLevel: internal
version: v3.2
tags: [订单, 拆单, 交易]
---

# 订单管理系统 PRD

正文开始。`;
  const { meta } = dp.parseFrontmatter(raw);
  assert.strictEqual(meta.title, '订单管理系统 PRD');
  assert.strictEqual(meta.docId, 'TRADE-PRD-001');
  assert.strictEqual(meta.bizLine, 'trade');
  assert.strictEqual(meta.securityLevel, 'internal');
  assert.deepStrictEqual(meta.tags, ['订单', '拆单', '交易']);
});

test('frontmatter 必须从正文中剥离', () => {
  const raw = `---
docId: X-1
bizLine: trade
---

# 标题

正文。`;
  const { body } = dp.parseFrontmatter(raw);
  assert.ok(!body.includes('docId'), 'frontmatter 字段泄漏进了正文');
  assert.ok(!body.includes('bizLine'), 'frontmatter 字段泄漏进了正文');
  assert.ok(body.includes('正文。'));
});

test('无 frontmatter 的文档不报错，meta 为空对象', () => {
  const { meta, body } = dp.parseFrontmatter('# 直接是标题\n\n正文内容。');
  assert.deepStrictEqual(meta, {});
  assert.ok(body.includes('直接是标题'));
});

test('剥离后的第一个知识片段不含元数据', () => {
  const raw = `---
docId: TRADE-PRD-001
bizLine: trade
securityLevel: internal
---

# 订单管理系统 PRD

## 1. 需求背景

随着平台交易量增长，原有订单系统在高并发场景下出现超卖问题，需要重构订单主流程。`;
  const chunks = dp.process(raw);
  assert.ok(chunks.length > 0);
  const joined = chunks.map((c) => c.content).join('\n');
  assert.ok(!joined.includes('docId'), '第一个切片包含了 frontmatter 元数据');
  assert.ok(!joined.includes('securityLevel'));
});

// ============================================================
// 2. 文本归一化
//    统一换行、去除多余符号、统一大小写、特殊符号过滤
// ============================================================

test('统一换行符：CRLF 与 CR 都归一为 LF', () => {
  assert.ok(!dp.normalize('第一行\r\n第二行\r第三行').includes('\r'));
});

test('压缩三行以上连续空行为两行', () => {
  const out = dp.normalize('段落一\n\n\n\n\n段落二');
  assert.ok(!/\n{3,}/.test(out), '仍存在三个以上连续换行');
});

test('去除行尾多余空白', () => {
  const out = dp.normalize('行尾有空格   \n行尾有制表符\t\t\n');
  assert.ok(!/[ \t]+\n/.test(out), '行尾空白未清除');
});

test('全角标点归一为半角，中文标点保留', () => {
  const out = dp.normalize('金额（含运费）：１００元，退款２４小时内到账');
  assert.ok(out.includes('(含运费)'), '全角括号未转半角');
  assert.ok(out.includes('100'), '全角数字未转半角');
  assert.ok(out.includes('，'), '中文逗号不应被改动');
});

test('英文统一小写，便于关键词匹配（中文不受影响）', () => {
  const out = dp.normalize('调用 POST /API/Order/Create 接口');
  assert.ok(out.includes('post'), '英文未统一小写');
  assert.ok(out.includes('/api/order/create'));
  assert.ok(out.includes('调用'), '中文被破坏');
});

test('过滤零宽字符与不可见控制字符', () => {
  const out = dp.normalize('订单​状态‌机﻿流转');
  assert.strictEqual(out, '订单状态机流转');
});

test('归一化对纯中文正常文本是幂等的', () => {
  const once = dp.normalize('订单状态机包含八个状态，支持十二条流转路径。');
  assert.strictEqual(dp.normalize(once), once, '归一化不满足幂等');
});

// ============================================================
// 3. 清洗去噪
// ============================================================

test('丢弃过短的片段（噪音）', () => {
  const chunks = dp.process('# 标题\n\n短\n\n这是一段足够长的正文内容，包含订单状态机的完整流转规则说明，应当被保留下来作为知识片段。');
  assert.ok(chunks.every((c) => c.content.length >= 30), '存在过短的噪音片段');
});

test('丢弃纯符号、纯分隔线的片段', () => {
  const chunks = dp.process('---\n\n===\n\n***\n\n|---|---|\n\n这是一段有实际语义的正文，描述了退款审核的金额阈值规则与人工复核触发条件，长度足够。');
  for (const c of chunks) {
    assert.ok(/[一-龥a-z0-9]/.test(c.content), `纯符号片段未被清除: ${JSON.stringify(c.content)}`);
  }
});

test('保留 Markdown 表格作为完整片段，不按行拆散', () => {
  const raw = `# 订单字段

| 字段 | 类型 | 说明 |
|------|------|------|
| order_no | string | 订单号，全局唯一 |
| total_amount | decimal | 订单总金额，单位元 |
| status | int | 订单状态，见状态机定义 |`;
  const chunks = dp.process(raw);
  const tableChunk = chunks.find((c) => c.content.includes('order_no'));
  assert.ok(tableChunk, '表格内容丢失');
  assert.ok(tableChunk.content.includes('total_amount'), '表格被拆散成多个片段');
  assert.ok(tableChunk.content.includes('status'), '表格被拆散成多个片段');
});

test('保留代码块完整性，不在代码块内部切断', () => {
  const raw = `# 接口示例

调用创建订单接口的请求示例如下，注意金额单位为分，需要在前端做好换算处理。

\`\`\`json
{
  "user_id": 10086,
  "items": [{ "sku_id": 555, "qty": 2 }],
  "total_amount": 19900
}
\`\`\``;
  const chunks = dp.process(raw);
  const codeChunk = chunks.find((c) => c.content.includes('sku_id'));
  assert.ok(codeChunk, '代码块内容丢失');
  assert.ok(codeChunk.content.includes('total_amount'), '代码块被切断');
});

// ============================================================
// 4. 段落切分
// ============================================================

test('按段落切分，空行为分隔', () => {
  const raw = `第一段讲的是订单创建流程，用户提交订单后系统会先校验库存再锁定库存额度。

第二段讲的是支付流程，创建支付单后调用第三方渠道并等待异步回调通知。

第三段讲的是退款流程，用户发起退款申请后进入审核环节判断是否需要人工介入。`;
  const chunks = dp.process(raw);
  assert.strictEqual(chunks.length, 3);
  assert.ok(chunks[0].content.includes('订单创建'));
  assert.ok(chunks[2].content.includes('退款'));
});

test('超长段落二次切分，且每片不超过上限', () => {
  const long = '订单状态流转规则说明。'.repeat(120); // 约 1300 字
  const chunks = dp.process(long);
  assert.ok(chunks.length > 1, '超长段落未被二次切分');
  for (const c of chunks) {
    assert.ok(c.content.length <= 600, `切片超长: ${c.content.length}`);
  }
});

test('切片携带所属标题，便于理解上下文', () => {
  const raw = `# 退款业务规则

## 2. 退款审核

单笔退款金额低于 500 元时系统自动审核通过，无需人工介入，可显著提升退款处理时效。`;
  const chunks = dp.process(raw);
  const c = chunks.find((x) => x.content.includes('500'));
  assert.ok(c, '内容片段丢失');
  assert.ok(c.heading && c.heading.includes('退款审核'), `切片未携带标题，实际: ${c.heading}`);
});

// ============================================================
// 5. 去重
// ============================================================

test('完全相同的段落只保留一份', () => {
  const same = '退款到账时效为一到七个工作日，具体到账时间取决于您的发卡银行处理速度。';
  const chunks = dp.process(`${same}\n\n${same}\n\n${same}`);
  assert.strictEqual(chunks.length, 1, '重复段落未去重');
});

test('仅空白与标点差异的段落视为重复', () => {
  const chunks = dp.process(
    '退款到账时效为一到七个工作日，取决于发卡银行处理速度，具体到账时间以发卡行清算为准。\n\n' +
    '退款到账时效为一到七个工作日，取决于发卡银行处理速度，具体到账时间以发卡行清算为准。  '
  );
  assert.strictEqual(chunks.length, 1, '仅空白差异的段落未去重');
});

test('语义不同的段落不得被误删', () => {
  const chunks = dp.process(
    '退款到账时效为一到七个工作日，取决于发卡银行的处理速度快慢。\n\n' +
    '发货时效为付款后四十八小时内，大件商品可能延长至七十二小时。'
  );
  assert.strictEqual(chunks.length, 2, '不同语义的段落被误判为重复');
});

test('跨文档去重：processDocument 可传入已有指纹集合', () => {
  const text = '退款到账时效为一到七个工作日，取决于发卡银行的处理速度快慢。';
  const seen = new Set();
  const first = dp.process(text, { seen });
  const second = dp.process(text, { seen });
  assert.strictEqual(first.length, 1);
  assert.strictEqual(second.length, 0, '跨文档重复内容未被拦截');
});

// ============================================================
// 6. 关键词抽取（供检索与展示）
// ============================================================

test('抽取关键词，过滤停用词', () => {
  const chunks = dp.process('订单退款需要经过审核流程，退款金额超过五百元的订单需要人工审核确认后才能执行退款操作。');
  const kw = chunks[0].keywords;
  assert.ok(Array.isArray(kw) && kw.length > 0, '未抽取到关键词');
  assert.ok(kw.some((k) => k.includes('退款')), `关键词未包含核心词，实际: ${kw}`);
  assert.ok(!kw.includes('的'), '停用词未过滤');
  assert.ok(!kw.includes('需要'), '停用词未过滤');
});

// ============================================================
// 7. 完整文档处理：processDocument
// ============================================================

test('processDocument 返回元数据与切片，并继承文档级 bizLine/securityLevel', () => {
  const raw = `---
docId: TRADE-PRD-001
title: 订单管理系统 PRD
bizLine: trade
securityLevel: internal
---

# 订单管理系统 PRD

## 1. 需求背景

平台交易量快速增长，原有订单系统在大促高并发场景下出现超卖与状态错乱问题。

## 2. 订单状态机

订单共包含八个状态，分别是待付款、已付款、待发货、已发货、已完成、已取消、退款中、已退款。`;

  const result = dp.processDocument(raw, { source: 'order-management.md' });
  assert.strictEqual(result.meta.bizLine, 'trade');
  assert.strictEqual(result.meta.securityLevel, 'internal');
  assert.ok(result.chunks.length >= 2);

  for (const c of result.chunks) {
    assert.strictEqual(c.bizLine, 'trade', '切片未继承文档业务线');
    assert.strictEqual(c.securityLevel, 'internal', '切片未继承文档密级');
    assert.strictEqual(c.source, 'order-management.md');
    assert.ok(c.id, '切片缺少 id');
  }
});

test('processDocument 的显式参数覆盖 frontmatter', () => {
  const raw = `---
bizLine: trade
securityLevel: internal
---

这是一段足够长的正文内容，用于验证显式传入的参数能够覆盖文档头部声明的元数据字段。`;
  const result = dp.processDocument(raw, { bizLine: 'membership', securityLevel: 'public' });
  assert.strictEqual(result.chunks[0].bizLine, 'membership');
  assert.strictEqual(result.chunks[0].securityLevel, 'public');
});

test('processDocument 统计信息可用于前端展示预处理效果', () => {
  const raw = `# 标题

短

这是第一段有效内容，描述订单创建流程中的库存校验与锁定机制，长度足够被保留。

这是第一段有效内容，描述订单创建流程中的库存校验与锁定机制，长度足够被保留。

这是第二段有效内容，描述支付回调的幂等设计与重复通知的处理方式，长度同样足够。`;
  const { stats } = dp.processDocument(raw);
  assert.ok(stats.rawParagraphs >= 5, `原始段落数异常: ${stats.rawParagraphs}`);
  assert.strictEqual(stats.chunks, 2, `最终切片数应为 2，实际 ${stats.chunks}`);
  assert.ok(stats.droppedShort >= 1, '未统计丢弃的短片段');
  assert.ok(stats.droppedDuplicate >= 1, '未统计去重数量');
});

// ============================================================
// 8. 真实文档回归：拿 13 份模拟文档实跑
// ============================================================

test('13 份模拟文档全部能被正确处理，且元数据完整', () => {
  const fs = require('fs');
  const path = require('path');
  const base = path.join(__dirname, '..', 'mock-data', 'documents');

  let total = 0;
  for (const line of fs.readdirSync(base)) {
    for (const file of fs.readdirSync(path.join(base, line))) {
      const raw = fs.readFileSync(path.join(base, line, file), 'utf8');
      const { meta, chunks } = dp.processDocument(raw, { source: file });

      assert.ok(meta.docId, `${file} 缺少 docId`);
      assert.ok(['trade', 'membership', 'all'].includes(meta.bizLine), `${file} bizLine 非法: ${meta.bizLine}`);
      assert.ok(['public', 'internal', 'confidential', 'secret'].includes(meta.securityLevel),
        `${file} securityLevel 非法: ${meta.securityLevel}`);
      assert.ok(chunks.length >= 5, `${file} 切片过少: ${chunks.length}`);

      for (const c of chunks) {
        assert.ok(!c.content.includes('docId:'), `${file} 切片含 frontmatter 残留`);
        assert.ok(c.content.length >= 30, `${file} 存在过短切片`);
        assert.ok(c.content.length <= 600, `${file} 存在超长切片: ${c.content.length}`);
      }
      total += chunks.length;
    }
  }
  assert.ok(total > 200, `全库切片总数偏少: ${total}`);
});

test('客服对外文档的密级必须是 public —— 这是客服分支安全的前提', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'mock-data', 'documents', 'customer-service');
  for (const file of fs.readdirSync(dir)) {
    const { meta } = dp.processDocument(fs.readFileSync(path.join(dir, file), 'utf8'), { source: file });
    assert.strictEqual(meta.securityLevel, 'public', `${file} 对外文档密级必须为 public`);
  }
});

test('内部文档的密级不得是 public —— 防止内部规则泄漏给客服分支', () => {
  const fs = require('fs');
  const path = require('path');
  for (const line of ['trade', 'membership']) {
    const dir = path.join(__dirname, '..', 'mock-data', 'documents', line);
    for (const file of fs.readdirSync(dir)) {
      const { meta } = dp.processDocument(fs.readFileSync(path.join(dir, file), 'utf8'), { source: file });
      assert.notStrictEqual(meta.securityLevel, 'public', `${file} 内部文档不应为 public`);
    }
  }
});
