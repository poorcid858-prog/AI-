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

  /** 渲染顶栏 */
  renderHeader(activeKey) {
    const u = this.user;
    const p = this.permissions;
    const nav = [
      { key: 'dashboard', label: '首页', href: '/dashboard.html', show: true },
      { key: 'workspace', label: '工作台', href: '/workspace.html', show: true },
      { key: 'knowledge', label: '知识库', href: '/knowledge.html', show: true },
      { key: 'knowledge-quality', label: '知识质量', href: '/knowledge-quality.html', show: u.role === 'admin' || u.role === 'reviewer' },
      { key: 'capability', label: '能力中心', href: '/capability.html', show: true },
      { key: 'operations', label: '运营中心', href: '/operations.html', show: u.role === 'admin' || u.role === 'reviewer' },
      { key: 'review', label: '审核', href: '/review.html', show: u.role === 'reviewer' || u.role === 'admin' || u.role === 'guest' },
      { key: 'admin', label: '管理后台', href: '/admin.html', show: u.role === 'admin' || u.role === 'guest' },
      { key: 'admin-config', label: '系统配置', href: '/admin-config.html', show: u.role === 'admin' },
      { key: 'admin-model', label: '模型配置', href: '/admin-model.html', show: u.role === 'admin' },
      { key: 'admin-logs', label: 'AI 日志', href: '/admin-logs.html', show: u.role === 'admin' },
      { key: 'admin-users', label: '用户管理', href: '/admin-users.html', show: u.role === 'admin' },
    ].filter((n) => n.show);

    const el = document.createElement('header');
    el.className = 'topbar';
    el.innerHTML = `
      <div class="topbar-inner">
        <a class="brand" href="/dashboard.html">企业 AI 辅助工具</a>
        <nav class="topnav">
          ${nav.map((n) => `<a href="${n.href}" class="${n.key === activeKey ? 'on' : ''}">${n.label}</a>`).join('')}
        </nav>
        <div class="topuser">
          ${u.readonly ? '<span class="tag ro">只读演示</span>' : ''}
          <span class="tag ${u.bizLine}">${u.bizLineLabel || u.bizLine}</span>
          <div class="avatar ${u.role}" title="${u.roleLabel || u.role}">${u.avatar || u.name[0]}</div>
          <span class="uname">${u.name}</span>
          <button class="btn btn-sm" onclick="App.logout()">退出</button>
        </div>
      </div>`;
    document.body.prepend(el);
  },

  /** HTML 转义，防止模拟文档内容里的尖括号破坏页面 */
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  toast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2600);
  },
};
