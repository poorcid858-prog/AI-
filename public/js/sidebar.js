/**
 * 全局左侧边栏导航组件 —— K1
 *
 * 6 大一级模块：AI工作台 / 知识中心 / 能力中心 / 审核中心 / 运营与管理中心 / 系统管理
 * 每个模块可折叠展开二级子菜单，支持角色过滤、当前激活项高亮、侧栏折叠/展开。
 *
 * 用法：
 *   App.renderSidebar('knowledge', 'dv')     // 模块 + 子项
 *   App.renderSidebar('knowledge')           // 只传模块，子项无高亮
 */
(function () {
  // ------------------------- 菜单配置（6 大模块） -------------------------
  const MODULES = [
    {
      key: 'workbench',
      label: 'AI 工作台',
      icon: '🤖',
      children: [
        { key: 'product', label: '产品助手', href: '/workspace.html?role=product', roles: ['product', 'admin', 'reviewer', 'guest'] },
        { key: 'test', label: '测试助手', href: '/workspace.html?role=test', roles: ['test', 'admin', 'reviewer', 'guest'] },
        { key: 'frontend', label: '前端助手', href: '/workspace.html?role=frontend', roles: ['frontend', 'admin', 'reviewer', 'guest'] },
        { key: 'chat', label: 'AI 对话', href: '/workspace.html', roles: ['product', 'test', 'frontend', 'cs', 'admin', 'reviewer', 'guest'] },
        { key: 'history', label: '历史记录', href: '/operations.html', roles: ['admin', 'reviewer', 'guest'] },
      ],
    },
    {
      key: 'knowledge',
      label: '知识中心',
      icon: '📚',
      children: [
        { key: 'kb', label: '知识库', href: '/knowledge.html', roles: ['product', 'test', 'frontend', 'cs', 'admin', 'reviewer', 'guest'] },
        { key: 'doc', label: '文档管理', href: '/admin.html', roles: ['admin', 'guest'] },
        { key: 'chunk', label: 'Chunk 管理', href: '/knowledge.html?tab=chunks', roles: ['admin', 'reviewer'] },
        { key: 'search', label: '知识检索', href: '/knowledge.html?tab=search', roles: ['product', 'test', 'frontend', 'cs', 'admin', 'reviewer', 'guest'] },
      ],
    },
    {
      key: 'capability',
      label: '能力中心',
      icon: '⚡',
      children: [
        { key: 'aggregate', label: 'AI 能力', href: '/capability.html', roles: ['admin', 'reviewer', 'product', 'test', 'frontend', 'cs', 'guest'] },
        { key: 'workflow', label: 'Workflow', href: '/capability.html#workflow', roles: ['admin', 'reviewer'] },
        { key: 'skill', label: 'Skill', href: '/capability.html#skill', roles: ['admin', 'reviewer'] },
        { key: 'reference', label: 'Reference', href: '/capability.html#reference', roles: ['admin', 'reviewer'] },
        { key: 'prompt', label: 'Prompt', href: '/capability.html#prompt', roles: ['admin'] },
        { key: 'tool', label: 'Tool/Script', href: '/capability.html#tool', roles: ['admin', 'reviewer'] },
      ],
    },
    {
      key: 'review',
      label: '审核中心',
      icon: '🗂️',
      children: [
        { key: 'knowledge-review', label: '知识审核', href: '/review.html', roles: ['admin', 'reviewer', 'guest'] },
        { key: 'capability-review', label: '能力审核', href: '/review.html?tab=capability', roles: ['admin', 'reviewer'] },
        { key: 'ai-review', label: 'AI 结果审核', href: '/admin-qa.html', roles: ['admin', 'reviewer', 'guest'] },
      ],
    },
    {
      key: 'operations',
      label: '运营与管理中心',
      icon: '📊',
      children: [
        { key: 'usage', label: '使用分析', href: '/operations.html', roles: ['admin', 'reviewer'] },
        { key: 'effect', label: 'AI 效果分析', href: '/operations.html#effect', roles: ['admin', 'reviewer'] },
        { key: 'capability-op', label: '能力运营', href: '/operations.html#capability', roles: ['admin', 'reviewer'] },
        { key: 'diagnostics', label: '问题定位', href: '/operations.html#link', roles: ['admin', 'reviewer'] },
      ],
    },
    {
      key: 'admin',
      label: '系统管理',
      icon: '⚙️',
      children: [
        { key: 'users', label: '用户/角色', href: '/admin-users.html', roles: ['admin'] },
        { key: 'permission', label: '权限管理', href: '/admin-users.html#permission', roles: ['admin'] },
        { key: 'model', label: '模型配置', href: '/admin-model.html', roles: ['admin'] },
        { key: 'log', label: 'AI 日志', href: '/admin-logs.html', roles: ['admin'] },
        { key: 'config', label: '系统配置', href: '/admin-config.html', roles: ['admin'] },
      ],
    },
  ];

  /**
   * 渲染左侧边栏。
   * @param {string} moduleKey 当前模块（一级菜单）
   * @param {string} itemKey   当前子项（二级菜单，可省略）
   */
  function renderSidebar(moduleKey, itemKey) {
    const u = App.user;
    const role = u ? u.role : 'guest';

    // 计算某一模块当前是否应该展示（二级菜单中至少一个子项对当前角色可见）
    function moduleVisible(mod) {
      return mod.children.some((c) => c.roles.includes(role));
    }

    // 过滤后的可见模块
    const visibleModules = MODULES.filter(moduleVisible);

    // 当前激活模块
    const activeModule = MODULES.find((m) => m.key === moduleKey);
    const activeModuleLabel = activeModule ? activeModule.label : '';

    // 构建侧边栏 HTML
    const sidebarHTML = `
      <aside class="app-sidebar" id="appSidebar">
        <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="折叠侧边栏" type="button">
          <span class="collapse-icon">«</span>
        </button>
        <nav class="sidebar-nav">
          ${visibleModules.map((m) => {
            const isOpen = m.key === moduleKey;
            const childrenHtml = m.children
              .filter((c) => c.roles.includes(role))
              .map((c) => {
                const active = c.key === itemKey;
                return `<a class="sidebar-item ${active ? 'active' : ''}" href="${c.href}" data-item-key="${c.key}">
                  <span class="sidebar-item-dot"></span>${c.label}
                </a>`;
              }).join('');
            return `
              <div class="sidebar-module ${isOpen ? 'open' : ''} ${m.key === moduleKey ? 'active' : ''}" data-module-key="${m.key}">
                <div class="sidebar-module-head" data-toggle="module">
                  <span class="sidebar-module-icon">${m.icon}</span>
                  <span class="sidebar-module-label">${m.label}</span>
                  <span class="sidebar-module-arrow">▾</span>
                </div>
                <div class="sidebar-children">${childrenHtml}</div>
              </div>`;
          }).join('')}
        </nav>
      </aside>`;

    // 顶部栏（品牌 + 用户区）
    const topbarHTML = `
      <header class="app-topbar">
        <div class="topbar-left">
          <button class="topbar-menu-btn" id="topbarMenuBtn" type="button" title="菜单">☰</button>
          <a class="brand" href="/dashboard.html">企业 AI 辅助工具</a>
        </div>
        <div class="topuser">
          ${u.readonly ? '<span class="tag ro">只读演示</span>' : ''}
          <span class="tag ${u.bizLine}">${u.bizLineLabel || u.bizLine}</span>
          <div class="avatar ${u.role}" title="${u.roleLabel || u.role}">${u.avatar || u.name[0]}</div>
          <span class="uname">${u.name}</span>
          <button class="btn btn-sm" onclick="App.logout()">退出</button>
        </div>
      </header>`;

    // 主内容包装：把已有的 <body> 直接子元素包进 <div class="app-layout"> 中。为避免破坏页面布局，
    // 采用动态创建方式：顶栏+侧栏 preprend 到 body，其余内容由各页面的 .page/.workspace 容器承载。
    const shell = document.createElement('div');
    shell.className = 'app-shell';
    shell.innerHTML = `<div class="app-sidebar-area">${sidebarHTML}</div><div class="app-content-area">${topbarHTML}<div class="app-page-body"></div></div>`;

    document.body.prepend(shell);

    // 把 body 现有的非 shell 子元素移动到 .app-page-body 里（避免覆盖原页面结构）
    const pageBody = shell.querySelector('.app-page-body');
    const existing = Array.from(document.body.children).filter((el) => el !== shell);
    existing.forEach((el) => pageBody.appendChild(el));

    // ---- 交互：模块内子菜单展开/收起 ----
    shell.querySelectorAll('.sidebar-module-head').forEach((head) => {
      head.addEventListener('click', function () {
        const mod = this.closest('.sidebar-module');
        const wasOpen = mod.classList.contains('open');
        // 关闭其他展开的模块
        shell.querySelectorAll('.sidebar-module.open').forEach((m) => m.classList.remove('open'));
        if (!wasOpen) mod.classList.add('open');
      });
    });

    // ---- 折叠/展开整个侧栏 ----
    const sidebarEl = shell.querySelector('.app-sidebar');
    const collapseBtn = shell.querySelector('#sidebarCollapseBtn');

    function setCollapsed(collapsed) {
      shell.classList.toggle('sidebar-collapsed', collapsed);
      localStorage.setItem('app-sidebar-collapsed', collapsed ? '1' : '0');
      const icon = shell.querySelector('.collapse-icon');
      if (icon) icon.textContent = collapsed ? '»' : '«';
    }

    // 恢复上次折叠状态
    if (localStorage.getItem('app-sidebar-collapsed') === '1') {
      setCollapsed(true);
    }

    collapseBtn.addEventListener('click', () => {
      setCollapsed(!shell.classList.contains('sidebar-collapsed'));
    });

    // ---- 响应式：窄屏点击汉堡菜单切换 ----
    function setMobileOpen(open) {
      shell.classList.toggle('sidebar-mobile-open', open);
    }
    const menuBtn = shell.querySelector('#topbarMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        const open = shell.classList.toggle('sidebar-mobile-open');
        // 点击侧栏外的遮罩关闭
        if (open) {
          const mask = document.createElement('div');
          mask.className = 'sidebar-mask';
          mask.addEventListener('click', () => setMobileOpen(false));
          shell.appendChild(mask);
        } else {
          shell.querySelectorAll('.sidebar-mask').forEach((m) => m.remove());
        }
      });
    }

    return shell;
  }

  // 暴露到 App
  if (typeof App !== 'undefined') {
    App.renderSidebar = renderSidebar;
  }
})();