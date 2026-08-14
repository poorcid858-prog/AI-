const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');
const config = require('../config');

// ---------- 登录 ----------

test('正确的账号密码可以登录，并签发 token', () => {
  const r = auth.login('zhangsan', '123456');
  assert.strictEqual(r.ok, true);
  assert.ok(r.token && r.token.length >= 16, 'token 应为足够长的随机串');
  assert.strictEqual(r.user.username, 'zhangsan');
});

test('返回给前端的用户对象绝不包含密码字段', () => {
  const r = auth.login('admin', '123456');
  assert.strictEqual(r.user.password, undefined);
  const me = auth.publicView(auth.userByToken(r.token));
  assert.strictEqual(me.password, undefined);
});

test('密码错误无法登录', () => {
  const r = auth.login('zhangsan', 'wrong-password');
  assert.strictEqual(r.ok, false);
});

test('账号不存在与密码错误返回同一错误文案，避免账号枚举', () => {
  const a = auth.login('zhangsan', 'wrong');
  const b = auth.login('this-user-does-not-exist', 'wrong');
  assert.strictEqual(a.error, b.error);
});

test('登出后 token 立即失效', () => {
  const r = auth.login('wangwu', '123456');
  assert.ok(auth.userByToken(r.token));
  auth.logout(r.token);
  assert.strictEqual(auth.userByToken(r.token), null);
});

test('伪造的 token 取不到用户', () => {
  assert.strictEqual(auth.userByToken('deadbeef'.repeat(4)), null);
});

// ---------- 角色权限 ----------

test('只有 admin 能写入，其他角色一律不能', () => {
  const users = auth.loadUsers();
  for (const u of users) {
    const expected = u.role === 'admin';
    assert.strictEqual(auth.canWrite(u), expected, `${u.username}(${u.role}) 写权限判定错误`);
  }
});

test('admin 和 reviewer 能审核', () => {
  for (const u of auth.loadUsers()) {
    const expected = u.role === 'reviewer' || u.role === 'admin';
    assert.strictEqual(auth.canReview(u), expected, `${u.username} 审核权限判定错误`);
  }
});

test('guest 是只读账号：不能写、不能审核，但能使用系统', () => {
  const guest = auth.loadUsers().find((u) => u.username === 'guest');
  assert.ok(guest, '必须存在 guest 演示账号');
  assert.strictEqual(guest.readonly, true);
  assert.strictEqual(auth.canWrite(guest), false);
  assert.strictEqual(auth.canReview(guest), false);
  assert.strictEqual(auth.canUse(guest), true);
});

// ---------- 业务线隔离（RAG 权限过滤的基础）----------

test('交易线账号只能访问 trade，访问不到 membership', () => {
  const zhangsan = auth.loadUsers().find((u) => u.username === 'zhangsan');
  const lines = auth.accessibleBizLines(zhangsan);
  assert.deepStrictEqual(lines, ['trade']);
  assert.ok(!lines.includes('membership'), '交易线账号不得访问会员线');
});

test('会员线账号只能访问 membership，访问不到 trade', () => {
  const lisi = auth.loadUsers().find((u) => u.username === 'lisi');
  const lines = auth.accessibleBizLines(lisi);
  assert.deepStrictEqual(lines, ['membership']);
  assert.ok(!lines.includes('trade'), '会员线账号不得访问交易线');
});

test('bizLine=all 的账号可跨业务线访问', () => {
  const qianqi = auth.loadUsers().find((u) => u.username === 'qianqi');
  const lines = auth.accessibleBizLines(qianqi);
  assert.ok(lines.includes('trade') && lines.includes('membership'));
});

// ---------- 安全等级 ----------

test('客服与访客只能读 public 级知识，读不到任何内部知识', () => {
  const S = config.securityLevels;
  for (const name of ['cs_agent', 'guest']) {
    const u = auth.loadUsers().find((x) => x.username === name);
    assert.strictEqual(auth.maxSecurityLevel(u), S.public, `${name} 不得读取 public 之上的知识`);
  }
});

test('内部岗位可读到 confidential，但读不到 secret', () => {
  const S = config.securityLevels;
  for (const name of ['zhangsan', 'wangwu', 'zhaoliu']) {
    const u = auth.loadUsers().find((x) => x.username === name);
    assert.strictEqual(auth.maxSecurityLevel(u), S.confidential);
  }
});

test('admin 与 reviewer 可读 secret', () => {
  const S = config.securityLevels;
  for (const name of ['admin', 'reviewer']) {
    const u = auth.loadUsers().find((x) => x.username === name);
    assert.strictEqual(auth.maxSecurityLevel(u), S.secret);
  }
});

test('未登录用户的安全等级为 -1，低于任何真实密级', () => {
  assert.ok(auth.maxSecurityLevel(null) < config.securityLevels.public);
});

// ---------- 中间件 ----------

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('requireAuth 拦截无 token 的请求，返回 401', () => {
  const res = fakeRes();
  let passed = false;
  auth.requireAuth({ headers: {}, query: {} }, res, () => { passed = true; });
  assert.strictEqual(passed, false);
  assert.strictEqual(res.statusCode, 401);
});

test('requireWrite 拦截 guest 的写操作，返回 403 —— 后端拦截而非前端隐藏', () => {
  const guest = auth.loadUsers().find((u) => u.username === 'guest');
  const res = fakeRes();
  let passed = false;
  auth.requireWrite({ user: guest }, res, () => { passed = true; });
  assert.strictEqual(passed, false, 'guest 的写操作必须被拦截');
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.body.error, /只读/);
});

test('requireWrite 拦截产品经理的写操作（非管理员无权上传知识）', () => {
  const zhangsan = auth.loadUsers().find((u) => u.username === 'zhangsan');
  const res = fakeRes();
  let passed = false;
  auth.requireWrite({ user: zhangsan }, res, () => { passed = true; });
  assert.strictEqual(passed, false);
  assert.strictEqual(res.statusCode, 403);
});

test('requireWrite 放行管理员', () => {
  const admin = auth.loadUsers().find((u) => u.username === 'admin');
  const res = fakeRes();
  let passed = false;
  auth.requireWrite({ user: admin }, res, () => { passed = true; });
  assert.strictEqual(passed, true);
});

test('requireReview 放行审核员和管理员（管理员有全部权限）', () => {
  const reviewer = auth.loadUsers().find((u) => u.username === 'reviewer');
  const admin = auth.loadUsers().find((u) => u.username === 'admin');

  let reviewerPassed = false;
  auth.requireReview({ user: reviewer }, fakeRes(), () => { reviewerPassed = true; });
  assert.strictEqual(reviewerPassed, true, '审核员应能审核');

  let adminPassed = false;
  auth.requireReview({ user: admin }, fakeRes(), () => { adminPassed = true; });
  assert.strictEqual(adminPassed, true, '管理员应有全部权限，包括审核权');
});

// ---------- 数据完整性 ----------

test('九个演示账号齐备，且每个字段都合法', () => {
  const users = auth.loadUsers();
  assert.strictEqual(users.length, 9, '应有 9 个演示账号');

  const seenIds = new Set();
  const seenNames = new Set();
  for (const u of users) {
    assert.ok(u.id, '账号缺少 id');
    assert.ok(!seenIds.has(u.id), `id 重复: ${u.id}`);
    assert.ok(!seenNames.has(u.username), `username 重复: ${u.username}`);
    seenIds.add(u.id);
    seenNames.add(u.username);

    assert.ok(config.roles[u.role], `${u.username} 的角色未在 config 中定义: ${u.role}`);
    assert.ok(config.bizLines[u.bizLine], `${u.username} 的业务线非法: ${u.bizLine}`);
    assert.ok(u.name && u.department && u.avatar, `${u.username} 缺少展示字段`);
  }
});

test('每个角色至少有一个演示账号，方便逐角色体验', () => {
  const roles = new Set(auth.loadUsers().map((u) => u.role));
  for (const r of Object.keys(config.roles)) {
    assert.ok(roles.has(r), `缺少角色 ${r} 的演示账号`);
  }
});
