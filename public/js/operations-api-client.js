/**
 * 运营中心 API 客户端
 */

class OperationsAPIClient {
  constructor(baseUrl = '/api/operations') {
    this.baseUrl = baseUrl;
  }

  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[OperationsAPIClient] ${path}`, error);
      return { ok: false, error: error.message };
    }
  }

  // 查询聊天记录
  async queryChatHistory(filters = {}, pagination = {}) {
    const params = new URLSearchParams();

    if (filters.userId) params.append('userId', filters.userId);
    if (filters.role) params.append('role', filters.role);
    if (filters.keyword) params.append('keyword', filters.keyword);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (pagination.page) params.append('page', pagination.page);
    if (pagination.pageSize) params.append('pageSize', pagination.pageSize);

    const queryStr = params.toString();
    const path = `/chat-records${queryStr ? '?' + queryStr : ''}`;
    return this.request(path);
  }

  // 获取单条记录详情
  async getRecordDetail(sessionId, turn) {
    return this.request(`/chat-records/${sessionId}/${turn}`);
  }

  // 获取 Chunk 使用统计
  async getChunkUsageStats(filters = {}) {
    const params = new URLSearchParams();

    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);

    const queryStr = params.toString();
    const path = `/chunk-usage${queryStr ? '?' + queryStr : ''}`;
    return this.request(path);
  }

  // 获取高频问题
  async getTopQuestions(filters = {}) {
    const params = new URLSearchParams();

    if (filters.role) params.append('role', filters.role);
    if (filters.limit) params.append('limit', filters.limit);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);

    const queryStr = params.toString();
    const path = `/top-questions${queryStr ? '?' + queryStr : ''}`;
    return this.request(path);
  }

  // 获取满意度趋势
  async getSatisfactionTrend(filters = {}) {
    const params = new URLSearchParams();

    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.role) params.append('role', filters.role);

    const queryStr = params.toString();
    const path = `/satisfaction-trend${queryStr ? '?' + queryStr : ''}`;
    return this.request(path);
  }

  // 获取零召回问题
  async getZeroRecallQuestions(filters = {}) {
    const params = new URLSearchParams();

    if (filters.limit) params.append('limit', filters.limit);
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);

    const queryStr = params.toString();
    const path = `/zero-recall${queryStr ? '?' + queryStr : ''}`;
    return this.request(path);
  }

  // 效果分析
  async getEffectAnalysis(filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    if (filters.role) params.append('role', filters.role);
    const queryStr = params.toString();
    return this.request(`/effect-analysis${queryStr ? '?' + queryStr : ''}`);
  }

  // 能力运营分析
  async getCapabilityAnalysis(filters = {}) {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate) params.append('endDate', filters.endDate);
    const queryStr = params.toString();
    return this.request(`/capability-analysis${queryStr ? '?' + queryStr : ''}`);
  }

  // 问题定位全链路
  async getFullLinkChain(sessionId, turn) {
    return this.request(`/full-link/${sessionId}/${turn}`);
  }
}

// 创建全局实例
const operationsAPI = new OperationsAPIClient(App.base + '/api/operations');
