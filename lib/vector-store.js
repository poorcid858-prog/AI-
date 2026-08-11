/**
 * 向量检索引擎
 *
 * TF-IDF + 余弦相似度的极简实现：零依赖，便于面试讲解。
 *
 * 设计要点：
 *  - 切词与停用词与 document-processor 共享（lib/tokenize.js），
 *    保证"索引 token"与"查询 token"一致
 *  - idf 用平滑公式 log((N+1)/(df+1)) + 1，避免除零、保证权重为正
 *  - vectorize 返回稠密数组（与 vocab 等长），方便 cosine 直接做内积
 *  - cosine 对零向量返回 0 而非 NaN，防止空查询时整库 NaN 污染排序
 *  - search 用 config.rag.minScore 做召回阈值；rerank 业务加权
 *    （标题 / 关键词 / 内容命中）以"按 query token 数归一化"避免长文碾压短答
 *  - rerank 保留 baseScore，方便第 7 步做阈值截断 / 归一化 / 解释
 */

const config = require('../config');
const { tokenize, STOP_WORDS } = require('./tokenize');

// ============================================================
// 1. TF / IDF
// ============================================================

function tf(tokens) {
  const m = {};
  for (const t of tokens) m[t] = (m[t] || 0) + 1;
  return m;
}

/**
 * idf = log((N+1)/(df+1)) + 1
 *  - +1 平滑：避免 df=N 时 log(1)=0 让常见词被乘成 0
 *  - 再 +1：保证权重恒正
 */
function idf(docs) {
  const N = docs.length;
  const df = {};
  for (const tokens of docs) {
    for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
  }
  const m = {};
  for (const t in df) {
    m[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
  }
  return m;
}

// ============================================================
// 2. 向量化
// ============================================================

function vectorize(text, vocab, idfMap) {
  const tfMap = tf(tokenize(text));
  return vocab.map((term) => (tfMap[term] || 0) * (idfMap[term] || 0));
}

// ============================================================
// 3. 余弦相似度
// ============================================================

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ============================================================
// 4. 索引构建
// ============================================================

function buildIndex(chunks) {
  // 以 content 为主语料；heading/keywords 留给 rerank 业务加权
  const tokenized = chunks.map((c) => tokenize(c.content || ''));
  const vocabSet = new Set();
  for (const tokens of tokenized) for (const t of tokens) vocabSet.add(t);
  const vocab = [...vocabSet];
  const idfMap = idf(tokenized);
  const vectors = chunks.map((c, i) => ({
    id: c.id,
    content: c.content,
    heading: c.heading || null,
    keywords: c.keywords || [],
    fingerprint: c.fingerprint,
    // 下面三个字段是 rag-engine.permissionFilter 的判据，必须原样穿过索引。
    // 少带一个，那一层过滤就会因为"字段缺失视为合法"而静默失效。
    bizLine: c.bizLine,
    securityLevel: c.securityLevel,
    status: c.status,
    docId: c.docId,
    source: c.source,
    vec: vectorize(c.content || '', vocab, idfMap),
  }));
  return { vocab, idfMap, vectors };
}

// ============================================================
// 5. 检索
// ============================================================

function search(query, index, topK) {
  if (!index || !index.vectors || index.vectors.length === 0) return [];
  const qVec = vectorize(query, index.vocab, index.idfMap);
  const minScore = config.rag.minScore || 0;

  const scored = [];
  for (const v of index.vectors) {
    const score = cosine(qVec, v.vec);
    if (score > minScore) {
      scored.push({
        id: v.id,
        content: v.content,
        heading: v.heading,
        keywords: v.keywords,
        fingerprint: v.fingerprint,
        bizLine: v.bizLine,
        securityLevel: v.securityLevel,
        source: v.source,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ============================================================
// 6. 业务重排序
// ============================================================

/**
 * 业务加权策略：
 *   - 标题命中：+0.3（任一 query 有效 token 命中 heading 即得分）
 *   - 关键词命中：+0.1 / 关键词
 *   - 内容命中：每命中一次 +0.05 / qTokens.length（按 query 长度归一，
 *     避免长 query 被惩罚、长内容碾压短答）
 *   - 停用词不参与加权（"怎么""什么"等疑问词不会污染排序）
 *
 * 返回 baseScore 字段保留原始 cosine 分数，
 * 供第 7 步做归一化 / 解释 / 阈值截断。
 */
function rerank(query, candidates, topK) {
  if (!candidates || candidates.length === 0) return [];
  // 过滤停用词 + 长度 ≥ 2 的实义 token
  const qTokens = tokenize(query).filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  // 空 query 或 query 全是停用词 → 按原 score 排序返回前 topK，不做业务加权
  if (qTokens.length === 0) {
    return candidates
      .map((c) => Object.assign({}, c, { baseScore: c.score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  const reranked = candidates.map((c) => {
    const heading = (c.heading || '').toLowerCase();
    const keywords = c.keywords || [];
    const content = (c.content || '').toLowerCase();

    let bonus = 0;

    // 标题命中：任一实义 query token 出现在 heading
    if (qTokens.some((t) => heading.includes(t))) bonus += 0.3;

    // 关键词命中：每命中一个关键词 +0.1
    for (const kw of keywords) {
      const k = String(kw).toLowerCase();
      if (qTokens.some((t) => k.includes(t))) bonus += 0.1;
    }

    // 内容命中：query token 在 content 中每出现一次，按 query 长度归一加分
    // 归一的目的：让"长 query 全部命中一次" ≈ "短 query 命中一次"，
    // 避免长 query 在大段内容上堆出远超 cosine 的伪相关
    const perTokenBonus = 0.05 / qTokens.length;
    for (const t of qTokens) {
      if (!t) continue;
      let idx = 0;
      while ((idx = content.indexOf(t, idx)) !== -1) {
        bonus += perTokenBonus;
        idx += t.length || 1;
      }
    }

    return Object.assign({}, c, { baseScore: c.score, score: c.score + bonus });
  });

  reranked.sort((a, b) => b.score - a.score);
  return reranked.slice(0, topK);
}

module.exports = {
  tokenize,        // 转发共享切词（保持向后兼容）
  tf,
  idf,
  vectorize,
  cosine,
  buildIndex,
  search,
  rerank,
};
