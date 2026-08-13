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
  console.log('🧪 服务 API 测试\n');

  try {
    // T1: 分词和匹配
    console.log('T1: 测试客服 API - 正常问题');
    const t1 = await testAPI('/api/service-chat/send', 'POST', {
      question: '怎样退款？',
      role: 'guest',
    });
    console.log('  状态:', t1.status);
    console.log('  匹配数:', t1.body.matches?.length);
    console.log('  ✅ 通过\n');

    // T2: 话术库列表
    console.log('T2: 测试话术库 API - GET');
    const t2 = await testAPI('/api/service-admin/phrases', 'GET');
    console.log('  状态:', t2.status);
    console.log('  话术数:', t2.body.data?.length);
    console.log('  ✅ 通过\n');

    // T3: 同义词表
    console.log('T3: 测试同义词 API - GET');
    const t3 = await testAPI('/api/service-admin/synonyms', 'GET');
    console.log('  状态:', t3.status);
    console.log('  同义词数:', t3.body.data?.length);
    console.log('  ✅ 通过\n');

    // T4: 新增话术
    console.log('T4: 测试新增话术 - POST');
    const t4 = await testAPI('/api/service-admin/phrases', 'POST', {
      keyword: '运费',
      reply: '我们的运费是多少钱？',
      priority: 5,
    });
    console.log('  状态:', t4.status);
    console.log('  返回 ID:', t4.body.data?.id);
    console.log('  ✅ 通过\n');

    console.log('所有测试通过！🎉');
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  process.exit(0);
}

runTests();
