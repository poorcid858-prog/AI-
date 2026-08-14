# Session 任务 9：管理后台配置功能

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟡 **中** |
| 工作量 | 24 小时 |
| 难度 | 中 |
| 依赖 | 任务 2（权限）、任务 6（知识库架构） |
| 类型 | 数据库 + API + 前端 |
| 相关文档 | `docs/任务包-G-管理后台配置功能.md` |

---

## 问题描述

管理后台缺少系统配置功能。需要实现 6 个配置模块：

1. **密码配置** - 为临时用户设置访问密码
2. **Chunk 切分配置** - 配置文档如何切分
3. **提问模板配置** - 配置聊天提问模板（最多10条）
4. **分层级 Prompt 配置** - 为不同角色配置不同的 Prompt
5. **用户管理** - 创建和管理临时用户
6. **系统参数配置** - 配置系统的通用参数

---

## 工作量大（24小时），建议分工：

- **后端**（12小时）：数据库设计 + 6 个 API
- **前端**（12小时）：6 个配置界面

---

## 后端工作（12小时）

### 1. 数据库设计（2小时）

```sql
-- 密码配置
CREATE TABLE password_config (
  id INT PRIMARY KEY,
  enable BOOLEAN,
  default_expire_minutes INT,
  max_expire_minutes INT,
  complexity VARCHAR(50)
);

-- 临时密码
CREATE TABLE temp_passwords (
  id INT PRIMARY KEY AUTO_INCREMENT,
  password VARCHAR(255),
  created_at TIMESTAMP,
  expire_at TIMESTAMP,
  used BOOLEAN
);

-- Chunk 切分配置
CREATE TABLE chunking_config (
  id INT PRIMARY KEY,
  strategy VARCHAR(50),
  max_tokens INT,
  overlap_tokens INT,
  header_level INT
);

-- 提问模板
CREATE TABLE prompt_templates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255),
  content TEXT,
  role VARCHAR(50),
  priority INT,
  enabled BOOLEAN
);

-- 分层 Prompt
CREATE TABLE prompt_layers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  level VARCHAR(50),
  role_name VARCHAR(255),
  business_line VARCHAR(255),
  prompt_text TEXT
);

-- 系统参数
CREATE TABLE system_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  key VARCHAR(255),
  value TEXT
);
```

### 2. API 开发（8小时）

在 `routes/admin.js` 中实现 6 个功能的 API：

```javascript
// 密码配置 API
router.get('/api/admin/password-config', getPasswordConfig);
router.put('/api/admin/password-config', updatePasswordConfig);
router.post('/api/admin/temp-passwords', generateTempPassword);

// Chunk 切分配置 API
router.get('/api/admin/chunking-config', getChunkingConfig);
router.put('/api/admin/chunking-config', updateChunkingConfig);

// 提问模板 API
router.get('/api/admin/prompt-templates', listPromptTemplates);
router.post('/api/admin/prompt-templates', createPromptTemplate);
router.put('/api/admin/prompt-templates/:id', updatePromptTemplate);
router.delete('/api/admin/prompt-templates/:id', deletePromptTemplate);

// 分层 Prompt API
router.get('/api/admin/prompt-layers', listPromptLayers);
router.post('/api/admin/prompt-layers', createPromptLayer);
router.put('/api/admin/prompt-layers/:id', updatePromptLayer);
router.delete('/api/admin/prompt-layers/:id', deletePromptLayer);

// 用户管理 API
router.get('/api/admin/users', listUsers);
router.post('/api/admin/users', createUser);
router.put('/api/admin/users/:id', updateUser);
router.delete('/api/admin/users/:id', deleteUser);

// 系统参数 API
router.get('/api/admin/system-config', getSystemConfig);
router.put('/api/admin/system-config/:key', updateSystemConfig);
```

### 3. 权限检查（2小时）
- [ ] 添加权限检查中间件
- [ ] 确保只有管理员能修改配置
- [ ] 添加操作日志

---

## 前端工作（12小时）

### 1. 创建配置页面（3小时）

修改或扩展管理后台页面，添加 6 个配置标签页：

```html
<div class="admin-config">
  <div class="tabs">
    <button class="tab-btn active" data-tab="password">密码配置</button>
    <button class="tab-btn" data-tab="chunking">Chunk切分</button>
    <button class="tab-btn" data-tab="templates">提问模板</button>
    <button class="tab-btn" data-tab="prompts">分层Prompt</button>
    <button class="tab-btn" data-tab="users">用户管理</button>
    <button class="tab-btn" data-tab="system">系统参数</button>
  </div>

  <div class="content">
    <div id="password-tab" class="tab-content">
      <!-- 密码配置界面 -->
    </div>
    <!-- 其他标签页 -->
  </div>
</div>
```

### 2. 实现 6 个配置界面（9小时）

每个配置界面都需要：
- 表单（编辑配置）
- 列表（显示当前配置）
- 验证和错误提示
- 保存功能

---

## 验收标准

✅ 6 个配置功能都能正常工作  
✅ 配置能保存到数据库  
✅ 配置能被其他系统使用（聊天系统读取模板、知识库读取切分配置等）  
✅ 权限控制正确（只有管理员能修改）  
✅ 表单验证完整  
✅ UI 美观  
✅ 所有测试通过  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 管理后台6个配置功能实现"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况

---

## 重要提示

- ⚠️ 这个任务涉及系统的重要配置，一定要谨慎
- ⚠️ 每个配置修改后，其他系统要能立即读取新配置
- ⚠️ 考虑添加配置的版本控制和回滚功能