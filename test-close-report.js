const http = require('http');

function post(path, data, authToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    };
    if (authToken) options.headers['Authorization'] = `Bearer ${authToken}`;
    const body = JSON.stringify(data);
    options.headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request(options, res => {
      let b = '';
      res.on('data', d => b += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, body: b }); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3000, path, headers: { Authorization: `Bearer ${token}` } }, res => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

async function main() {
  // 1. 登录拿 token — 先用基本账号密码
  let token = null;
  const adminLogin = await post('/api/auth/login', { username: 'admin', password: '123456' });
  if (adminLogin.status === 200) {
    token = adminLogin.body.token || adminLogin.body.access_token;
    console.log('登录成功: admin');
  } else {
    console.log('登录失败:', adminLogin.status);
  }

  // 2. 发一条聊天消息（需 auth）
  if (token) {
    const send = await post('/api/chat/send', {
      sessionId: 'par_test_session_001',
      role: 'product',
      bizLine: 'all',
      userQuestion: '测试会话结束自动生成报告',
    }, token);
    console.log('发消息:', send.status, send.body?.ok === true ? '✅' : JSON.stringify(send.body));
  }

  // 3. 查报告列表
  const reports = await get('/api/reports?limit=20', token);
  const reportFiles = reports.data || [];
  const matched = reportFiles.filter(r => r.filename.includes('par_test_session_001'));
  console.log('报告列表数:', reportFiles.length);
  console.log('会话报告生成:', matched.length > 0 ? '✅ 是' : '❌ 否');

  // 4. 定时任务计划
  const schedule = await get('/api/reports/cron/schedule', token);
  console.log('定时任务:', schedule.data?.dailyReport?.schedule === '00 23 * * *' ? '✅ 正确' : '❌ 错误');
  process.exit(0);
}
main();