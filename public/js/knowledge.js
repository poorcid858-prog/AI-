// 知识库四层架构前端交互引擎

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
      case 'embeddings':
        html = this.renderEmbeddings(items);
        break;
    }

    document.getElementById('table-container').innerHTML = html;
    this.attachTableListeners(layer);
  }

  renderDocuments(items) {
    const thead = `
      <tr>
        <th>文件名</th>
        <th>文件类型</th>
        <th>上传者</th>
        <th>上传时间</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    `;

    const tbody = items
      .map(
        (doc) => `
      <tr>
        <td>${escapeHtml(doc.filename || doc.name || '未命名')}</td>
        <td><span class="tag">${doc.file_type || '未知'}</span></td>
        <td>${escapeHtml(doc.uploader || '-')}</td>
        <td>${formatDate(doc.upload_time || doc.created_at)}</td>
        <td><span class="status-${doc.review_status || 'pending'}">${
        doc.review_status === 'approved'
          ? '✓ 已批准'
          : doc.review_status === 'rejected'
            ? '✕ 已驳回'
            : '⏳ 待审核'
      }</span></td>
        <td>
          <a href="#" class="link-detail" data-layer="documents" data-id="${doc.id}">详情</a>
          <a href="#" class="link-layers" data-doc-id="${doc.id}">查看四层</a>
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
        <th>ID</th>
        <th>来源文档</th>
        <th>分类</th>
        <th>标签</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    `;

    const tbody = items
      .map(
        (doc) => `
      <tr>
        <td>${escapeHtml(doc.id)}</td>
        <td><a href="#" class="link-source" data-doc-id="${doc.doc_id}">文档 ${doc.doc_id}</a></td>
        <td>${escapeHtml(doc.category || '-')}</td>
        <td>${(doc.tags || []).slice(0, 3).join(', ') || '-'}</td>
        <td><span class="status-${doc.processing_status || 'pending'}">${
        doc.processing_status === 'completed'
          ? '✓ 已完成'
          : doc.processing_status === 'failed'
            ? '✕ 失败'
            : '⏳ 处理中'
      }</span></td>
        <td>
          <a href="#" class="link-detail" data-layer="standardized" data-id="${doc.id}">详情</a>
          <a href="#" class="link-trace" data-layer="standardized" data-id="${doc.id}">追踪</a>
        </td>
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
        <th>来源文档</th>
        <th>序号</th>
        <th>内容预览</th>
        <th>操作</th>
      </tr>
    `;

    const tbody = items
      .map(
        (chunk) => `
      <tr>
        <td>${escapeHtml(chunk.id)}</td>
        <td><a href="#" class="link-source" data-std-id="${chunk.standardized_doc_id}">文档 ${chunk.standardized_doc_id}</a></td>
        <td>${chunk.chunk_order || 1}</td>
        <td class="preview">${escapeHtml((chunk.chunk_content || '').substring(0, 60))}</td>
        <td>
          <a href="#" class="link-detail" data-layer="chunks" data-id="${chunk.id}">详情</a>
          <a href="#" class="link-trace" data-layer="chunks" data-id="${chunk.id}">追踪</a>
        </td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  renderEmbeddings(items) {
    const thead = `
      <tr>
        <th>向量ID</th>
        <th>所属Chunk</th>
        <th>模型</th>
        <th>维度</th>
        <th>索引</th>
        <th>操作</th>
      </tr>
    `;

    const tbody = items
      .map(
        (vec) => `
      <tr>
        <td>${escapeHtml(vec.id)}</td>
        <td><a href="#" class="link-source" data-chunk-id="${vec.chunk_id}">Chunk ${vec.chunk_id}</a></td>
        <td>${vec.model || '-'}</td>
        <td>${vec.dimensions || 'N/A'}</td>
        <td>${vec.index_name || '-'}</td>
        <td>
          <a href="#" class="link-detail" data-layer="embeddings" data-id="${vec.id}">详情</a>
          <a href="#" class="link-trace" data-layer="embeddings" data-id="${vec.id}">追踪</a>
        </td>
      </tr>
    `
      )
      .join('');

    return `<table class="knowledge-table">${thead}<tbody>${tbody}</tbody></table>`;
  }

  attachTableListeners(layer) {
    // 详情链接
    document.querySelectorAll('.link-detail').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const detailLayer = e.target.dataset.layer;
        const id = e.target.dataset.id;
        showDetail(detailLayer, id);
      });
    });

    // 追踪链接
    document.querySelectorAll('.link-trace').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const traceLayer = e.target.dataset.layer;
        const id = e.target.dataset.id;
        traceEngine.trace(traceLayer, id);
      });
    });

    // 来源链接（跳转到源文档）
    document.querySelectorAll('.link-source').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const docId = e.target.dataset.docId;
        const stdId = e.target.dataset.stdId;
        const chunkId = e.target.dataset.chunkId;

        if (docId) {
          tabManager.switchLayer('documents');
          // 可选：高亮或滚动到该行
        } else if (stdId) {
          tabManager.switchLayer('standardized');
        } else if (chunkId) {
          tabManager.switchLayer('chunks');
        }
      });
    });
  }
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
        embeddings: '向量数据',
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
    category: '分类',
    tags: '标签',
    status: '状态',
    processing_status: '处理状态',
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
  // 使用 Toast 代替 alert（如果可用），避免阻塞型弹窗导致白屏感
  var el = document.createElement('div');
  el.className = 'toast error';
  el.textContent = '❌ ' + message;
  document.body.appendChild(el);
  setTimeout(function() { el.classList.add('out'); setTimeout(function() { el.remove(); }, 300); }, 4000);
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
