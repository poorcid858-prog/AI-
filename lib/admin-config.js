/**
 * 管理后台配置管理
 * 统一管理：密码配置、Chunk 切分、分层 Prompt、系统参数
 */

const store = require('./store');

// ========== 密码配置 ==========

function getPasswordConfig() {
  const configs = store.read('password_configs', []);
  return configs[0] || {
    id: 1,
    enabled: false,
    default_expire_minutes: 120,
    max_expire_minutes: 1440,
    complexity: 'medium',
  };
}

function updatePasswordConfig(data) {
  const config = { id: 1, ...data, updatedAt: new Date().toISOString() };
  const configs = store.read('password_configs', []);
  configs[0] = config;
  store.write('password_configs', configs);
  return config;
}

// ========== Chunk 切分配置 ==========

function getChunkingConfig() {
  const configs = store.read('chunking_configs', []);
  return configs[0] || {
    id: 1,
    strategy: 'section',
    max_tokens: 600,
    overlap_tokens: 50,
    header_level: 3,
  };
}

function updateChunkingConfig(data) {
  const config = { id: 1, ...data, updatedAt: new Date().toISOString() };
  const configs = store.read('chunking_configs', []);
  configs[0] = config;
  store.write('chunking_configs', configs);
  return config;
}

// ========== 分层 Prompt 配置 ==========

function listPromptLayers() {
  return store.read('prompt_layers', []);
}

function getPromptLayer(id) {
  const layers = listPromptLayers();
  return layers.find(l => l.id === id);
}

function createPromptLayer(data) {
  const id = store.nextId('prompt_layers', 'pl');
  const layer = {
    id,
    ...data,
    createdAt: new Date().toISOString(),
  };
  store.push('prompt_layers', layer);
  return layer;
}

function updatePromptLayer(id, data) {
  const layers = listPromptLayers();
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return null;
  layers[idx] = {
    ...layers[idx],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  store.write('prompt_layers', layers);
  return layers[idx];
}

function deletePromptLayer(id) {
  const layers = listPromptLayers();
  const idx = layers.findIndex(l => l.id === id);
  if (idx === -1) return false;
  layers.splice(idx, 1);
  store.write('prompt_layers', layers);
  return true;
}

// ========== 系统参数配置 ==========

function getSystemConfig(key) {
  const configs = store.read('system_configs', []);
  if (key) {
    const config = configs.find(c => c.key === key);
    return config ? config.value : null;
  }
  return configs;
}

function getAllSystemConfig() {
  return store.read('system_configs', []);
}

function updateSystemConfig(key, value) {
  const configs = store.read('system_configs', []);
  const idx = configs.findIndex(c => c.key === key);

  const config = {
    key,
    value,
    updatedAt: new Date().toISOString(),
  };

  if (idx === -1) {
    config.id = store.nextId('system_configs', 'sc');
    configs.push(config);
  } else {
    config.id = configs[idx].id;
    config.createdAt = configs[idx].createdAt;
    configs[idx] = config;
  }

  store.write('system_configs', configs);
  return config;
}

function deleteSystemConfig(key) {
  const configs = store.read('system_configs', []);
  const idx = configs.findIndex(c => c.key === key);
  if (idx === -1) return false;
  configs.splice(idx, 1);
  store.write('system_configs', configs);
  return true;
}

// ========== 临时密码管理 ==========

function listTempPasswords() {
  return store.read('temp_passwords', []);
}

function generateTempPassword(password, expiryMinutes) {
  const id = store.nextId('temp_passwords', 'tp');
  const created_at = new Date();
  const expire_at = new Date(created_at.getTime() + expiryMinutes * 60000);

  const tempPassword = {
    id,
    password,
    created_at: created_at.toISOString(),
    expire_at: expire_at.toISOString(),
    used: false,
  };

  store.push('temp_passwords', tempPassword);
  return tempPassword;
}

function useTempPassword(id) {
  const passwords = listTempPasswords();
  const idx = passwords.findIndex(p => p.id === id);
  if (idx === -1) return null;

  const pwd = passwords[idx];
  if (pwd.used) return null;
  if (new Date(pwd.expire_at) < new Date()) return null;

  passwords[idx].used = true;
  passwords[idx].used_at = new Date().toISOString();
  store.write('temp_passwords', passwords);
  return passwords[idx];
}

// ========== 模型配置 ==========

function listModels() {
  return store.read('models', []);
}

function getModel(id) {
  return listModels().find(m => m.id === id);
}

function createModel(data) {
  const id = store.nextId('models', 'm');
  const model = {
    id,
    name: data.name || '',
    type: data.type || 'text',
    apiUrl: data.apiUrl || '',
    apiKey: data.apiKey || '',
    temperature: typeof data.temperature === 'number' ? data.temperature : 0.3,
    maxTokens: typeof data.maxTokens === 'number' ? data.maxTokens : 4096,
    enabled: data.enabled !== false,
    createdAt: new Date().toISOString(),
  };
  store.push('models', model);
  return model;
}

function updateModel(id, data) {
  const model = getModel(id);
  if (!model) return null;
  const updated = {
    ...model,
    ...data,
    id: model.id,
    createdAt: model.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return store.update('models', id, updated);
}

function deleteModel(id) {
  return store.remove('models', id);
}

// ========== AI 日志 ==========

function listAiLogs(limit = 100, offset = 0) {
  const logs = store.read('ai_logs', []);
  return logs.slice(offset, offset + limit);
}

function getAllAiLogs() {
  return store.read('ai_logs', []);
}

function addAiLog(entry) {
  const log = {
    id: store.nextId('ai_logs', 'log'),
    requestId: entry.requestId || '',
    userId: entry.userId || '',
    userName: entry.userName || '',
    model: entry.model || '',
    promptTokens: typeof entry.promptTokens === 'number' ? entry.promptTokens : 0,
    completionTokens: typeof entry.completionTokens === 'number' ? entry.completionTokens : 0,
    duration: typeof entry.duration === 'number' ? entry.duration : 0,
    status: entry.status || 'success',
    error: entry.error || null,
    timestamp: entry.timestamp || new Date().toISOString(),
  };
  store.push('ai_logs', log);
  return log;
}

function getAiLogStats() {
  const logs = store.read('ai_logs', []);
  const total = logs.length;
  const success = logs.filter(l => l.status === 'success').length;
  const failed = total - success;
  const avgDuration = total > 0
    ? Math.round(logs.reduce((s, l) => s + (l.duration || 0), 0) / total)
    : 0;
  const totalTokens = logs.reduce((s, l) => s + (l.promptTokens || 0) + (l.completionTokens || 0), 0);
  return { total, success, failed, avgDuration, totalTokens };
}

module.exports = {
  // 密码配置
  getPasswordConfig,
  updatePasswordConfig,

  // Chunk 切分配置
  getChunkingConfig,
  updateChunkingConfig,

  // 分层 Prompt 配置
  listPromptLayers,
  getPromptLayer,
  createPromptLayer,
  updatePromptLayer,
  deletePromptLayer,

  // 系统参数配置
  getAllSystemConfig,
  getSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,

  // 临时密码
  listTempPasswords,
  generateTempPassword,
  useTempPassword,

  // 模型配置
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,

  // AI 日志
  listAiLogs,
  getAllAiLogs,
  addAiLog,
  getAiLogStats,
};
