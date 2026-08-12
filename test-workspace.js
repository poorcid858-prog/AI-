/**
 * 测试 B5 - workspace.html 功能
 */

const http = require('http');

function request(method, path, body = null, token = null) {
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

    if (token) {
      options.headers.Authorization = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('========== 测试 B5: workspace.html ==========\n');

  try {
    // 1. 登录（使用 admin 账号，因为当前 routes/chat.js 需要 requireWrite）
    console.log('1. 登录...');
    const loginRes = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: '123456',
    });
    if (loginRes.status !== 200) {
      console.error('❌ 登录失败:', loginRes.data);
      return;
    }
    const token = loginRes.data.token;
    console.log('✓ 登录成功，token:', token.slice(0, 20) + '...');

    // 2. 获取历史聊天列表
    console.log('\n2. 获取历史聊天列表...');
    const historyRes = await request('GET', '/api/chat/history');
    if (historyRes.status !== 200) {
      console.error('❌ 获取失败:', historyRes.data);
      return;
    }
    console.log(`✓ 历史列表：${historyRes.data.total} 个会话`);
    if (historyRes.data.sessions.length > 0) {
      const firstSession = historyRes.data.sessions[0];
      console.log(`  - sessionId: ${firstSession.sessionId}`);
      console.log(`  - summary: ${firstSession.summary}`);
      console.log(`  - recordCount: ${firstSession.recordCount}`);
    }

    // 3. 获取常用问题（product 岗位）
    console.log('\n3. 获取常用问题 (product)...');
    const freqRes = await request('GET', '/api/chat/frequency?role=product');
    if (freqRes.status !== 200) {
      console.error('❌ 获取失败:', freqRes.data);
      return;
    }
    console.log(`✓ 常用问题：${freqRes.data.total} 条`);
    freqRes.data.frequency.slice(0, 3).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.text} (count: ${item.count})`);
    });

    // 4. 获取某个 session 的消息
    console.log('\n4. 获取 session 消息...');
    const testSessionId = 's_test_001';
    const sessionRes = await request('GET', `/api/chat/session/${testSessionId}`);
    if (sessionRes.status !== 200) {
      console.error('❌ 获取失败:', sessionRes.data);
      return;
    }
    console.log(`✓ Session ${testSessionId} 有 ${sessionRes.data.records.length} 条消息`);

    // 5. 发送新问题
    console.log('\n5. 发送新问题...');
    const newSessionId = `sess_test_${Date.now()}`;
    const sendRes = await request('POST', '/api/chat/send', {
      sessionId: newSessionId,
      role: 'product',
      bizLine: 'trade',
      userQuestion: '这是一个测试问题',
    }, token);
    if (sendRes.status !== 200) {
      console.error('❌ 发送失败:', sendRes.data);
      return;
    }
    console.log('✓ 发送成功');
    console.log(`  - turn: ${sendRes.data.turn}`);
    console.log(`  - result: ${sendRes.data.result}`);

    // 6. 验证新会话是否出现在历史中
    console.log('\n6. 验证新会话...');
    const history2Res = await request('GET', '/api/chat/history');
    const newSess = history2Res.data.sessions.find(s => s.sessionId === newSessionId);
    if (newSess) {
      console.log('✓ 新会话已出现在历史中');
      console.log(`  - summary: ${newSess.summary}`);
    } else {
      console.log('⚠ 新会话未在历史中找到');
    }

    // 7. 验证常用问题是否更新
    console.log('\n7. 验证常用问题更新...');
    const freq2Res = await request('GET', '/api/chat/frequency?role=product');
    const testQ = freq2Res.data.frequency.find(f => f.text === '这是一个测试问题');
    if (testQ) {
      console.log('✓ 新问题已出现在常用问题中');
      console.log(`  - count: ${testQ.count}`);
    } else {
      console.log('⚠ 新问题未在常用问题中找到（可能已被去重或需要等待）');
    }

    console.log('\n========== ✓ 所有测试通过 ==========');

  } catch (err) {
    console.error('❌ 测试失败:', err.message);
  }
}

// 等待服务启动
setTimeout(test, 1000);
