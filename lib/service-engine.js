/**
 * AI 客服引擎 - 关键字匹配核心算法
 *
 * 流程：
 * 1. tokenize - 分词（中文 unigram+bigram，英文按词）
 * 2. removeStopwords - 过滤虚词
 * 3. normalize - 同义词归一到标准词
 * 4. scoreMatches - 按相似度打分并排序
 * 5. calculateIdf - 计算词权重
 */

const STOPWORDS = new Set([
  '怎', '样', '是', '的', '了', '和', '在', '不', '这', '那', '可', '要', '能',
  '有', '一', '个', '人', '你', '我', '他', '她', '它', '们', '到', '了', '也',
  '就', '很', '多', '被', '用', '着', '过', '来', '去', '上', '下', '出', '入',
  'a', 'an', 'and', 'the', 'is', 'are', 'was', 'be', 'to', 'of', 'in', 'for',
  'on', 'with', 'by', 'at', 'as', 'from', 'about', 'that', 'this', 'which',
]);

function tokenize(text) {
  if (!text) return [];

  const normalized = text.toLowerCase().replace(/[^\w\s一-龥]/g, '');
  if (!normalized) return [];

  const tokens = [];
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];
    const code = ch.charCodeAt(0);
    const isChinese = code >= 0x4e00 && code <= 0x9fa5;
    const isLetter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit = code >= 48 && code <= 57;

    if (isChinese) {
      tokens.push(ch);
      if (i + 1 < normalized.length) {
        const nextCh = normalized[i + 1];
        const nextCode = nextCh.charCodeAt(0);
        const nextIsChinese = nextCode >= 0x4e00 && nextCode <= 0x9fa5;
        if (nextIsChinese) {
          tokens.push(ch + nextCh);
        }
      }
      i++;
    } else if (isLetter || isDigit) {
      let word = '';
      while (i < normalized.length) {
        const c = normalized[i];
        const codePoint = c.charCodeAt(0);
        const isLetterOrDigit = (codePoint >= 65 && codePoint <= 90) ||
                               (codePoint >= 97 && codePoint <= 122) ||
                               (codePoint >= 48 && codePoint <= 57);
        if (!isLetterOrDigit) break;
        word += c;
        i++;
      }
      if (word) tokens.push(word);
    } else {
      i++;
    }
  }

  return tokens;
}

function removeStopwords(tokens) {
  return tokens.filter(token => !STOPWORDS.has(token));
}

function normalize(tokens, synonyms) {
  const normalized = [];

  for (const token of tokens) {
    let matched = false;
    for (const [standard, variants] of Object.entries(synonyms)) {
      if (variants.includes(token)) {
        normalized.push(standard);
        matched = true;
        break;
      }
    }
    if (!matched) {
      normalized.push(token);
    }
  }

  return normalized;
}

function calculateIdf(documents) {
  const idf = {};
  const docCount = documents.length;

  if (!docCount) return idf;

  const docFreq = {};
  for (const doc of documents) {
    const seen = new Set();
    for (const term of doc) {
      if (!seen.has(term)) {
        docFreq[term] = (docFreq[term] || 0) + 1;
        seen.add(term);
      }
    }
  }

  for (const [term, freq] of Object.entries(docFreq)) {
    idf[term] = Math.log((docCount + 1) / (freq + 1)) + 1;
  }

  return idf;
}

function scoreMatches(normalizedTokens, phraseKeywords, idf = {}) {
  const scores = [];

  for (const phrase of phraseKeywords) {
    let score = 0;
    for (const token of normalizedTokens) {
      if (phrase.keyword === token) {
        const weight = idf[token] || 1;
        score += weight;
      }
    }

    if (score > 0) {
      scores.push({
        id: phrase.id,
        keyword: phrase.keyword,
        score,
      });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  return scores;
}

function processQuestion(question, synonyms, phraseKeywords) {
  const tokens = tokenize(question);
  const filtered = removeStopwords(tokens);
  const normalized = normalize(filtered, synonyms);

  const idf = calculateIdf([normalized]);
  const matches = scoreMatches(normalized, phraseKeywords, idf);

  return {
    originalTokens: tokens,
    filteredTokens: filtered,
    normalizedTokens: normalized,
    matches,
  };
}

module.exports = {
  tokenize,
  removeStopwords,
  normalize,
  calculateIdf,
  scoreMatches,
  processQuestion,
};
