// 知识中心四层架构前端交互引擎

if (!App.guard()) throw new Error('需要身份验证');

// ============ 页面状态管理 ============
const pageState = {
  currentLayer: 'documents',
  items: [],
  loading: false,
  error: null,
  selectedItem: null,
  searchQuery: '',
  filters: {
    status: 'all',
  },
  selectedItems: new Set(), // 批量选择
  processingTasks: new Map(), // 处理中的任务
};

// ============ 标签页管理 ============
class TabManager {
  constructor() {
    this.tabs = document.querySelectorAll('.tab-btn');
    this.init();
  }

  init() {
    this.tabs.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.switchLayer(btn.dataset.layer);
      });
    });
  }

  switchLayer(layer) {
    pageState.currentLayer = layer;
    this.updateTabUI(layer);
    hideBreadcrumb();
    clearDetail();
    pageState.selectedItems.clear();
    updateBatchActions();
    dataLoader.load(layer);
  }

  updateTabUI(layer) {
    this.tabs.forEach((btn) => {
      const isActive = btn.dataset.layer === layer;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive);
    });
  }
}

// ============ 数据加载层 ============
class DataLoader {
  async load(layer, filters = {}) {
    try {
      pageState.loading = true;
      showLoading();

      const params = new URLSearchParams(filters);
      const url = `/api/knowledge/${layer}${params.toString() ? '?' + params : ''}`;
      const response = await App.api(url);

      pageState.items = response.items || [];
      pageState.error = null;
      renderEngine.render(layer, pageState.items);
    } catch (e) {
      pageState.error = e.message;
      showError(e.message);
    } finally {
      pageState.loading = false;
      hideLoading();
    }
  }
}

// ============ 渲染引擎 ============
class RenderEngine {
  render(layer, items) {
    if (!items || items.length === 0) {
      showEmptyState();
      return;
    }

    hideEmptyState();
    let html = '';

    switch (layer) {
      case 'documents':
        html = this.renderDocuments(items);
        break;
      case 'standardized':
        html = this.renderStandardizedDocs(items);
        break;
      case 'chunks':
        html = this.renderChunks(items);
        break;
      case 'vectors':
        html = this.renderVectors(items);
        break;
    }

    document.getElementById('table-container').innerHTML = html;
    this.attachTableListeners(layer);
  }

  renderDocuments(items) {
    const thead = `
      <tr>
        <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
        <th>标题</th>
        <th>上传时间</th>
        <th>审核状态</th>
        <th>处理状态</th>
        <th>生效状态</th>
        <th>操作</th>
      </tr>
    `;

    const tbody = items
      .map(
        (doc) => `
      <tr data-id="${doc.id}">
        <td><input type="checkbox" class="form-check-input row-select" value="${doc.id}"></td>
        <td>${escapeHtml(doc.filename || doc.name || '未命名')}</td>
        <td>${formatDate(doc.upload_time || doc.created_at)}</td>
        <td><span class="badge ${this.getReviewStatusClass(doc.review_status)}">${this.getReviewStatusText(doc.review_status)}</span></td>
        <td><span class="badge ${this.getProcessingStatusClass(doc.processing_status)}">${this.getProcessingStatusText(doc.processing_status)}</span></td>
        <td><span class="badge ${this.getOnlineStatusClass(doc.online_status)}">${this.getOnlineStatusText(doc.online_status)}</span></td>
        <td>
          <div class="action-buttons">
            <button class="btn btn-sm btn-outline-primary" onclick="showDetail('documents', '${doc.id}')">预览</button>
            ${this.getOperationButtons(doc)}
          </div>
        </td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  renderStandardizedDocs(items) {
    const thead = `
      <tr>
        <th>标准化文档ID</th>
        <th>原始文档ID</th>
        <th>文档名称</th>
        <th>版本号</th>
        <th>处理状态</th>
        <th>创建时间</th>
      </tr>
    `;

    const tbody = items
      .map(
        (doc) => `
      <tr>
        <td>${escapeHtml(doc.id)}</td>
        <td><a href="#" class="link-source" data-layer="documents" data-id="${doc.doc_id}">${escapeHtml(doc.doc_id)}</a></td>
        <td>${escapeHtml(doc.name || doc.category || '-')}</td>
        <td>${doc.version || '-'}</td>
        <td><span class="badge ${this.getProcessingStatusClass(doc.processing_status)}">${this.getProcessingStatusText(doc.processing_status)}</span></td>
        <td>${formatDate(doc.created_at)}</td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  renderChunks(items) {
    const thead = `
      <tr>
        <th>Chunk ID</th>
        <th>标准化文档ID</th>
        <th>版本号</th>
        <th>Chunk序号</th>
        <th>标题</th>
        <th>内容摘要</th>
        <th>标签</th>
        <th>状态</th>
      </tr>
    `;

    const tbody = items
      .map(
        (chunk) => `
      <tr>
        <td>${escapeHtml(chunk.id)}</td>
        <td><a href="#" class="link-source" data-layer="standardized" data-id="${chunk.standardized_doc_id}">${escapeHtml(chunk.standardized_doc_id)}</a></td>
        <td>${chunk.version || '-'}</td>
        <td>${chunk.chunk_order || 1}</td>
        <td>${escapeHtml(chunk.position || '-')}</td>
        <td class="preview">${escapeHtml((chunk.chunk_content || '').substring(0, 60))}</td>
        <td>${(chunk.tags || []).slice(0, 3).join(', ') || '-'}</td>
        <td><span class="badge ${this.getProcessingStatusClass(chunk.status)}">${this.getProcessingStatusText(chunk.status)}</span></td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  renderVectors(items) {
    const thead = `
      <tr>
        <th>Vector ID</th>
        <th>Chunk ID</th>
        <th>版本号</th>
        <th>Embedding模型</th>
        <th>向量维度</th>
        <th>状态</th>
        <th>创建时间</th>
      </tr>
    `;

    const tbody = items
      .map(
        (vec) => `
      <tr>
        <td>${escapeHtml(vec.id)}</td>
        <td><a href="#" class="link-source" data-layer="chunks" data-id="${vec.chunk_id}">${escapeHtml(vec.chunk_id)}</a></td>
        <td>${vec.version || '-'}</td>
        <td>${vec.model || '-'}</td>
        <td>${vec.dimensions || 'N/A'}</td>
        <td><span class="badge ${this.getProcessingStatusClass(vec.status)}">${this.getProcessingStatusText(vec.status)}</span></td>
        <td>${formatDate(vec.created_at)}</td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  getReviewStatusClass(status) {
    const map = {
      'pending': 'bg-warning',
      'approved': 'bg-success',
      'rejected': 'bg-danger',
    };
    return map[status] || 'bg-secondary';
  }

  getReviewStatusText(status) {
    const map = {
      'pending': '待审核',
      'approved': '审核通过',
      'rejected': '审核失败',
    };
    return map[status] || '未知';
  }

  getProcessingStatusClass(status) {
    const map = {
      'not_processed': 'bg-secondary',
      'processing': 'bg-info',
      'success': 'bg-success',
      'failed': 'bg-danger',
    };
    return map[status] || 'bg-secondary';
  }

  getProcessingStatusText(status) {
    const map = {
      'not_processed': '未处理',
      'processing': '处理中',
      'success': '处理成功',
      'failed': '处理失败',
    };
    return map[status] || '未知';
  }

  getOnlineStatusClass(status) {
    const map = {
      'not_online': 'bg-secondary',
      'online': 'bg-success',
      'offline': 'bg-warning',
    };
    return map[status] || 'bg-secondary';
  }

  getOnlineStatusText(status) {
    const map = {
      'not_online': '未生效',
      'online': '已上线',
      'offline': '已下线',
    };
    return map[status] || '未知';
  }

  getOperationButtons(doc) {
    const buttons = [];

    // 预览按钮（始终显示）
    buttons.push(`<button class="btn btn-sm btn-outline-info" onclick="showDetail('documents', '${doc.id}')">预览</button>`);

    // 生成向量数据按钮（审核通过且未处理时显示）
    if (doc.review_status === 'approved' && (!doc.processing_status || doc.processing_status === 'not_processed')) {
      buttons.push(`<button class="btn btn-sm btn-primary" onclick="generateVectors('${doc.id}')">生成向量数据</button>`);
    }

    // 重新发起审核按钮（审核失败后显示）
    if (doc.review_status === 'rejected') {
      buttons.push(`<button class="btn btn-sm btn-warning" onclick="reReview('${doc.id}')">重新发起审核</button>`);
    }

    // 发布新版本按钮（已形成正式版本的文档）
    if (doc.version && doc.version > 0) {
      buttons.push(`<button class="btn btn-sm btn-info" onclick="publishNewVersion('${doc.id}')">发布新版本</button>`);
    }

    // 上线/下线按钮
    if (doc.online_status === 'not_online' || doc.online_status === 'offline') {
      buttons.push(`<button class="btn btn-sm btn-success" onclick="onlineDocument('${doc.id}')">上线</button>`);
    } else if (doc.online_status === 'online') {
      buttons.push(`<button class="btn btn-sm btn-warning" onclick="offlineDocument('${doc.id}')">下线</button>`);
    }

    // 删除按钮（向量化前允许，向量化后不允许）
    if (!doc.processing_status || doc.processing_status === 'not_processed' || doc.processing_status === 'failed') {
      buttons.push(`<button class="btn btn-sm btn-danger" onclick="deleteDocument('${doc.id}')">删除</button>`);
    }

    return buttons.join('');
  }

  attachTableListeners(layer) {
    // 来源链接（跳转到源文档）
    document.querySelectorAll('.link-source').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetLayer = e.target.dataset.layer;
        const id = e.target.dataset.id;
        tabManager.switchLayer(targetLayer);
      });
    });

    // 批量选择
    const selectAll = document.getElementById('selectAll');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.row-select');
        checkboxes.forEach(cb => {
          cb.checked = e.target.checked;
          if (e.target.checked) {
            pageState.selectedItems.add(cb.value);
          } else {
            pageState.selectedItems.delete(cb.value);
          }
        });
        updateBatchActions();
      });
    }

    document.querySelectorAll('.row-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          pageState.selectedItems.add(e.target.value);
        } else {
          pageState.selectedItems.delete(e.target.value);
        }
        updateBatchActions();
      });
    });
  }
}

// ============ 操作函数 ============
async function generateVectors(versionId) {
  try {
    showProgressModal();
    const response = await App.api(`/api/processing/knowledge/${versionId}/generate-vectors`, {
      method: 'POST'
    });

    if (response.ok) {
      App.toast('任务已创建，开始处理', 'success');
      pollTaskProgress(response.taskId);
    } else {
      App.toast(response.error || '创建任务失败', 'error');
      hideProgressModal();
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
    hideProgressModal();
  }
}

async function reReview(versionId) {
  try {
    const response = await App.api(`/api/knowledge/${versionId}/re-review`, {
      method: 'POST'
    });

    if (response.ok) {
      App.toast('已重新发起审核', 'success');
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function publishNewVersion(documentId) {
  try {
    const response = await App.api(`/api/knowledge/${documentId}/new-version`, {
      method: 'POST'
    });

    if (response.ok) {
      App.toast('新版本已创建', 'success');
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function onlineDocument(versionId) {
  try {
    const response = await App.api(`/api/knowledge/${versionId}/online`, {
      method: 'POST'
    });

    if (response.ok) {
      App.toast('已上线', 'success');
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function offlineDocument(versionId) {
  try {
    const response = await App.api(`/api/knowledge/${versionId}/offline`, {
      method: 'POST'
    });

    if (response.ok) {
      App.toast('已下线', 'success');
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function deleteDocument(versionId) {
  try {
    const confirmed = await App.confirm('确定要删除此文档吗？此操作不可恢复。');
    if (!confirmed) return;

    const response = await App.api(`/api/knowledge/${versionId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      App.toast('已删除', 'success');
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '删除失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

// ============ 批量操作 ============
function updateBatchActions() {
  const batchActions = document.getElementById('batchActions');
  const selectedCount = document.getElementById('selectedCount');
  const batchGenerate = document.getElementById('batchGenerate');
  const batchOnline = document.getElementById('batchOnline');
  const batchOffline = document.getElementById('batchOffline');

  const count = pageState.selectedItems.size;
  selectedCount.textContent = count;

  if (count > 0) {
    batchActions.style.display = 'flex';
    // 根据当前标签页显示不同的批量操作按钮
    if (pageState.currentLayer === 'documents') {
      batchGenerate.style.display = 'inline-block';
      batchOnline.style.display = 'inline-block';
      batchOffline.style.display = 'inline-block';
    } else {
      batchGenerate.style.display = 'none';
      batchOnline.style.display = 'none';
      batchOffline.style.display = 'none';
    }
  } else {
    batchActions.style.display = 'none';
  }
}

async function batchGenerateVectors() {
  const versionIds = Array.from(pageState.selectedItems);
  if (versionIds.length === 0) {
    App.toast('请先选择文档', 'error');
    return;
  }

  try {
    const response = await App.api('/api/processing/knowledge/batch-generate', {
      method: 'POST',
      body: JSON.stringify({ versionIds })
    });

    if (response.ok) {
      App.toast(`批量任务已创建：成功 ${response.successCount} 个，失败 ${response.failCount} 个`, 'success');
      pageState.selectedItems.clear();
      updateBatchActions();
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '批量操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function batchOnline() {
  const versionIds = Array.from(pageState.selectedItems);
  if (versionIds.length === 0) {
    App.toast('请先选择文档', 'error');
    return;
  }

  try {
    const response = await App.api('/api/knowledge/batch-online', {
      method: 'POST',
      body: JSON.stringify({ versionIds })
    });

    if (response.ok) {
      App.toast('批量上线成功', 'success');
      pageState.selectedItems.clear();
      updateBatchActions();
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '批量操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

async function batchOffline() {
  const versionIds = Array.from(pageState.selectedItems);
  if (versionIds.length === 0) {
    App.toast('请先选择文档', 'error');
    return;
  }

  try {
    const response = await App.api('/api/knowledge/batch-offline', {
      method: 'POST',
      body: JSON.stringify({ versionIds })
    });

    if (response.ok) {
      App.toast('批量下线成功', 'success');
      pageState.selectedItems.clear();
      updateBatchActions();
      dataLoader.load('documents');
    } else {
      App.toast(response.error || '批量操作失败', 'error');
    }
  } catch (e) {
    App.toast(e.message || '操作失败', 'error');
  }
}

function clearSelection() {
  pageState.selectedItems.clear();
  document.querySelectorAll('.row-select').forEach(cb => {
    cb.checked = false;
  });
  const selectAll = document.getElementById('selectAll');
  if (selectAll) selectAll.checked = false;
  updateBatchActions();
}

// ============ 进度轮询 ============
function showProgressModal() {
  document.getElementById('progress-modal').classList.add('open');
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressText').textContent = '0%';
  document.getElementById('phaseList').innerHTML = '';
  document.getElementById('progressError').style.display = 'none';
  document.getElementById('progressActions').style.display = 'none';
}

function hideProgressModal() {
  document.getElementById('progress-modal').classList.remove('open');
}

async function pollTaskProgress(taskId) {
  try {
    const response = await App.api(`/api/processing/knowledge/tasks/${taskId}`);

    if (response.ok) {
      updateProgressUI(response);

      if (response.status === 'completed') {
        App.toast('处理完成', 'success');
        setTimeout(() => {
          hideProgressModal();
          dataLoader.load('documents');
        }, 1000);
      } else if (response.status === 'failed') {
        document.getElementById('progressError').textContent = response.error || '处理失败';
        document.getElementById('progressError').style.display = 'block';
        document.getElementById('progressActions').style.display = 'block';
      } else {
        // 继续轮询
        setTimeout(() => pollTaskProgress(taskId), 1000);
      }
    }
  } catch (e) {
    console.error('轮询任务进度失败:', e);
    setTimeout(() => pollTaskProgress(taskId), 2000);
  }
}

function updateProgressUI(task) {
  // 更新进度条
  const progress = task.progress || 0;
  document.getElementById('progressBar').style.width = `${progress}%`;
  document.getElementById('progressText').textContent = `${progress}%`;

  // 更新阶段列表
  const phaseList = document.getElementById('phaseList');
  if (task.phases && task.phases.length > 0) {
    phaseList.innerHTML = task.phases.map(phase => `
      <div class="phase-item ${phase.status}">
        <span class="phase-status">${getPhaseStatusIcon(phase.status)}</span>
        <span class="phase-name">${phase.name}</span>
        ${phase.error ? `<span class="phase-error">${phase.error}</span>` : ''}
      </div>
    `).join('');
  }
}

function getPhaseStatusIcon(status) {
  const map = {
    'pending': '⏳',
    'processing': '🔄',
    'completed': '✅',
    'failed': '❌',
  };
  return map[status] || '⏳';
}

// ============ 追踪引擎 ============
class TraceEngine {
  async trace(layer, id) {
    try {
      showLoading();

      const url = `/api/knowledge/trace/${layer}/${id}`;
      const response = await App.api(url);

      if (!response.ok) throw new Error(response.error || '追踪失败');

      this.showTracePath(response.path || []);
    } catch (e) {
      showError('追踪失败: ' + e.message);
    } finally {
      hideLoading();
    }
  }

  showTracePath(path) {
    if (!path || path.length === 0) {
      showError('无追踪数据');
      return;
    }

    let html = '<div class="trace-path">';
    path.forEach((item, idx) => {
      const layerLabel = {
        documents: '原始文档',
        standardized: '标准化文档',
        chunks: 'Chunk',
        vectors: '向量数据',
      }[item.layer] || item.layer;

      html += `
        <div class="trace-step">
          <div class="trace-layer">${layerLabel}</div>
          <div class="trace-data">
            <div><strong>ID:</strong> ${escapeHtml(item.id)}</div>
            <div><strong>名称:</strong> ${escapeHtml(item.name || item.title || item.filename || '-')}</div>
            ${item.content ? `<div><strong>内容:</strong> ${escapeHtml(item.content.substring(0, 100))}</div>` : ''}
          </div>
        </div>
      `;

      if (idx < path.length - 1) {
        html += '<div class="trace-arrow">↓</div>';
      }
    });
    html += '</div>';

    document.getElementById('trace-content').innerHTML = html;
    document.getElementById('trace-modal').classList.add('open');
  }
}

// ============ 搜索和筛选 ============
class SearchFilter {
  constructor() {
    this.debounceTimer = null;
    this.init();
  }

  init() {
    const searchBox = document.getElementById('search');
    const btnSearch = document.getElementById('btn-search');
    const btnClear = document.getElementById('btn-clear');

    searchBox.addEventListener('input', (e) => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.performSearch(e.target.value);
      }, 300);
    });

    searchBox.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.performSearch(e.target.value);
      }
    });

    btnSearch.addEventListener('click', (e) => {
      e.preventDefault();
      this.performSearch(searchBox.value);
    });

    btnClear.addEventListener('click', (e) => {
      e.preventDefault();
      searchBox.value = '';
      pageState.searchQuery = '';
      dataLoader.load(pageState.currentLayer);
    });
  }

  performSearch(keyword) {
    pageState.searchQuery = keyword;
    if (!keyword.trim()) {
      dataLoader.load(pageState.currentLayer);
      return;
    }

    dataLoader.load(pageState.currentLayer, { q: keyword });
  }
}

// ============ 工具函数 ============
function showLoading() {
  document.getElementById('loading').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loading').style.display = 'none';
}

function showEmptyState() {
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('table-container').innerHTML = '';
}

function hideEmptyState() {
  document.getElementById('empty-state').style.display = 'none';
}

function showBreadcrumb(path) {
  const breadcrumb = document.getElementById('breadcrumb');
  const content = document.getElementById('breadcrumb-content');

  let html = path
    .map(
      (item) =>
        `<a href="#" class="bc-link" data-layer="${item.layer}" data-id="${item.id}">${item.label}</a>`
    )
    .join(' <span class="bc-sep">&gt;</span> ');

  content.innerHTML = html;
  breadcrumb.style.display = 'block';

  content.querySelectorAll('.bc-link').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const layer = e.target.dataset.layer;
      const id = e.target.dataset.id;
      tabManager.switchLayer(layer);
    });
  });
}

function hideBreadcrumb() {
  document.getElementById('breadcrumb').style.display = 'none';
}

function showDetail(layer, id) {
  const modal = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');

  const item = pageState.items.find((i) => i.id === id);
  if (!item) {
    showError('未找到详情');
    return;
  }

  let html = '<div class="detail-box">';
  html += '<h3>' + escapeHtml(item.name || item.title || item.filename || 'N/A') + '</h3>';
  html += '<dl>';

  const fields = {
    id: 'ID',
    doc_id: '来源文档ID',
    filename: '文件名',
    file_type: '文件类型',
    uploader: '上传者',
    upload_time: '上传时间',
    review_status: '审核状态',
    processing_status: '处理状态',
    online_status: '生效状态',
    category: '分类',
    tags: '标签',
    status: '状态',
    chunk_content: '内容',
    chunk_order: '序号',
    model: '模型',
    dimensions: '维度',
    index_name: '索引',
    created_at: '创建时间',
  };

  Object.entries(fields).forEach(([key, label]) => {
    if (key in item && item[key]) {
      let value = item[key];
      if (Array.isArray(value)) value = value.join(', ');
      if (typeof value === 'object') value = JSON.stringify(value);
      html += `<dt>${label}</dt><dd>${escapeHtml(String(value))}</dd>`;
    }
  });

  html += '</dl></div>';
  content.innerHTML = html;
  modal.classList.add('open');
}

function clearDetail() {
  const modal = document.getElementById('detail-modal');
  modal.classList.remove('open');
}

function showError(message) {
  console.error(message);
  App.toast(message, 'error');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN');
  } catch {
    return String(iso);
  }
}

// ============ 模态框关闭处理 ============
document.querySelectorAll('.modal-close').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.target.closest('.modal').classList.remove('open');
  });
});

document.querySelectorAll('.modal').forEach((modal) => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
    }
  });
});

// ============ 批量操作按钮事件 ============
document.getElementById('batchGenerate').addEventListener('click', batchGenerateVectors);
document.getElementById('batchOnline').addEventListener('click', batchOnline);
document.getElementById('batchOffline').addEventListener('click', batchOffline);
document.getElementById('clearSelection').addEventListener('click', clearSelection);

// ============ 初始化 ============
const tabManager = new TabManager();
const dataLoader = new DataLoader();
const renderEngine = new RenderEngine();
const traceEngine = new TraceEngine();
const searchFilter = new SearchFilter();

// 页面加载完成后，加载初始数据
document.addEventListener('DOMContentLoaded', () => {
  dataLoader.load('documents');
});
