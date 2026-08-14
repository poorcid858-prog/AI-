/**
 * 运营中心主交互逻辑
 */

let currentPage = 1;
const pageSize = 20;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupChatRecords();
  setupChunkTracking();
  setupTopQuestions();
  loadAnalytics();
});

// ============================================================
// 导航切换
// ============================================================

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn');
  const sections = document.querySelectorAll('.ops-section');

  navBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const section = btn.getAttribute('data-section');

      // 更新按钮状态
      navBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      // 显示对应的 section
      sections.forEach((s) => s.classList.remove('active'));
      document.getElementById(section).classList.add('active');
    });
  });
}

// ============================================================
// 聊天记录查询
// ============================================================

function setupChatRecords() {
  const queryBtn = document.getElementById('queryBtn');
  queryBtn.addEventListener('click', loadChatRecords);

  // 回车键提交
  document.getElementById('keyword').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadChatRecords();
  });
}

async function loadChatRecords() {
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  const keyword = document.getElementById('keyword').value;
  const role = document.getElementById('role').value;

  const container = document.getElementById('chatRecordsContainer');
  container.innerHTML = '<div class="loading">正在加载...</div>';

  const result = await operationsAPI.queryChatHistory(
    {
      startDate,
      endDate,
      keyword,
      role,
    },
    {
      page: currentPage,
      pageSize,
    }
  );

  if (!result.ok) {
    container.innerHTML = `<div class="empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.records.length === 0) {
    container.innerHTML = '<div class="empty">📭 没有找到相关记录</div>';
    return;
  }

  let html = `
    <table class="chat-records-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>用户</th>
          <th>问题</th>
          <th>角色</th>
          <th>Chunks</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
  `;

  result.records.forEach((record) => {
    const time = new Date(record.timestamp).toLocaleString('zh-CN');
    const question = record.userQuestion ? record.userQuestion.substring(0, 30) + '...' : 'N/A';
    const chunksCount = record.chunksCount || 0;

    html += `
      <tr>
        <td>${time}</td>
        <td>${record.userName}</td>
        <td title="${record.userQuestion}">${question}</td>
        <td>${record.role}</td>
        <td>${chunksCount > 0 ? `<span class="chunk-badge">${chunksCount}</span>` : '-'}</td>
        <td>
          <button onclick="viewRecordDetail('${record.sessionId}', ${record.turn})" style="padding: 4px 8px; cursor: pointer;">
            查看详情
          </button>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  // 分页
  if (result.totalPages > 1) {
    html += `
      <div style="margin-top: 16px; text-align: center;">
        <button onclick="goToChatPage(1)" ${currentPage === 1 ? 'disabled' : ''}>首页</button>
        <button onclick="goToChatPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>
        <span style="margin: 0 16px;">第 ${currentPage} / ${result.totalPages} 页</span>
        <button onclick="goToChatPage(${currentPage + 1})" ${currentPage === result.totalPages ? 'disabled' : ''}>下一页</button>
        <button onclick="goToChatPage(${result.totalPages})" ${currentPage === result.totalPages ? 'disabled' : ''}>末页</button>
      </div>
    `;
  }

  container.innerHTML = html;
}

function goToChatPage(page) {
  currentPage = page;
  loadChatRecords();
}

async function viewRecordDetail(sessionId, turn) {
  const result = await operationsAPI.getRecordDetail(sessionId, turn);

  if (!result.ok) {
    alert('❌ 加载失败: ' + result.error);
    return;
  }

  const chunks = result.chunks || [];
  let details = `
    <h3>记录详情</h3>
    <p><strong>Session:</strong> ${sessionId}</p>
    <p><strong>Turn:</strong> ${turn}</p>
    <p><strong>问题:</strong> ${result.userQuestion}</p>
    <p><strong>回答:</strong></p>
    <div style="background: var(--bg-secondary, #f5f5f5); padding: 12px; border-radius: 4px; max-height: 300px; overflow-y: auto;">
      ${result.aiAnswer}
    </div>
    <h4>使用的 Chunks (${chunks.length} 个)</h4>
  `;

  if (chunks.length > 0) {
    details += '<ul>';
    chunks.forEach((chunk) => {
      details += `
        <li>
          <strong>${chunk.id}</strong>
          <br>
          <small>${chunk.content ? chunk.content.substring(0, 100) + '...' : 'N/A'}</small>
          <br>
          <small>相关度: ${(chunk.score || 0).toFixed(3)}</small>
        </li>
      `;
    });
    details += '</ul>';
  } else {
    details += '<p style="color: var(--text-secondary, #999);">❌ 零召回（无Chunks）</p>';
  }

  alert(details);
}

// ============================================================
// Chunk 追踪热度
// ============================================================

function setupChunkTracking() {
  const loadBtn = document.getElementById('loadChunksBtn');
  loadBtn.addEventListener('click', loadChunkUsageStats);
}

async function loadChunkUsageStats() {
  const sortBy = document.getElementById('sortBy').value;
  const container = document.getElementById('chunkTrackingContainer');

  container.innerHTML = '<div class="loading">正在加载...</div>';

  const result = await operationsAPI.getChunkUsageStats({
    sortBy,
    limit: 50,
  });

  if (!result.ok) {
    container.innerHTML = `<div class="empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.chunks.length === 0) {
    container.innerHTML = '<div class="empty">📭 没有 Chunk 数据</div>';
    return;
  }

  let html = '<div class="chunk-cards">';

  result.chunks.forEach((chunk) => {
    html += `
      <div class="chunk-card">
        <div class="chunk-card-title">${chunk.id}</div>
        <div class="chunk-card-content">${chunk.content || 'N/A'}</div>
        <div class="chunk-stats">
          <div class="chunk-stat">
            <div class="chunk-stat-label">使用次数</div>
            <div class="chunk-stat-value">${chunk.usageCount}</div>
          </div>
          <div class="chunk-stat">
            <div class="chunk-stat-label">平均评分</div>
            <div class="chunk-stat-value">${chunk.avgScore}</div>
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// ============================================================
// 分析统计
// ============================================================

async function loadAnalytics() {
  const container = document.getElementById('analyticsContainer');
  container.innerHTML = '<div class="loading">正在加载...</div>';

  // 获取高频问题
  const questionsResult = await operationsAPI.getTopQuestions({ limit: 3 });
  const topQuestions = questionsResult.ok ? questionsResult.questions.slice(0, 3) : [];

  // 获取 Chunk 统计
  const chunksResult = await operationsAPI.getChunkUsageStats({ limit: 3 });
  const topChunks = chunksResult.ok ? chunksResult.chunks.slice(0, 3) : [];

  // 获取零召回问题
  const zeroRecallResult = await operationsAPI.getZeroRecallQuestions({ limit: 3 });
  const zeroRecallCount = zeroRecallResult.ok ? zeroRecallResult.total : 0;

  let html = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-label">高频问题</div>
        <div class="stat-card-value">${topQuestions.length > 0 ? topQuestions[0].count : 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">使用最多的 Chunk</div>
        <div class="stat-card-value">${topChunks.length > 0 ? topChunks[0].usageCount : 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">零召回问题</div>
        <div class="stat-card-value">${zeroRecallCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">平均 Chunk 评分</div>
        <div class="stat-card-value">${topChunks.length > 0 ? topChunks[0].avgScore : 0}</div>
      </div>
    </div>

    <h3>📈 Top 3 高频问题</h3>
    <table class="chat-records-table">
      <thead>
        <tr>
          <th>问题</th>
          <th>出现次数</th>
          <th>独立用户</th>
          <th>最后提问</th>
        </tr>
      </thead>
      <tbody>
  `;

  topQuestions.forEach((q) => {
    const lastAsked = new Date(q.lastAsked).toLocaleString('zh-CN');
    html += `
      <tr>
        <td>${q.question.substring(0, 50)}</td>
        <td>${q.count}</td>
        <td>${q.uniqueUsers}</td>
        <td>${lastAsked}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>

    <h3>🔥 Top 3 Chunk 热度</h3>
    <table class="chat-records-table">
      <thead>
        <tr>
          <th>Chunk ID</th>
          <th>使用次数</th>
          <th>平均评分</th>
        </tr>
      </thead>
      <tbody>
  `;

  topChunks.forEach((c) => {
    html += `
      <tr>
        <td>${c.id}</td>
        <td>${c.usageCount}</td>
        <td>${c.avgScore}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// ============================================================
// 高频问题
// ============================================================

function setupTopQuestions() {
  const loadBtn = document.getElementById('loadQuestionsBtn');
  loadBtn.addEventListener('click', loadTopQuestions);
}

async function loadTopQuestions() {
  const container = document.getElementById('topQuestionsContainer');
  container.innerHTML = '<div class="loading">正在加载...</div>';

  const result = await operationsAPI.getTopQuestions({ limit: 50 });

  if (!result.ok) {
    container.innerHTML = `<div class="empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.questions.length === 0) {
    container.innerHTML = '<div class="empty">📭 没有问题数据</div>';
    return;
  }

  let html = `
    <table class="chat-records-table">
      <thead>
        <tr>
          <th>问题</th>
          <th>出现次数</th>
          <th>独立用户</th>
          <th>最后提问</th>
        </tr>
      </thead>
      <tbody>
  `;

  result.questions.forEach((q) => {
    const lastAsked = new Date(q.lastAsked).toLocaleString('zh-CN');
    html += `
      <tr>
        <td title="${q.question}">${q.question.substring(0, 60) + (q.question.length > 60 ? '...' : '')}</td>
        <td>${q.count}</td>
        <td>${q.uniqueUsers}</td>
        <td>${lastAsked}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}
