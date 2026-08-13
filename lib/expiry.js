/**
 * 需求 9：文档过期管理与自动归档
 *
 * 功能：
 *   1. 过期检查扫描：找出即将过期 / 已过期的文档
 *   2. 自动处理：将已过期的 published 文档转为 need_review
 *   3. 复审查询：获取即将到期 / 已过期文档列表
 *   4. 过期标记判断：检查某 std 是否已过期
 *
 * 设计要点：
 *   - validUntil 字段存储在 raw_documents 层（上传时设置）
 *   - 过期检查通过 raw.validUntil 判断，涉及已发布的 std
 *   - 过期后 published → need_review（状态机已有此流转）
 *   - need_review 仍可检索，但 AI 答案标注可能过期
 */

const kl = require('./knowledge-layers');

// ============================================================
// 1. 过期检查扫描
// ============================================================

/**
 * 扫描即将到期的文档列表。
 * 条件：published 状态、有 validUntil 值、未归档、validUntil 在指定天数内
 *
 * @param {number} days 未来多少天（默认 7）
 * @returns {Array<{rawId, stdId, title, validUntil, owner}>}
 */
function scanExpiringDocs(days) {
  const window = typeof days === 'number' ? days : 7;
  const now = Date.now();
  const deadline = now + window * 24 * 3600 * 1000;

  const result = [];
  const raws = kl.listRaws();
  const stds = kl.listStds();

  for (const raw of raws) {
    if (!raw.validUntil) continue;

    const validUntilTime = new Date(raw.validUntil).getTime();
    // 只关心即将到期、还没到期的
    if (validUntilTime <= now || validUntilTime > deadline) continue;

    // 找到该 raw 下已发布且生效的 std
    const currentStd = stds.find(
      (s) => s.rawId === raw.id && s.isCurrent && s.status === kl.STD_STATUS.PUBLISHED
    );
    if (!currentStd) continue;

    result.push({
      rawId: raw.id,
      stdId: currentStd.id,
      title: raw.title,
      validUntil: raw.validUntil,
      owner: raw.owner,
    });
  }

  return result;
}

/**
 * 处理已过期文档：将 expired 的 published 文档转为 need_review。
 *
 * @returns {number} 处理的数量
 */
function processExpired() {
  let count = 0;
  const now = Date.now();
  const raws = kl.listRaws();
  const stds = kl.listStds();

  for (const raw of raws) {
    if (!raw.validUntil) continue;

    const validUntilTime = new Date(raw.validUntil).getTime();
    // 还没过期
    if (validUntilTime > now) continue;

    // 找该 raw 下已发布且生效的 std
    const currentStd = stds.find(
      (s) => s.rawId === raw.id && s.isCurrent && s.status === kl.STD_STATUS.PUBLISHED
    );
    if (!currentStd) continue;

    // 转为 need_review
    try {
      kl.markNeedReview(currentStd.id);
      count += 1;
    } catch (_) {
      // 跳过已处理或不能流转的
    }
  }

  return count;
}

// ============================================================
// 2. 复审查询
// ============================================================

/**
 * 获取即将到期的文档列表（用于复审通知）。
 *
 * @param {number} days 未来多少天
 * @returns {Array<{rawId, stdId, title, validUntil, owner, daysLeft}>}
 */
function getExpiringDocs(days) {
  const window = typeof days === 'number' ? days : 7;
  const now = Date.now();
  const deadline = now + window * 24 * 3600 * 1000;

  const result = [];
  const raws = kl.listRaws();
  const stds = kl.listStds();

  for (const raw of raws) {
    if (!raw.validUntil) continue;

    const validUntilTime = new Date(raw.validUntil).getTime();
    if (validUntilTime <= now || validUntilTime > deadline) continue;

    const currentStd = stds.find(
      (s) => s.rawId === raw.id && s.isCurrent && s.status === kl.STD_STATUS.PUBLISHED
    );
    if (!currentStd) continue;

    const daysLeft = Math.round((validUntilTime - now) / (24 * 3600 * 1000));
    result.push({
      rawId: raw.id,
      stdId: currentStd.id,
      title: raw.title,
      validUntil: raw.validUntil,
      owner: raw.owner,
      daysLeft,
    });
  }

  return result;
}

/**
 * 获取已过期的文档列表（status = need_review 且 validUntil 已过）。
 *
 * @returns {Array<{rawId, stdId, title, validUntil, owner, daysOverdue}>}
 */
function getExpiredDocs() {
  const now = Date.now();
  const result = [];
  const raws = kl.listRaws();
  const stds = kl.listStds();

  for (const raw of raws) {
    if (!raw.validUntil) continue;

    const validUntilTime = new Date(raw.validUntil).getTime();
    if (validUntilTime > now) continue;

    // 找该 raw 下 need_review 且生效的 std
    const currentStd = stds.find(
      (s) => s.rawId === raw.id && s.isCurrent && s.status === kl.STD_STATUS.NEED_REVIEW
    );
    if (!currentStd) continue;

    const daysOverdue = Math.round((now - validUntilTime) / (24 * 3600 * 1000));
    result.push({
      rawId: raw.id,
      stdId: currentStd.id,
      title: raw.title,
      validUntil: raw.validUntil,
      owner: raw.owner,
      daysOverdue,
    });
  }

  return result;
}

// ============================================================
// 3. 过期标记判断
// ============================================================

/**
 * 判断某 std 是否已过期（需要 AI 答案标注"可能已过期"）。
 *
 * @param {string} stdId
 * @returns {boolean}
 */
function isStdExpired(stdId) {
  const std = kl.getStd(stdId);
  if (!std) return false;

  // need_review 状态即为过期
  if (std.status === kl.STD_STATUS.NEED_REVIEW) return true;

  // 检查 raw 的 validUntil 是否已过
  const raw = kl.getRaw(std.rawId);
  if (!raw || !raw.validUntil) return false;

  return new Date(raw.validUntil).getTime() <= Date.now();
}

module.exports = {
  scanExpiringDocs,
  processExpired,
  getExpiringDocs,
  getExpiredDocs,
  isStdExpired,
};