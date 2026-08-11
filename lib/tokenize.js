/**
 * 共享切词模块
 *
 * 文档预处理（document-processor）和向量检索（vector-store）共用同一套
 * 切词规则与停用词表，保证：
 *   1. 索引阶段（入库）的 token 与检索阶段（查询）的 token 一致
 *   2. 关键词抽取、向量命中、重排序加权用的"停用词"是同一份
 *
 * 规则：
 *   - 中文 unigram + bigram（让"退款"这种两字词保留为整体）
 *   - 英文 / 数字按连续字符切
 *   - 停用词表覆盖常见中文虚词、英文连接词
 */

const STOP_WORDS = new Set([
  '的', '了', '和', '与', '或', '及', '在', '是', '为', '有', '没',
  '不', '也', '都', '就', '把', '被', '让', '使', '可', '可以', '能',
  '需要', '进行', '通过', '使用', '对', '本', '该', '此', '它', '我们',
  '你', '我', '他', '她', '他们', '一个', '一些', '一种', '并', '但是',
  '而', '而且', '所以', '因此', '如果', '则', '于', '上', '下', '中', '以', '等',
  // 检索阶段专用的疑问词与连接词 —— rerank 时不应让它们污染排序
  '怎么', '如何', '为什么', '什么', '哪个', '哪些', '吗', '呢', '啊', '吧',
  '的', '之', '了', '过', '着',
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'if', 'then', 'else', 'when', 'where', 'why', 'how',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'from',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
  'i', 'you', 'he', 'she', 'we', 'my', 'your', 'his', 'her', 'our',
]);

/**
 * 切词：中文 unigram + bigram，英文/数字按连续字符。
 * 非字符串输入会强制转字符串，避免上游漏判类型时崩。
 */
function tokenize(text) {
  const tokens = [];
  for (const seg of String(text == null ? '' : text).toLowerCase().split(/[^a-z0-9一-龥]+/i)) {
    if (!seg) continue;
    if (/[一-龥]/.test(seg)) {
      for (const ch of seg) tokens.push(ch);
      for (let i = 0; i < seg.length - 1; i++) {
        if (/[一-龥]/.test(seg[i]) && /[一-龥]/.test(seg[i + 1])) {
          tokens.push(seg[i] + seg[i + 1]);
        }
      }
    } else {
      tokens.push(seg);
    }
  }
  return tokens;
}

/**
 * 过滤停用词与单字 token（噪音）。
 * 供关键词抽取、向量检索的"实义词"统计用。
 */
function meaningfulTokens(text) {
  return tokenize(text).filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

module.exports = { tokenize, meaningfulTokens, STOP_WORDS };
