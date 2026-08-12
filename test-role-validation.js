/**
 * 测试 role 白名单校验
 */
const http = require('http');

function postRequest(path, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
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
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  try {
    // 1. 获取账号并登录
    const accountsResp = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/auth/demo-accounts',
        method: 'GET',
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end();
    });

    const testUser = accountsResp.body.accounts[0];
    const loginResp = await postRequest('/api/auth/login', {
      username: testUser.username,
      password: '123456',
    }, '');
    const token = loginResp.body.token;

    console.log('🧪 测试 role 白名单校验\n');

    // 有效的 role
    const validRoles = ['product', 'test', 'frontend', 'cs'];
    for (const role of validRoles) {
      const resp = await postRequest('/api/chat/send', {
        sessionId: 's_role_test',
        role: role,
        bizLine: 'trade',
        userQuestion: `Test ${role}`,
      }, token);
      if (resp.status === 200) {
        console.log(`✅ ${role} 接受`);
      } else {
        console.log(`❌ ${role} 被拒: ${resp.status}`);
      }
    }

    // 无效的 role
    const invalidRole = 'invalid_role';
    const resp = await postRequest('/api/chat/send', {
      sessionId: 's_role_test',
      role: invalidRole,
      bizLine: 'trade',
      userQuestion: 'Test invalid',
    }, token);

    if (resp.status === 400 && !resp.body.ok) {
      console.log(`✅ invalid_role 被正确拒绝 (400)`);
      console.log(`   错误: ${resp.body.error}`);
    } else {
      console.log(`❌ invalid_role 应该被拒绝，实际: ${resp.status}`);
    }

  } catch (err) {
    console.error('❌ 错误:', err.message);
  }
}

test();
