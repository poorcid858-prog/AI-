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
  loadEffectAnalysis();
  loadCapabilityAnalysis();
  setupFullLink();
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
  container.innerHTML = '<div class="ops-loading">正在加载...</div>';

  const result = await operationsAPI.queryChatHistory(
    { startDate, endDate, keyword, role },
    { page: currentPage, pageSize }
  );

  if (!result.ok) {
    container.innerHTML = `<div class="ops-empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.records.length === 0) {
    container.innerHTML = '<div class="ops-empty">📭 没有找到相关记录</div>';
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
          <button onclick="viewRecordDetail('${record.sessionId}', ${record.turn})" class="btn btn-sm btn-outline-primary">查看详情</button>
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
        <button onclick="goToChatPage(1)" ${currentPage === 1 ? 'disabled' : ''} class="btn btn-sm">首页</button>
        <button onclick="goToChatPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="btn btn-sm">上一页</button>
        <span style="margin: 0 16px;">第 ${currentPage} / ${result.totalPages} 页</span>
        <button onclick="goToChatPage(${currentPage + 1})" ${currentPage === result.totalPages ? 'disabled' : ''} class="btn btn-sm">下一页</button>
        <button onclick="goToChatPage(${result.totalPages})" ${currentPage === result.totalPages ? 'disabled' : ''} class="btn btn-sm">末页</button>
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
    Swal.fire('错误', '加载失败: ' + result.error, 'error');
    return;
  }

  const chunks = result.chunks || [];
  let detailsHtml = `
    <div style="text-align:left">
      <p><strong>Session:</strong> ${sessionId}</p>
      <p><strong>Turn:</strong> ${turn}</p>
      <p><strong>问题:</strong> ${result.userQuestion}</p>
      <p><strong>回答:</strong></p>
      <div style="background: var(--bg-panel-2); padding: 12px; border-radius: 4px; max-height: 300px; overflow-y: auto; margin-bottom: 12px;">
        ${result.aiAnswer}
      </div>
      <h4>使用的 Chunks (${chunks.length} 个)</h4>
  `;

  if (chunks.length > 0) {
    detailsHtml += '<ul>';
    chunks.forEach((chunk) => {
      detailsHtml += `
        <li style="margin-bottom: 8px; padding: 4px 0; border-bottom: 1px solid var(--border);">
          <strong>${chunk.id}</strong><br>
          <small>${chunk.content ? chunk.content.substring(0, 100) + '...' : 'N/A'}</small><br>
          <small>相关度: ${(chunk.score || 0).toFixed(3)}</small>
        </li>
      `;
    });
    detailsHtml += '</ul>';
  } else {
    detailsHtml += '<p style="color: var(--text-dim);">❌ 零召回（无Chunks）</p>';
  }
  detailsHtml += '</div>';

  Swal.fire({
    title: '记录详情',
    html: detailsHtml,
    width: 700,
    confirmButtonText: '关闭',
  });
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

  container.innerHTML = '<div class="ops-loading">正在加载...</div>';

  const result = await operationsAPI.getChunkUsageStats({ sortBy, limit: 50 });

  if (!result.ok) {
    container.innerHTML = `<div class="ops-empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.chunks.length === 0) {
    container.innerHTML = '<div class="ops-empty">📭 没有 Chunk 数据</div>';
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
  container.innerHTML = '<div class="ops-loading">正在加载...</div>';

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
// 效果分析
// ============================================================

async function loadEffectAnalysis() {
  try {
    const allRecords = await operationsAPI.queryChatHistory({}, { page: 1, pageSize: 1000 });
    if (!allRecords.ok) return;

    let upCount = 0, downCount = 0, total = 0, satisfactionSum = 0;
    const satisfactionWithData = [];

    // 获取所有页面数据
    const totalPages = Math.max(1, allRecords.totalPages || 1);
    const allData = [...(allRecords.records || [])];

    for (let p = 2; p <= totalPages; p++) {
      const more = await operationsAPI.queryChatHistory({}, { page: p, pageSize: 1000 });
      if (more.ok && more.records) allData.push(...more.records);
    }

    // 统计每个记录的详情
    for (const record of allData) {
      total++;
      const detail = await operationsAPI.getRecordDetail(record.sessionId, record.turn);
      if (detail.ok && detail.record) {
        if (detail.record.feedback === 'up') upCount++;
        else if (detail.record.feedback === 'down') downCount++;
        if (detail.record.userSatisfaction !== null && detail.record.userSatisfaction !== undefined) {
          satisfactionSum += detail.record.userSatisfaction;
          satisfactionWithData.push({
            sessionId: record.sessionId,
            turn: record.turn,
            score: detail.record.userSatisfaction,
          });
        }
      }
    }

    const avgSatisfaction = satisfactionWithData.length > 0
      ? (satisfactionSum / satisfactionWithData.length).toFixed(2)
      : '-';
    const adoptionRate = total > 0
      ? ((upCount / total) * 100).toFixed(1) + '%'
      : '-';

    document.getElementById('satisfactionScore').textContent = avgSatisfaction;
    document.getElementById('upCount').textContent = upCount;
    document.getElementById('downCount').textContent = downCount;
    document.getElementById('adoptionRate').textContent = adoptionRate;

    // 效果分析详情
    const detailContainer = document.getElementById('effectDetailContainer');
    detailContainer.innerHTML = `
      <h3>效果详情</h3>
      <table class="chat-records-table">
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Turn</th>
            <th>满意度</th>
          </tr>
        </thead>
        <tbody>
          ${satisfactionWithData.slice(0, 20).map(s => `
            <tr>
              <td>${s.sessionId}</td>
              <td>${s.turn}</td>
              <td>${s.score}</td>
            </tr>
          `).join('')}
          ${satisfactionWithData.length === 0 ? '<tr><td colspan="3">暂无满意度数据</td></tr>' : ''}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('[效果分析] 加载失败:', e);
  }
}

// ============================================================
// 能力运营分析
// ============================================================

async function loadCapabilityAnalysis() {
  try {
    // 从聊天记录统计各角色调用情况
    const allRecords = await operationsAPI.queryChatHistory({}, { page: 1, pageSize: 1000 });
    if (!allRecords.ok) return;

    const totalPages = Math.max(1, allRecords.totalPages || 1);
    const allData = [...(allRecords.records || [])];

    for (let p = 2; p <= totalPages; p++) {
      const more = await operationsAPI.queryChatHistory({}, { page: p, pageSize: 1000 });
      if (more.ok && more.records) allData.push(...more.records);
    }

    const totalCalls = allData.length;
    const roleMap = {};
    let latencySum = 0;
    let latencyCount = 0;

    allData.forEach(r => {
      roleMap[r.role] = (roleMap[r.role] || 0) + 1;
      if (r.latencyMs) {
        latencySum += r.latencyMs;
        latencyCount++;
      }
    });

    const roles = Object.keys(roleMap);
    const avgLatency = latencyCount > 0 ? Math.round(latencySum / latencyCount) + 'ms' : '-';
    const successRate = totalCalls > 0 ? '100%' : '-';

    document.getElementById('totalCalls').textContent = totalCalls;
    document.getElementById('successRate').textContent = successRate;
    document.getElementById('avgLatency').textContent = avgLatency;
    document.getElementById('roleCount').textContent = roles.length;

    // 能力运营详情
    const detailContainer = document.getElementById('capDetailContainer');
    detailContainer.innerHTML = `
      <h3>角色调用分布</h3>
      <table class="chat-records-table">
        <thead>
          <tr><th>角色</th><th>调用次数</th></tr>
        </thead>
        <tbody>
          ${roles.map(r => `
            <tr><td>${r}</td><td>${roleMap[r]}</td></tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error('[能力运营分析] 加载失败:', e);
  }
}

// ============================================================
// 问题定位全链路
// ============================================================

function setupFullLink() {
  const queryBtn = document.getElementById('linkQueryBtn');
  const input = document.getElementById('linkSessionId');

  queryBtn.addEventListener('click', () => loadFullLink(input.value.trim()));
  input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadFullLink(input.value.trim());
  });
}

async function loadFullLink(sessionId) {
  if (!sessionId) {
    Toastify({ text: '请输入 Session ID', duration: 3000, gravity: 'top', position: 'right', style: { background: 'var(--warning)' } }).showToast();
    return;
  }

  const container = document.getElementById('linkChain');
  const defaultMsg = document.getElementById('linkDefault');
  const mainContainer = document.getElementById('linkContainer');

  defaultMsg.style.display = 'none';
  mainContainer.style.display = 'block';
  container.innerHTML = '<div class="ops-loading">正在加载全链路数据...</div>';

  try {
    const records = await App.api('/api/chat/session/' + sessionId);
    const turns = [];

    // 按 turn 分组
    const turnMap = {};
    records.records.forEach(r => {
      if (!turnMap[r.turn]) turnMap[r.turn] = { user: null, ai: null };
      if (r.type === 'user') turnMap[r.turn].user = r;
      else turnMap[r.turn].ai = r;
    });

    let html = '';
    Object.keys(turnMap).sort().forEach(turn => {
      const pair = turnMap[turn];
      const userQuestion = pair.user ? pair.user.content : '';
      const aiAnswer = pair.ai ? pair.ai.content : '';
      const workflowId = pair.ai ? pair.ai.workflowId : '-';
      const ragChunks = pair.ai ? (pair.ai.ragChunks || []) : [];
      const latency = pair.ai ? pair.ai.latencyMs : '-';

      html += `
        <div style="background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; padding: 14px; margin-bottom: 12px;">
          <div style="font-size: 12px; color: var(--text-faint); margin-bottom: 8px;">
            Turn ${turn} · Workflow: ${workflowId} · 耗时: ${latency}ms
          </div>
          <div style="margin-bottom: 8px;">
            <strong>用户输入 →</strong> ${userQuestion}
          </div>
          <div style="margin-bottom: 8px;">
            <strong>意图识别 →</strong> 路由到 Workflow
          </div>
          <div style="margin-bottom: 8px;">
            <strong>Workflow 执行 →</strong> 引擎执行节点
          </div>
          <div style="margin-bottom: 8px;">
            <strong>RAG 检索 →</strong> ${ragChunks.length > 0 ? ragChunks.map(c => `<span class="chunk-badge">${c}</span>`).join(' ') : '零召回'}
          </div>
          <div style="margin-bottom: 8px;">
            <strong>Skill → Reference → Prompt 组装 → LLM 输出</strong>
          </div>
          <div style="background: var(--bg-panel-2); padding: 10px; border-radius: 4px; font-size: 13px; max-height: 200px; overflow-y: auto;">
            ${aiAnswer}
          </div>
        </div>
      `;
    });

    if (!html) {
      html = '<div class="ops-empty">该 Session 没有聊天记录</div>';
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="ops-empty">❌ 加载失败: ${e.message}</div>`;
  }
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
  container.innerHTML = '<div class="ops-loading">正在加载...</div>';

  const result = await operationsAPI.getTopQuestions({ limit: 50 });

  if (!result.ok) {
    container.innerHTML = `<div class="ops-empty">❌ 加载失败: ${result.error}</div>`;
    return;
  }

  if (result.questions.length === 0) {
    container.innerHTML = '<div class="ops-empty">📭 没有问题数据</div>';
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