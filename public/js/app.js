/**
 * 前端公共脚本 —— 会话、请求、导航
 */

const App = {
  get token() { return localStorage.getItem('token') || ''; },
  get user() {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  },
  get permissions() {
    try { return JSON.parse(localStorage.getItem('permissions') || '{}'); } catch { return {}; }
  },

  /** 未登录则踢回登录页 */
  guard() {
    if (!this.token || !this.user) {
      location.replace('/index.html');
      return false;
    }
    return true;
  },

  logout() {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${this.token}` } })
      .catch(() => {})
      .finally(() => {
        localStorage.clear();
        location.replace('/index.html');
      });
  },

  /** 带 token 的 fetch，统一处理 401 与错误提示 */
  async api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      localStorage.clear();
      location.replace('/index.html');
      throw new Error('登录已过期');
    }
    const data = await res.json().catch(() => ({ ok: false, error: '响应解析失败' }));
    if (!data.ok) throw new Error(data.error || `请求失败 (${res.status})`);
    return data;
  },

  /**
   * 渲染左侧边栏导航（K1 重构）。
   * @param {string} moduleKey 一级模块 key（如 'knowledge'）
   * @param {string} itemKey   二级子项 key（可省略）
   */
  renderSidebar(moduleKey, itemKey) {
    // 兼容：若 sidebar.js 已加载并以 App.renderSidebar 注入，则优先用它
    if (typeof Sidebar !== 'undefined' && Sidebar.render) {
      return Sidebar.render(moduleKey, itemKey);
    }
    // 兜底：如果 sidebar.js 尚未加载，给出可读错误提示
    // eslint-disable-next-line no-console
    console.warn('[sidebar] 未加载 sidebar.js，无法渲染侧边栏');
    return null;
  },

  /** 渲染顶栏（兼容保留，实际转发到 renderSidebar，避免老调用直接失效） */
  renderHeader(activeKey) {
    // 旧顶栏扁平导航已移除，改为左侧边栏。
    // 为兼容历史页面残留调用，把旧参数映射到新模块结构：
    //   旧 activeKey → 新 moduleKey
    const MAP = {
      dashboard: 'workbench',
      workspace: 'workbench',
      knowledge: 'knowledge',
      'knowledge-quality': 'knowledge',
      capability: 'capability',
      review: 'review',
      operations: 'operations',
      admin: 'admin',
      'admin-config': 'admin',
      'admin-model': 'admin',
      'admin-logs': 'admin',
      'admin-users': 'admin',
    };
    return this.renderSidebar(MAP[activeKey] || activeKey, '');
  },

  /** HTML 转义，防止模拟文档内容里的尖括号破坏页面 */
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  /** 确认弹窗（使用 SweetAlert2 如果可用，否则回退到原生 confirm） */
  confirm(msg) {
    if (typeof Swal !== 'undefined') {
      return Swal.fire({
        title: '确认操作',
        text: msg,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3b82f6',
        cancelButtonColor: '#6b7280',
        confirmButtonText: '确认',
        cancelButtonText: '取消',
        background: '#171d24',
        color: '#e4e9ef',
      }).then((result) => result.isConfirmed);
    }
    return Promise.resolve(confirm(msg));
  },

  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2600);
  },
};
