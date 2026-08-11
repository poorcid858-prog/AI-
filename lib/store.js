/**
 * 简易 JSON 文件存储
 *
 * 为什么不用数据库：本项目是流程演示，数据要能被你直接打开查看和修改。
 * 每个 JSON 文件相当于一张表，读写全量覆盖 —— 演示级并发下足够。
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');

/** 内存缓存，避免每次请求都读盘 */
const cache = new Map();

function filePath(name) {
  return path.join(config.paths.data, `${name}.json`);
}

/**
 * 读取一张"表"
 * @param {string} name 文件名（不含 .json）
 * @param {*} fallback 文件不存在时的默认值
 */
function read(name, fallback = []) {
  if (cache.has(name)) return cache.get(name);

  const fp = filePath(name);
  let value = fallback;
  if (fs.existsSync(fp)) {
    try {
      value = JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (err) {
      console.error(`[store] ${name}.json 解析失败，使用默认值:`, err.message);
      value = fallback;
    }
  }
  cache.set(name, value);
  return value;
}

/** 全量写回并同步缓存 */
function write(name, value) {
  if (!fs.existsSync(config.paths.data)) {
    fs.mkdirSync(config.paths.data, { recursive: true });
  }
  fs.writeFileSync(filePath(name), JSON.stringify(value, null, 2), 'utf8');
  cache.set(name, value);
  return value;
}

/** 向数组型表追加一条并落盘 */
function push(name, item) {
  const list = read(name, []);
  list.push(item);
  write(name, list);
  return item;
}

/** 按 id 更新一条，返回更新后的对象；不存在返回 null */
function update(name, id, patch) {
  const list = read(name, []);
  const idx = list.findIndex((it) => it.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch };
  write(name, list);
  return list[idx];
}

/** 按 id 删除一条，返回是否删除成功 */
function remove(name, id) {
  const list = read(name, []);
  const next = list.filter((it) => it.id !== id);
  if (next.length === list.length) return false;
  write(name, next);
  return true;
}

/** 清空缓存（测试与数据重置后调用） */
function clearCache() {
  cache.clear();
}

/**
 * 生成带前缀的自增 ID，如 doc_001
 * 基于现有表内最大序号 +1，重启后不会重复
 */
function nextId(name, prefix) {
  const list = read(name, []);
  let max = 0;
  for (const it of list) {
    const m = String(it.id || '').match(/_(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}_${String(max + 1).padStart(3, '0')}`;
}

module.exports = { read, write, push, update, remove, clearCache, nextId, filePath };
