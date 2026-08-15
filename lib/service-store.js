/**
 * 客服数据持久化层 —— 替代内存硬编码，使用 JSON 文件存储
 */
const store = require('./store');

// ========== 话术库 CRUD ==========

function listPhrases() {
  return store.read('service_phrases', []);
}

function getPhrase(id) {
  return listPhrases().find(p => p.id === id);
}

function addPhrase(data) {
  const id = store.nextId('service_phrases', 'sp');
  const phrase = {
    id,
    keyword: data.keyword || '',
    reply: data.reply || '',
    priority: typeof data.priority === 'number' ? data.priority : 1,
    createdAt: new Date().toISOString(),
  };
  store.push('service_phrases', phrase);
  return phrase;
}

function updatePhrase(id, data) {
  const phrase = getPhrase(id);
  if (!phrase) return null;
  const updated = { ...phrase, ...data, id, createdAt: phrase.createdAt, updatedAt: new Date().toISOString() };
  return store.update('service_phrases', id, updated);
}

function deletePhrase(id) {
  return store.remove('service_phrases', id);
}

// ========== 同义词表 CRUD ==========

function listSynonyms() {
  return store.read('service_synonyms', []);
}

function getSynonym(keyword) {
  return listSynonyms().find(s => s.keyword === keyword);
}

function addSynonym(data) {
  const existing = getSynonym(data.keyword);
  if (existing) {
    // 追加变体
    const variants = Array.from(new Set([...existing.variants, ...(data.variants || [])]));
    return store.update('service_synonyms', existing.id, { variants, updatedAt: new Date().toISOString() });
  }
  const id = store.nextId('service_synonyms', 'ss');
  const synonym = {
    id,
    keyword: data.keyword || '',
    variants: Array.isArray(data.variants) ? data.variants : [],
    createdAt: new Date().toISOString(),
  };
  store.push('service_synonyms', synonym);
  return synonym;
}

function updateSynonym(id, data) {
  const synonym = listSynonyms().find(s => s.id === id);
  if (!synonym) return null;
  const updated = { ...synonym, ...data, id, createdAt: synonym.createdAt, updatedAt: new Date().toISOString() };
  return store.update('service_synonyms', id, updated);
}

function deleteSynonym(keyword) {
  const list = listSynonyms();
  const idx = list.findIndex(s => s.keyword === keyword);
  if (idx === -1) return false;
  const id = list[idx].id;
  return store.remove('service_synonyms', id);
}

// ========== 未命中问题池 ==========

function listUnmatched() {
  return store.read('service_unmatched', []);
}

function addUnmatched(question, role, timestamp) {
  const id = store.nextId('service_unmatched', 'um');
  const entry = {
    id,
    question: question || '',
    role: role || 'cs',
    timestamp: timestamp || new Date().toISOString(),
    status: 'pending',
  };
  store.push('service_unmatched', entry);
  return entry;
}

function clearUnmatched() {
  store.write('service_unmatched', []);
  return true;
}

function deleteUnmatched(id) {
  return store.remove('service_unmatched', id);
}

// ========== 聊天记录（用于客服效果指标） ==========

function listChatLogs() {
  return store.read('service_chat_logs', []);
}

function addChatLog(entry) {
  const log = {
    id: store.nextId('service_chat_logs', 'scl'),
    question: entry.question || '',
    matched: entry.matched !== false,
    matchCount: typeof entry.matchCount === 'number' ? entry.matchCount : 0,
    keyword: entry.keyword || null,
    publicFallback: entry.publicFallback || false,
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  store.push('service_chat_logs', log);
  return log;
}

// ========== 效果指标 ==========

function calculateMetrics() {
  const logs = listChatLogs();
  const total = logs.length;
  if (total === 0) {
    return {
      totalRequests: 0,
      hitRate: 0,
      fallbackRate: 0,
      transferRate: 0,
      avgKeywordHits: 0,
      hitCount: 0,
      fallbackCount: 0,
      unmatchedCount: 0,
    };
  }
  const hitCount = logs.filter(l => l.matched).length;
  const fallbackCount = logs.filter(l => l.publicFallback).length;
  const unmatchedCount = total - hitCount;
  const totalKeywordHits = logs.reduce((s, l) => s + (l.matchCount || 0), 0);

  return {
    totalRequests: total,
    hitRate: Math.round((hitCount / total) * 10000) / 100,
    fallbackRate: Math.round((fallbackCount / total) * 10000) / 100,
    transferRate: Math.round((unmatchedCount / total) * 10000) / 100,
    avgKeywordHits: hitCount > 0 ? Math.round((totalKeywordHits / hitCount) * 100) / 100 : 0,
    hitCount,
    fallbackCount,
    unmatchedCount,
  };
}

module.exports = {
  listPhrases, getPhrase, addPhrase, updatePhrase, deletePhrase,
  listSynonyms, getSynonym, addSynonym, updateSynonym, deleteSynonym,
  listUnmatched, addUnmatched, clearUnmatched, deleteUnmatched,
  listChatLogs, addChatLog, calculateMetrics,
};