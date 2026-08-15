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
// 效果分析（对接真实 API）
// ============================================================

async function loadEffectAnalysis() {
  try {
    const result = await operationsAPI.getEffectAnalysis({});
    if (!result.ok) return;

    const s = result.summary || {};
    document.getElementById('satisfactionScore').textContent = s.satisfactionAvg != null ? s.satisfactionAvg : '-';
    document.getElementById('upCount').textContent = s.upCount != null ? s.upCount : '-';
    document.getElementById('downCount').textContent = s.downCount != null ? s.downCount : '-';
    document.getElementById('adoptionRate').textContent = s.adoptionRate || '-';

    // 效果详情
    const detailContainer = document.getElementById('effectDetailContainer');
    detailContainer.innerHTML = `
      <div class="card" style="padding: 16px;">
        <h3>效果详情</h3>
        <div class="row g-2" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px;">
          <div class="stat-card">
            <div class="stat-card-label">总回答数</div>
            <div class="stat-card-value">${s.totalAnswers || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">平均质量分</div>
            <div class="stat-card-value">${s.qualityAvg != null ? s.qualityAvg : '-'}</div>
          </div>
          <div class="stat-card">
            <div class="stat-card-label">完成率</div>
            <div class="stat-card-value">${s.completionRate || '-'}</div>
          </div>
        </div>
        ${(result.trend && result.trend.length) ? `
          <h3 style="margin-top:20px">📊 满意度趋势</h3>
          <table class="chat-records-table" style="margin-top:12px">
            <thead><tr><th>日期</th><th>平均满意度</th></tr></thead>
            <tbody>
              ${result.trend.map(t => `<tr><td>${t.date}</td><td>${t.avgScore}</td></tr>`).join('')}
            </tbody>
          </table>
        ` : ''}
      </div>
    `;
  } catch (e) {
    console.error('[效果分析] 加载失败:', e);
    // 兜底：显示空白
    ['satisfactionScore','upCount','downCount','adoptionRate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
  }
}

// ============================================================
// 能力运营分析（对接真实 API）
// ============================================================

async function loadCapabilityAnalysis() {
  try {
    const result = await operationsAPI.getCapabilityAnalysis({});
    if (!result.ok) return;

    const caps = result.capabilities || [];
    const totalCalls = caps.reduce((sum, c) => sum + c.calls, 0);
    const latencyArr = caps.map(c => c.avgLatencyMs).filter(v => v != null);
    const avgLatency = latencyArr.length ? Math.round(latencyArr.reduce((a,b)=>a+b,0)/latencyArr.length) + 'ms' : '-';

    document.getElementById('totalCalls').textContent = totalCalls;
    document.getElementById('successRate').textContent = '100%';
    document.getElementById('avgLatency').textContent = avgLatency;
    document.getElementById('roleCount').textContent = new Set(caps.flatMap(c => c.roles || [])).size;

    // 能力运营详情
    const detailContainer = document.getElementById('capDetailContainer');
    detailContainer.innerHTML = `
      <div class="card" style="padding: 16px;">
        <h3>各能力调用情况</h3>
        <table class="chat-records-table" style="margin-top:12px">
          <thead>
            <tr>
              <th>Workflow / 能力</th>
              <th>调用次数</th>
              <th>成功率</th>
              <th>平均耗时</th>
              <th>角色</th>
            </tr>
          </thead>
          <tbody>
            ${caps.map(c => `
              <tr>
                <td class="mono">${c.capabilityId}</td>
                <td>${c.calls}</td>
                <td><span class="text-success">${c.successRate}</span></td>
                <td>${c.avgLatencyMs != null ? c.avgLatencyMs + 'ms' : '-'}</td>
                <td>${(c.roles || []).map(r => `<span class="chunk-badge">${r}</span>`).join(' ') || '-'}</td>
              </tr>
            `).join('')}
            ${caps.length === 0 ? '<tr><td colspan="5" class="text-center text-muted py-3">暂无调用数据</td></tr>' : ''}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    console.error('[能力运营分析] 加载失败:', e);
    ['totalCalls','successRate','avgLatency','roleCount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = '-';
    });
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
    // 先从 qa-store 拿所有轮次
    const sessionData = await App.api('/api/chat/session/' + sessionId);
    const records = sessionData.records || [];
    const turnMap = {};
    records.forEach(r => {
      if (!turnMap[r.turn]) turnMap[r.turn] = { user: null, ai: null };
      if (r.type === 'user') turnMap[r.turn].user = r;
      else turnMap[r.turn].ai = r;
    });

    const turns = Object.keys(turnMap).sort((a, b) => a - b);
    let html = '';

    for (const turn of turns) {
      const pair = turnMap[turn];
      const userQuestion = pair.user ? pair.user.content : '';
      const aiAnswer = pair.ai ? pair.ai.content : '';

      // 获取该轮全链路快照
      let linkSteps = null;
      try {
        const linkResult = await operationsAPI.getFullLinkChain(sessionId, turn);
        if (linkResult.ok) linkSteps = linkResult.link;
      } catch (_) { /* 无快照时退化为静态链路 */ }

      // 组装链路 HTML
      let chainHtml = '';
      if (linkSteps && linkSteps.length) {
        chainHtml = linkSteps.map(ls => `
          <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
            <span class="chunk-badge">${ls.step}</span>
            <div style="flex:1">
              <strong style="font-size:13px;color:var(--accent)">${ls.name}</strong>
              <div style="font-size:12.5px;color:var(--text-dim);word-break:break-word;">${ls.detail || '-'}</div>
            </div>
          </div>
          <div style="height:1px;background:var(--border);margin:6px 0;"></div>
        `).join('');
      } else {
        // 静态链路兜底
        chainHtml = `
          ${renderChainStep(1, '用户输入', userQuestion)}
          ${renderChainStep(2, '意图识别', '未记录')}
          ${renderChainStep(3, 'Workflow', '未记录')}
          ${renderChainStep(4, 'RAG 检索', '未记录')}
          ${renderChainStep(5, 'Prompt 组装', '未记录')}
          ${renderChainStep(6, 'LLM 输出', aiAnswer)}
        `;
      }

      html += `
        <div style="background: var(--bg-panel); border: 1px solid var(--border); border-radius: 6px; padding: 14px; margin-bottom: 12px;">
          <div style="font-size: 12px; color: var(--text-faint); margin-bottom: 8px;">
            Turn ${turn} · Workflow: ${pair.ai ? pair.ai.workflowId : '-'} · 耗时: ${pair.ai ? pair.ai.latencyMs : '-'}ms
          </div>
          <div style="margin-bottom: 8px;"><strong>用户输入 →</strong> ${userQuestion}</div>
          <div style="background: var(--bg-panel-2); padding: 12px; border-radius: 6px; margin-bottom: 10px;">
            ${chainHtml}
          </div>
          <div style="background: var(--bg-panel-2); padding: 10px; border-radius: 4px; font-size: 13px; max-height: 200px; overflow-y: auto;">
            <strong style="color:var(--accent);font-size:12px;">AI 输出：</strong><br>
            ${aiAnswer}
          </div>
        </div>
      `;
    }

    if (!html) {
      html = '<div class="ops-empty">该 Session 没有聊天记录</div>';
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="ops-empty">❌ 加载失败: ${e.message}</div>`;
  }
}

function renderChainStep(step, name, detail) {
  return `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;">
      <span class="chunk-badge">${step}</span>
      <div style="flex:1">
        <strong style="font-size:13px;color:var(--accent)">${name}</strong>
        <div style="font-size:12.5px;color:var(--text-dim);word-break:break-word;">${detail || '-'}</div>
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin:6px 0;"></div>
  `;
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