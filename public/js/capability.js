/**
 * 能力中心前端交互脚本
 *
 * 功能：管理 5 种能力（Workflow、Skill、Reference、Script、Tool）
 * API 调用：与后端 /api/capability/... 交互
 */

// 全局状态
let currentType = 'workflow';
let currentPage = 1;
let currentCapabilities = [];

/**
 * 1. 加载能力列表
 * 注：后端 API 为 GET /api/capabilities （不分页、不按类型过滤）
 * 前端做客户端过滤
 */
async function loadCapabilities(type = currentType, page = 1) {
  try {
    const response = await fetch(App.base + '/api/capabilities');

    if (!response.ok) {
      console.error('加载列表失败:', response.statusText);
      return;
    }

    const data = await response.json();
    const allCapabilities = (data.capabilities || []).map(cap => ({
      id: cap.id,
      name: cap.name,
      description: cap.description,
      type: cap.type,
      created_at: cap.created_at,
      is_active: true,
    }));

    // 客户端过滤
    currentCapabilities = allCapabilities.filter(cap => cap.type === type);
    currentPage = page;
    currentType = type;

    renderList(currentCapabilities);
    renderPagination(currentCapabilities.length, page, 10);
  } catch (error) {
    console.error('加载列表错误:', error);
  }
}

/**
 * 2. 渲染列表
 */
function renderList(items) {
  const tbody = document.querySelector('#capability-list tbody');
  if (!tbody) return;

  tbody.innerHTML = items.map(item => `
    <tr onclick="showDetail(${item.id})">
      <td>${item.name || '未命名'}</td>
      <td>${item.description || '-'}</td>
      <td>${formatDate(item.created_at)}</td>
      <td>
        <span class="status-${item.is_active ? 'active' : 'inactive'}">
          ${item.is_active ? '启用' : '禁用'}
        </span>
      </td>
    </tr>
  `).join('');
}

/**
 * 3. 渲染分页
 */
function renderPagination(total, currentPage, pageSize) {
  const container = document.querySelector('.pagination');
  if (!container) return;

  const totalPages = Math.ceil(total / pageSize);
  let html = '';

  // 上一页
  if (currentPage > 1) {
    html += `<button onclick="loadCapabilities('${currentType}', ${currentPage - 1})">上一页</button>`;
  }

  // 页码
  for (let i = 1; i <= Math.min(totalPages, 5); i++) {
    const activeClass = i === currentPage ? 'active' : '';
    html += `<button class="${activeClass}" onclick="loadCapabilities('${currentType}', ${i})">${i}</button>`;
  }

  // 下一页
  if (currentPage < totalPages) {
    html += `<button onclick="loadCapabilities('${currentType}', ${currentPage + 1})">下一页</button>`;
  }

  container.innerHTML = html;
}

/**
 * 4. 显示详情
 * 调用 GET /api/capabilities/:id
 */
async function showDetail(id) {
  try {
    const response = await fetch(App.base + `/api/capabilities/${id}`);

    if (!response.ok) {
      console.error('加载详情失败');
      return;
    }

    const data = await response.json();
    renderDetail(data.capability);
  } catch (error) {
    console.error('加载详情错误:', error);
  }
}

/**
 * 5. 渲染详情和编辑表单
 */
function renderDetail(capability) {
  const container = document.querySelector('#detail-content');
  if (!container) return;

  const html = `
    <div class="detail-view">
      <h3>${capability.name}</h3>

      <form onsubmit="saveCapability(event, ${capability.id})">
        <div class="form-group">
          <label>名称</label>
          <input type="text" name="name" value="${capability.name || ''}" required>
        </div>

        <div class="form-group">
          <label>描述</label>
          <textarea name="description">${capability.description || ''}</textarea>
        </div>

        <div class="form-group">
          <label>类型</label>
          <select name="type" disabled>
            <option value="${capability.type}" selected>${capability.type}</option>
          </select>
        </div>

        <div class="form-group">
          <label>
            <input type="checkbox" name="is_active" ${capability.is_active ? 'checked' : ''}>
            启用
          </label>
        </div>

        <div class="button-group">
          <button type="submit" class="btn-primary">保存</button>
          <button type="button" class="btn-danger" onclick="deleteCapability(${capability.id})">删除</button>
          <button type="button" class="btn-secondary" onclick="clearDetail()">取消</button>
        </div>
      </form>
    </div>
  `;

  container.innerHTML = html;
}

/**
 * 6. 保存能力
 * 调用 POST /api/capabilities/:id/draft（编辑草稿）
 */
async function saveCapability(event, id) {
  event.preventDefault();

  const form = event.target;
  const formData = new FormData(form);

  const data = {
    content: {
      name: formData.get('name'),
      description: formData.get('description'),
      is_active: formData.get('is_active') ? true : false,
    },
  };

  try {
    const response = await fetch(App.base + `/api/capabilities/${id}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('保存失败:', errorData.error);
      alert('保存失败: ' + (errorData.error || response.statusText));
      return;
    }

    console.log('保存成功');
    loadCapabilities(currentType, currentPage);
    clearDetail();
  } catch (error) {
    console.error('保存错误:', error);
    alert('保存出错: ' + error.message);
  }
}

/**
 * 7. 删除能力
 * 调用 DELETE /api/capabilities/:id
 */
async function deleteCapability(id) {
  if (!(await App.confirm('确定要删除这个能力吗？'))) {
    return;
  }

  try {
    const response = await fetch(App.base + `/api/capabilities/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('删除失败:', errorData.error);
      alert('删除失败: ' + (errorData.error || response.statusText));
      return;
    }

    console.log('删除成功');
    loadCapabilities(currentType, currentPage);
    clearDetail();
  } catch (error) {
    console.error('删除错误:', error);
    alert('删除出错: ' + error.message);
  }
}

/**
 * 8. 清空详情区
 */
function clearDetail() {
  const container = document.querySelector('#detail-content');
  if (container) {
    container.innerHTML = '';
  }
}

/**
 * 9. 格式化日期
 */
function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('zh-CN');
}

/**
 * 10. 菜单切换事件绑定
 */
function setupMenuListeners() {
  const menuLinks = document.querySelectorAll('.menu a');

  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();

      // 移除其他菜单项的激活状态
      menuLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      // 加载新的能力列表
      const type = link.dataset.type;
      loadCapabilities(type, 1);
      clearDetail();
    });
  });
}

/**
 * 11. 搜索功能
 */
function setupSearchListener() {
  const searchInput = document.querySelector('#search');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase();
    const filtered = currentCapabilities.filter(item =>
      item.name.toLowerCase().includes(keyword) ||
      (item.description && item.description.toLowerCase().includes(keyword))
    );
    renderList(filtered);
  });
}

/**
 * 12. 页面初始化
 */
document.addEventListener('DOMContentLoaded', async () => {
  // 设置菜单事件
  setupMenuListeners();

  // 设置搜索事件
  setupSearchListener();

  // 设置首菜单项为激活
  const firstLink = document.querySelector('.menu a');
  if (firstLink) {
    firstLink.classList.add('active');
  }

  // 加载默认列表
  await loadCapabilities('workflow', 1);
});
