# 能力中心后端开发 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a complete backend system for the Capability Center that allows administrators to manage 5 types of AI assistant capabilities (Workflow, Skill, Reference, Script, Tool) with full CRUD operations, permission control, and audit logging.

**Architecture:** The system extends the existing JSON-file-based storage model with support for multiple capability types. Each capability has a published version, optional draft, and version history. All modifications are logged for audit trails. Permission checks ensure only authenticated admin users can create/edit/delete capabilities.

**Tech Stack:** 
- Node.js + Express (existing)
- JSON file storage via `lib/store.js` (existing)
- Permission middleware via `lib/auth.js` (existing)
- Core engine: `lib/capability-engine.js` (extend)

**Spec:** `docs/任务包-D-能力中心.md` and `docs/session-任务-4-能力中心后端开发.md`

## Global Constraints

- Must support 5 capability types: workflow, skill, reference, script, tool
- Only authenticated users with admin role can create/delete/edit capabilities
- All write operations must be logged to capability-audit.json
- API returns must be in format: `{ ok: true, data: ... }` or `{ ok: false, error: "message" }`
- Database migrations must be safe and preserve existing data
- Existing Skill capabilities (4 defaults) must remain functional
- All tests must pass with `npm test`

---

## Task 1: Extend Capability Engine to Support Create & Delete

**Files:**
- Modify: `lib/capability-engine.js` (add createCapability and deleteCapability functions)
- Modify: `test/capability.test.js` (add tests for create/delete)

**Interfaces:**
- **Consumes:** 
  - `store.read(name, fallback)` - read JSON file
  - `store.write(name, value)` - write JSON file
  - `store.nextId(name, prefix)` - generate auto-increment ID
  - `appendAuditLog(entry)` - log operation
- **Produces:** 
  - `createCapability(type, name, description, content, createdBy)` → returns capability object with id/type/name/description/published/draft/history/createdAt/updatedAt
  - `deleteCapability(capId, deletedBy)` → returns true on success, throws on not found

**Steps:**

- [ ] **Step 1: Add createCapability function to capability-engine.js**

After the `fail()` function definition, add:

```javascript
/**
 * 创建新能力。自动生成 ID（cap_workflow_001 等），初始版本为 1。
 * @param {string} type workflow|skill|reference|script|tool
 * @param {string} name 能力名称
 * @param {string} description 能力描述
 * @param {object} content 能力内容
 * @param {string} createdBy 创建者用户名
 * @returns {Object} 新能力对象
 */
function createCapability(type, name, description, content, createdBy) {
  if (!['workflow', 'skill', 'reference', 'script', 'tool'].includes(type)) {
    throw fail(`无效的能力类型: ${type}`, 400);
  }
  if (!name || !name.trim()) {
    throw fail('缺少能力名称', 400);
  }
  
  const caps = listCapabilities();
  const id = store.nextId(CAPABILITIES_FILE, `cap_${type}`);
  const now = new Date().toISOString();
  
  const newCapability = {
    id,
    type,
    name,
    description: description || '',
    published: {
      version: 1,
      content: JSON.parse(JSON.stringify(content || {})),
      publishedAt: now,
      publishedBy: createdBy,
    },
    draft: null,
    history: [],
    maxHistory: DEFAULT_MAX_HISTORY,
    createdAt: now,
    updatedAt: now,
  };
  
  caps.push(newCapability);
  saveCapabilities(caps);
  
  appendAuditLog({
    action: 'create',
    capId: id,
    capType: type,
    createdBy,
    detail: `创建 ${type} 能力: ${name}`,
  });
  
  return newCapability;
}
```

- [ ] **Step 2: Add deleteCapability function to capability-engine.js**

After `createCapability`, add:

```javascript
/**
 * 删除能力。记录审计日志。
 * @param {string} capId 能力 ID
 * @param {string} deletedBy 删除者用户名
 * @returns {boolean} true 表示删除成功
 */
function deleteCapability(capId, deletedBy) {
  const caps = listCapabilities();
  const idx = (Array.isArray(caps) ? caps : []).findIndex(c => c && c.id === capId);
  if (idx === -1) throw fail('能力不存在', 404);
  
  const deletedCap = caps[idx];
  caps.splice(idx, 1);
  saveCapabilities(caps);
  
  appendAuditLog({
    action: 'delete',
    capId,
    capType: deletedCap.type,
    capName: deletedCap.name,
    deletedBy,
    detail: `删除 ${deletedCap.type} 能力: ${deletedCap.name}`,
  });
  
  return true;
}
```

- [ ] **Step 3: Export new functions from capability-engine.js**

At the end of the file, find the `module.exports` object and add:

```javascript
module.exports = {
  listCapabilities,
  saveCapabilities,
  listCapabilitySummaries,
  getCapability,
  editDraft,
  getDraft,
  getPublished,
  discardDraft,
  publishDraft,
  rollbackToVersion,
  getVersionHistory,
  getAuditLog,
  trialRun,
  diffTexts,
  createCapability,  // 新增
  deleteCapability,  // 新增
};
```

- [ ] **Step 4: Write test for createCapability**

In `test/capability.test.js`, after the existing tests, add:

```javascript
test('T14：createCapability 创建新能力', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const newCap = cap.createCapability(
      'workflow',
      '代码审查工作流',
      '自动审查代码质量',
      { steps: ['分析', '输出'] },
      'admin'
    );
    
    assert.ok(newCap.id.startsWith('cap_workflow_'), '应生成 cap_workflow_ 前缀 ID');
    assert.strictEqual(newCap.type, 'workflow');
    assert.strictEqual(newCap.name, '代码审查工作流');
    assert.strictEqual(newCap.published.version, 1, '初始版本为 1');
    assert.strictEqual(newCap.draft, null, '初始无草稿');
    assert.ok(newCap.createdAt, '应记录创建时间');
    
    // 验证能力已保存到列表
    const all = cap.listCapabilities();
    const found = all.find(c => c.id === newCap.id);
    assert.ok(found, '能力应在列表中');
  });
});

test('T15：createCapability 无效类型应抛错', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    assert.throws(
      () => cap.createCapability('invalid', 'test', '', {}, 'admin'),
      /无效的能力类型/
    );
  });
});

test('T16：createCapability 缺少名称应抛错', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    assert.throws(
      () => cap.createCapability('workflow', '', '', {}, 'admin'),
      /缺少能力名称/
    );
  });
});

test('T17：deleteCapability 删除能力', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    const newCap = cap.createCapability('reference', 'API文档库', '', {}, 'admin');
    
    const result = cap.deleteCapability(newCap.id, 'admin');
    assert.strictEqual(result, true);
    
    // 验证能力已删除
    const found = cap.getCapability(newCap.id);
    assert.strictEqual(found, null, '能力应被删除');
  });
});

test('T18：deleteCapability 不存在的能力应抛 404', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    assert.throws(
      () => cap.deleteCapability('nonexistent', 'admin'),
      /能力不存在/
    );
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- test/capability.test.js
```

Expected: All new tests (T14-T18) should PASS

- [ ] **Step 6: Commit changes**

```bash
git add lib/capability-engine.js test/capability.test.js
git commit -m "feat: 扩展能力引擎支持创建和删除能力"
```

---

## Task 2: Add API endpoints for Create and Delete

**Files:**
- Modify: `routes/capability.js` (add POST / and DELETE /:id routes)
- Modify: `test/capability.test.js` (add API integration tests if needed)

**Interfaces:**
- **Consumes:** 
  - `auth.requireAuth` - middleware to check authentication
  - `auth.requireWrite` - middleware to check write permission (admin)
  - `cap.createCapability(type, name, description, content, createdBy)`
  - `cap.deleteCapability(capId, deletedBy)`
- **Produces:** 
  - `POST /api/capabilities` with body `{type, name, description, content}` → returns `{ok: true, capability: {...}}`
  - `DELETE /api/capabilities/:id` → returns `{ok: true}`

**Steps:**

- [ ] **Step 1: Add POST / endpoint to create capability**

In `routes/capability.js`, after the GET / endpoint, add:

```javascript
// ============================================================
// 创建新能力
// ============================================================

router.post('/', requireWrite, (req, res) => {
  try {
    const { type, name, description, content } = req.body || {};
    if (!type) return res.status(400).json({ ok: false, error: '缺少 type 字段' });
    if (!name) return res.status(400).json({ ok: false, error: '缺少 name 字段' });
    
    const result = cap.createCapability(type, name, description, content, req.user.username);
    res.status(201).json({ ok: true, capability: result });
  } catch (e) {
    sendError(res, e);
  }
});
```

- [ ] **Step 2: Add DELETE /:id endpoint**

In `routes/capability.js`, after the DELETE /:id/draft endpoint, add:

```javascript
// ============================================================
// 删除能力
// ============================================================

router.delete('/:id', requireWrite, (req, res) => {
  try {
    cap.deleteCapability(req.params.id, req.user.username);
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e);
  }
});
```

- [ ] **Step 3: Update routes ordering in server.js comment**

In `server.js` line 41, update the comment to note that capability route is active:

```javascript
// ---------- 路由注册 ----------
// 活跃的路由：auth / documents / workflow / feedback / admin / chat / service / reports / password-mgmt / capability
// 待实现的路由：其他未列出的功能模块
```

- [ ] **Step 4: Test POST endpoint manually**

```bash
# Start server
npm start

# In another terminal, test create:
curl -X POST http://localhost:3000/api/capabilities \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "workflow",
    "name": "Test Workflow",
    "description": "A test workflow",
    "content": {"steps": ["step1", "step2"]}
  }'

# Expected: {"ok": true, "capability": {...}}
```

- [ ] **Step 5: Test DELETE endpoint manually**

```bash
# Delete using the ID from previous response
curl -X DELETE http://localhost:3000/api/capabilities/cap_workflow_001 \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: {"ok": true}
```

- [ ] **Step 6: Commit changes**

```bash
git add routes/capability.js server.js
git commit -m "feat: 添加创建和删除能力的 API 端点"
```

---

## Task 3: Enhance List API with Search, Filter, and Pagination

**Files:**
- Modify: `routes/capability.js` (enhance GET / endpoint)
- Modify: `lib/capability-engine.js` (add listCapabilitiesByType function)
- Modify: `test/capability.test.js` (add tests for filtered list)

**Interfaces:**
- **Consumes:** 
  - `cap.listCapabilitySummaries()` - existing
  - `cap.listCapabilities()` - existing
- **Produces:** 
  - Enhanced GET / endpoint supporting query params: `?type=workflow&keyword=test&page=1&pageSize=10`
  - Returns: `{ok: true, capabilities: [...], total: N, page: 1, pageSize: 10}`

**Steps:**

- [ ] **Step 1: Add filter and pagination logic to GET / endpoint**

In `routes/capability.js`, replace the GET / endpoint with:

```javascript
router.get('/', auth.requireAuth, (req, res) => {
  try {
    const { type, keyword, page = 1, pageSize = 20 } = req.query;
    const summaries = cap.listCapabilitySummaries();
    
    // 按类型过滤
    let filtered = summaries;
    if (type && type.trim()) {
      filtered = filtered.filter(c => c.type === type.trim());
    }
    
    // 按关键词搜索（名称或描述）
    if (keyword && keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      filtered = filtered.filter(c => 
        c.name.toLowerCase().includes(kw) || 
        (c.description && c.description.toLowerCase().includes(kw))
      );
    }
    
    const total = filtered.length;
    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSz = Math.max(1, Math.min(100, parseInt(pageSize, 10))); // 最多 100 条/页
    const start = (pageNum - 1) * pageSz;
    const paginated = filtered.slice(start, start + pageSz);
    
    res.json({
      ok: true,
      capabilities: paginated,
      total,
      page: pageNum,
      pageSize: pageSz,
      totalPages: Math.ceil(total / pageSz),
    });
  } catch (e) {
    sendError(res, e);
  }
});
```

- [ ] **Step 2: Write tests for list with filters**

In `test/capability.test.js`, add:

```javascript
test('T19：listCapabilitySummaries 支持按类型过滤', () => {
  withTempDataDir(() => {
    const cap = require('../lib/capability-engine');
    // 创建多个不同类型的能力
    cap.createCapability('workflow', '工作流1', '', {}, 'admin');
    cap.createCapability('workflow', '工作流2', '', {}, 'admin');
    cap.createCapability('reference', '参考资料', '', {}, 'admin');
    
    const all = cap.listCapabilitySummaries();
    const workflows = all.filter(c => c.type === 'workflow');
    assert.strictEqual(workflows.length, 2, '应有 2 个 workflow');
    
    const references = all.filter(c => c.type === 'reference');
    assert.strictEqual(references.length, 1, '应有 1 个 reference');
  });
});

test('T20：GET /api/capabilities?type=workflow 过滤接口', () => {
  // 此测试需要启动完整的 Express 服务器，建议在 routes-capability.test.js 中实现
  // 步骤类似：创建多个能力，调用 GET /?type=workflow，验证返回值
});
```

- [ ] **Step 3: Test filter and pagination manually**

```bash
# Test with type filter
curl 'http://localhost:3000/api/capabilities?type=workflow' \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test with keyword search
curl 'http://localhost:3000/api/capabilities?keyword=code' \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test with pagination
curl 'http://localhost:3000/api/capabilities?page=2&pageSize=5' \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: All should return {ok: true, capabilities: [...], total: N, ...}
```

- [ ] **Step 4: Commit changes**

```bash
git add routes/capability.js test/capability.test.js
git commit -m "feat: 增强列表 API，支持过滤、搜索和分页"
```

---

## Task 4: Add Admin Permission Check Middleware

**Files:**
- Modify: `routes/capability.js` (add requireAdmin middleware)
- Modify: `lib/auth.js` (add requireAdmin function if not exists)

**Interfaces:**
- **Consumes:** 
  - `auth.requireAuth` - existing middleware
  - `req.user` - user object from auth middleware
- **Produces:** 
  - New middleware: `auth.requireAdmin` that checks if `req.user.role === 'admin'`

**Steps:**

- [ ] **Step 1: Check if requireAdmin exists in auth.js**

```bash
grep -n "requireAdmin" ai-assistant/lib/auth.js
```

If not found, add to `lib/auth.js`:

```javascript
/**
 * 只允许管理员访问
 */
const requireAdmin = (req, res, next) => {
  const user = userByToken(req.get('authorization'));
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: '需要管理员权限' });
  }
  req.user = user;
  next();
};
```

- [ ] **Step 2: Export requireAdmin from auth.js**

Find `module.exports` in auth.js and add:

```javascript
module.exports = {
  // ... existing exports
  requireAdmin,
};
```

- [ ] **Step 3: Use requireAdmin in capability.js**

In `routes/capability.js`, replace all occurrences of `requireWrite` with `[auth.requireAuth, auth.requireAdmin]` for write operations:

```javascript
const requireAdminWrite = [auth.requireAuth, auth.requireAdmin];

// Update all write endpoints:
// router.post('/', requireAdminWrite, (req, res) => {
// router.post('/:id/draft', requireAdminWrite, (req, res) => {
// router.delete('/:id', requireAdminWrite, (req, res) => {
// etc.
```

- [ ] **Step 4: Test permission check**

```bash
# Test without token (should get 403 or 401)
curl -X POST http://localhost:3000/api/capabilities \
  -H "Content-Type: application/json" \
  -d '{"type":"workflow","name":"test"}'

# Expected: error about permission/auth

# Test with non-admin token (should get 403)
curl -X POST http://localhost:3000/api/capabilities \
  -H "Authorization: Bearer GUEST_TOKEN" \
  -d '{"type":"workflow","name":"test"}'

# Expected: {"ok":false,"error":"需要管理员权限"}
```

- [ ] **Step 5: Commit changes**

```bash
git add lib/auth.js routes/capability.js
git commit -m "feat: 添加管理员权限检查"
```

---

## Task 5: Run Full Test Suite and Fix Issues

**Files:**
- Test: `test/capability.test.js` (run all tests)
- Test: All existing tests (ensure no regressions)

**Steps:**

- [ ] **Step 1: Run all capability tests**

```bash
npm test -- test/capability.test.js
```

Expected: All tests PASS

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 3: If any test fails, debug and fix**

For each failing test:
1. Read the error message
2. Identify the issue in the code
3. Fix the code
4. Re-run tests
5. Commit the fix

- [ ] **Step 4: Verify data consistency**

Manually check that:
- `data/capabilities.json` contains all created capabilities
- `data/capability-audit.json` has audit logs for all operations
- Deleting a capability removes it from the list

```bash
# Check capabilities
cat ai-assistant/data/capabilities.json | head -20

# Check audit logs
cat ai-assistant/data/capability-audit.json | tail -5
```

- [ ] **Step 5: Commit final version**

```bash
git add -A
git commit -m "test: 所有能力中心后端测试通过"
```

---

## Task 6: Document API Interfaces for Frontend Team

**Files:**
- Create: `docs/api-capability.md` (API documentation)

**Steps:**

- [ ] **Step 1: Create API documentation**

Create file `docs/api-capability.md` with content:

```markdown
# Capability Center API Documentation

## Overview
Manage AI assistant capabilities (Workflow, Skill, Reference, Script, Tool).

## Authentication
All endpoints require `Authorization: Bearer <token>` header.

## Endpoints

### List Capabilities
**GET /api/capabilities**

Query Parameters:
- `type` (optional): Filter by type (workflow|skill|reference|script|tool)
- `keyword` (optional): Search by name or description
- `page` (optional, default=1): Page number
- `pageSize` (optional, default=20): Items per page

Response:
```json
{
  "ok": true,
  "capabilities": [
    {
      "id": "cap_workflow_001",
      "type": "workflow",
      "name": "Code Review Workflow",
      "description": "Automatic code review",
      "hasDraft": false,
      "publishedVersion": 1,
      "updatedAt": "2026-08-15T..."
    }
  ],
  "total": 5,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1
}
```

### Create Capability
**POST /api/capabilities** (requires admin)

Body:
```json
{
  "type": "workflow",
  "name": "New Workflow",
  "description": "Description here",
  "content": {
    "steps": ["step1", "step2"]
  }
}
```

Response:
```json
{
  "ok": true,
  "capability": {
    "id": "cap_workflow_002",
    "type": "workflow",
    "name": "New Workflow",
    "published": {
      "version": 1,
      "content": {...},
      "publishedAt": "2026-08-15T...",
      "publishedBy": "admin"
    },
    "draft": null,
    "history": [],
    "createdAt": "2026-08-15T...",
    "updatedAt": "2026-08-15T..."
  }
}
```

### Get Capability Details
**GET /api/capabilities/:id**

Response: Same as POST response body.capability

### Edit Draft
**POST /api/capabilities/:id/draft** (requires admin)

Body:
```json
{
  "content": {
    "steps": ["new step1", "new step2"]
  }
}
```

Response: Updated capability object

### Publish Draft
**POST /api/capabilities/:id/publish** (requires admin)

Response: Capability with draft=null, published=new version

### Delete Capability
**DELETE /api/capabilities/:id** (requires admin)

Response:
```json
{
  "ok": true
}
```

### Get Audit Log
**GET /api/capabilities/audit?capId=cap_workflow_001&limit=50**

Response:
```json
{
  "ok": true,
  "logs": [
    {
      "action": "create",
      "capId": "cap_workflow_001",
      "createdBy": "admin",
      "timestamp": "2026-08-15T..."
    }
  ],
  "total": 5
}
```

## Error Responses

### 400 Bad Request
```json
{
  "ok": false,
  "error": "Missing type field"
}
```

### 403 Forbidden
```json
{
  "ok": false,
  "error": "Admin permission required"
}
```

### 404 Not Found
```json
{
  "ok": false,
  "error": "Capability not found"
}
```

## Data Model

Each capability has:
- `id`: Unique identifier (auto-generated)
- `type`: workflow|skill|reference|script|tool
- `name`: Display name
- `description`: Free-form description
- `published`: Current live version
  - `version`: Version number
  - `content`: The capability definition
  - `publishedAt`: Publish timestamp
  - `publishedBy`: Who published it
- `draft`: Optional work-in-progress
  - `version`: Next version number
  - `content`: Draft content
  - `updatedAt`: Last updated
- `history`: Previous published versions
- `maxHistory`: Max versions to keep (default 10)
- `createdAt`: Creation timestamp
- `updatedAt`: Last update timestamp
```

- [ ] **Step 2: Commit documentation**

```bash
git add docs/api-capability.md
git commit -m "docs: 能力中心 API 文档"
```

---

## Verification Checklist

- [ ] All 5 capability types (workflow, skill, reference, script, tool) can be created
- [ ] Capabilities can be edited, published, deleted
- [ ] List API supports filtering by type, keyword search, and pagination
- [ ] Only admins can create/edit/delete capabilities
- [ ] All operations are logged to capability-audit.json
- [ ] Existing default Skills remain functional
- [ ] `npm test` passes completely
- [ ] API returns correct HTTP status codes (201 for POST, 400 for validation errors, 403 for permission errors, 404 for not found)
- [ ] API documentation is complete and accurate

---

## Success Criteria (From Task Spec)

✅ Database design supports all 5 capability types  
✅ All CRUD API endpoints work correctly  
✅ API returns proper format and status codes  
✅ Permission control: only admin can manage  
✅ Parameter validation is complete  
✅ Error handling is comprehensive  
✅ All tests pass  
✅ `npm test` fully passes  
