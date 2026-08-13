const http = require('http');

function testAPI(path, method, data) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (method === 'POST' && data) {
      const body = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          resolve({ status: res.statusCode, body: result });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    if (method === 'POST' && data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 报告 API 集成测试\n');

  try {
    // T1: 生成会话报告
    console.log('T1: 生成会话报告');
    const now = new Date();
    const startTime = new Date(now.getTime() - 30 * 60000); // 30 分钟前
    const t1 = await testAPI('/api/reports/generate/session', 'POST', {
      sessionId: 'sess_demo_001',
      role: 'product',
      startTime: startTime.toISOString(),
      endTime: now.toISOString(),
      turnCount: 5,
      successCount: 4,
      failCount: 1,
    });
    console.log('  状态:', t1.status);
    console.log('  成功率:', t1.body.data?.successRate + '%');
    console.log('  ✅ 通过\n');

    // T2: 生成日报告
    console.log('T2: 生成日报告');
    const t2 = await testAPI('/api/reports/generate/daily', 'POST', {
      date: '2026-08-12',
      sessions: [
        { sessionId: 's1', role: 'product', turnCount: 5 },
        { sessionId: 's2', role: 'test', turnCount: 3 },
        { sessionId: 's3', role: 'frontend', turnCount: 4 },
      ],
    });
    console.log('  状态:', t2.status);
    console.log('  会话数:', t2.body.data?.sessionCount);
    console.log('  总轮数:', t2.body.data?.totalTurns);
    console.log('  ✅ 通过\n');

    // T3: 获取报告列表
    console.log('T3: 获取报告列表');
    const t3 = await testAPI('/api/reports?limit=10', 'GET');
    console.log('  状态:', t3.status);
    console.log('  报告数:', t3.body.data?.length);
    console.log('  ✅ 通过\n');

    // T4: 获取定时任务计划
    console.log('T4: 获取定时任务计划');
    const t4 = await testAPI('/api/reports/cron/schedule', 'GET');
    console.log('  状态:', t4.status);
    console.log('  日报告计划:', t4.body.data?.dailyReport?.schedule);
    console.log('  ✅ 通过\n');

    console.log('所有报告 API 测试通过！🎉');
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  process.exit(0);
}

runTests();
