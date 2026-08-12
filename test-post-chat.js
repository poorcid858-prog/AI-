/**
 * 测试 POST /api/chat/send 的快速验证脚本
 */
const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  try {
    // 1. 获取演示账号
    console.log('\n📌 获取演示账号...');
    const accountsResp = await request('GET', '/api/auth/demo-accounts');
    if (accountsResp.status !== 200) {
      console.log('❌ 获取账号失败:', accountsResp.status);
      process.exit(1);
    }
    const accounts = accountsResp.body.accounts;
    const testUser = accounts[0];
    console.log(`✅ 获取成功，用户: ${testUser.username} (${testUser.name})`);

    // 2. 登录
    console.log('\n📌 登录...');
    const loginResp = await request('POST', '/api/auth/login', {
      username: testUser.username,
      password: '123456',
    });
    if (loginResp.status !== 200) {
      console.log('❌ 登录失败:', loginResp.status, loginResp.body);
      process.exit(1);
    }
    const token = loginResp.body.token;
    console.log(`✅ 登录成功，token: ${token.slice(0, 8)}...`);

    // 3. 发送问题到 POST /api/chat/send
    console.log('\n📌 发送问题 (POST /api/chat/send)...');
    const sendBody = {
      sessionId: 's_test_001',
      role: 'product',
      bizLine: 'trade',
      userQuestion: '退款流程是什么？',
      ragChunks: [{ id: 'chunk_001', text: 'test chunk' }],
    };

    // 需要在 header 中设置 Authorization token
    const sendOptions = {
      hostname: 'localhost',
      port: 3000,
      path: '/api/chat/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };

    const sendResp = await new Promise((resolve, reject) => {
      const req = http.request(sendOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', reject);
      req.write(JSON.stringify(sendBody));
      req.end();
    });

    console.log(`\n📊 响应状态: ${sendResp.status}`);
    console.log(`📦 响应体:`, JSON.stringify(sendResp.body, null, 2));

    if (sendResp.status === 200 && sendResp.body.ok) {
      console.log('\n✅ POST /api/chat/send 返回 200 OK');
      process.exit(0);
    } else {
      console.log(`\n❌ 异常: 期望 200 OK，实际 ${sendResp.status}`);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ 错误:', err.message);
    process.exit(1);
  }
}

test();
