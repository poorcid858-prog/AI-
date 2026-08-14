# 任务包 G：管理后台配置功能

## 问题描述
管理后台需要支持6个配置功能，这些配置会影响系统的行为和用户体验。

## 六大配置功能

### 功能1：密码配置（Password Management）
**用途**：为临时用户设置访问密码

**功能描述**：
- 管理员可以生成临时密码
- 每个密码可以设置有效期（最长1小时）
- 临时用户用密码登录后才能访问系统
- PM本人登录不需要密码（系统自动识别）

**配置项**：
- 是否启用密码保护
- 默认密码有效期（分钟）
- 密码有效期限制（最长1小时）
- 密码复杂度要求

**UI设计**：
```
[密码配置]
启用密码保护: [开关]
默认有效期: [60] 分钟
最长有效期: [60] 分钟 (不可改)
密码复杂度: [简单/中等/复杂] 下拉

[临时密码管理]
生成新密码: [生成按钮]

[已生成的密码列表]
| 密码 | 创建时间 | 有效期 | 状态 | 操作 |
|-----|--------|--------|------|------|
|... |... |... |已使用/未使用| 删除 |
```

### 功能2：Chunk切分方法配置（Document Chunking Strategy）
**用途**：配置文档如何切分成Chunk

**支持的切分方式**：

#### 方式1：按Token数量切分
```
参数：
- Chunk最大Token数: [1000]
- Overlap Token数: [100]  (两个Chunk的重叠部分)
```

#### 方式2：按副标题切分
```
参数：
- 按哪级标题切分: ○ 一级  ○ 二级  ○ 三级
- 如果找不到标题则: ○ 按Token数切分  ○ 不切分
```

**配置UI设计**：
```
[Chunk切分方法配置]

切分方式选择：
○ 按Token数量切分
    Chunk最大Token数: [1000]
    Overlap Token数: [100]
    
○ 按副标题切分
    按哪级标题: [三级标题 ▼]
    标题不存在时: [按Token数切分 ▼]

预览效果: [显示切分后的样例]

[保存] [取消]
```

**数据库表**：
- `chunking_config`
  - strategy (token_based / header_based)
  - max_tokens (仅token_based)
  - overlap_tokens (仅token_based)
  - header_level (仅header_based: 1/2/3)
  - created_at / updated_at

### 功能3：提问模板配置（Prompt Template Configuration）
**用途**：配置AI聊天中可用的提问模板

**功能描述**：
- 最多配置10条提问模板
- 每条模板可以分别为不同角色配置（测试/产品/前端）
- 用户可以直接点击模板快速提问

**模板字段**：
- 模板名称 (比如 "生成一个PRD")
- 模板内容 (实际的提问文本)
- 适用角色 (测试/产品/前端/全部)
- 优先级 (1-10，决定显示顺序)
- 是否启用

**UI设计**：
```
[提问模板配置]

已配置的模板 (最多10条):
| 序号 | 名称 | 角色 | 优先级 | 状态 | 操作 |
|-----|------|------|--------|------|------|
| 1 | 生成PRD | 产品 | 1 | 启用 | 编辑 删除 |
| 2 | 代码审查 | 全部 | 2 | 启用 | 编辑 删除 |
|... |... |... |... |... |... |

[新增模板]
模板名称: [_________]
适用角色: [产品 ▼]
提问内容: [_________________]
优先级: [1] (1最高)
启用: ☑

[保存] [取消]
```

### 功能4：分层级Prompt配置（Layered Prompt Configuration）
**用途**：为不同岗位、业务线配置不同的系统Prompt

**功能描述**：
- 配置全系统级别的基础Prompt
- 可以为不同岗位配置职业化的Prompt（产品经理、前端工程师、测试工程师等）
- 可以为不同业务线配置行业化的Prompt（比如"销售部"、"技术部"等）
- AI回答时，会根据用户角色自动选择合适的Prompt

**Prompt的作用**：
- 定义AI的角色和行为
- 定义AI的回答风格和深度
- 定义AI可以访问的知识库
- 定义AI的安全和合规要求

**UI设计**：
```
[分层级Prompt配置]

[全系统级Prompt]
基础Prompt:
[多行文本框]
你是一个企业AI助手，专业、准确、诚恳。
你将帮助用户...
[/多行文本框]

[岗位级Prompt]
岗位: [产品经理 ▼]
Prompt:
[多行文本框]
你是一个产品经理的助手...
[/多行文本框]
+ [添加更多岗位]

[业务线级Prompt]
业务线: [销售部 ▼]
Prompt:
[多行文本框]
你是销售部的AI助手...
[/多行文本框]
+ [添加更多业务线]

[预览] [保存] [取消]
```

**数据库表**：
- `prompt_config`
  - level (global / role / business_line)
  - role_name (仅role级别)
  - business_line (仅business_line级别)
  - prompt_text (实际的Prompt内容)
  - created_at / updated_at

### 功能5：用户管理（User Management）
**用途**：创建和管理临时用户

**功能描述**：
- 创建临时用户（可以分配密码）
- 设置用户的角色和权限
- 查看用户登录记录
- 禁用或删除用户

**UI设计**：
```
[用户管理]

[创建新用户]
用户名: [_________]
邮箱: [_________]
角色: [产品经理 ▼]
密码: [_________]
有效期: [60] 分钟
[创建] [取消]

[用户列表]
| 用户名 | 邮箱 | 角色 | 创建时间 | 最后登录 | 状态 | 操作 |
|--------|------|------|---------|---------|------|------|
|... |... |... |... |... |启用| 编辑 禁用 |
```

### 功能6：系统参数配置（System Configuration）
**用途**：配置其他通用系统参数

**可配置的参数**：
- 系统名称
- 系统Logo
- 系统语言
- 时区
- 日志保留天数
- 会话超时时间
- 等等

**UI设计**：
```
[系统参数配置]

系统名称: [企业AI助手平台]
系统Logo: [上传图片]
系统语言: [中文 ▼]
时区: [UTC+8 ▼]
日志保留天数: [90]
会话超时(分钟): [30]

[保存] [取消]
```

## 系统架构

### 数据库表

```sql
-- 密码配置
CREATE TABLE password_config (
  id INT PRIMARY KEY,
  enable BOOLEAN,
  default_expire_minutes INT,
  max_expire_minutes INT,
  complexity ENUM('simple', 'medium', 'hard'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 临时密码
CREATE TABLE temp_passwords (
  id INT PRIMARY KEY,
  password VARCHAR(255),
  created_at TIMESTAMP,
  expire_at TIMESTAMP,
  used BOOLEAN,
  user_id INT
);

-- Chunk切分配置
CREATE TABLE chunking_config (
  id INT PRIMARY KEY,
  strategy ENUM('token_based', 'header_based'),
  max_tokens INT,
  overlap_tokens INT,
  header_level INT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 提问模板
CREATE TABLE prompt_templates (
  id INT PRIMARY KEY,
  name VARCHAR(255),
  content TEXT,
  role ENUM('product', 'frontend', 'test', 'all'),
  priority INT,
  enabled BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 分层Prompt
CREATE TABLE prompt_layers (
  id INT PRIMARY KEY,
  level ENUM('global', 'role', 'business_line'),
  role_name VARCHAR(255),
  business_line VARCHAR(255),
  prompt_text TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 用户管理
CREATE TABLE admin_users (
  id INT PRIMARY KEY,
  username VARCHAR(255),
  email VARCHAR(255),
  role VARCHAR(255),
  password_hash VARCHAR(255),
  last_login TIMESTAMP,
  enabled BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- 系统参数
CREATE TABLE system_config (
  id INT PRIMARY KEY,
  key VARCHAR(255),
  value TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### API端点

```
## 密码配置
GET /api/admin/password-config
PUT /api/admin/password-config
POST /api/admin/temp-passwords (生成临时密码)
GET /api/admin/temp-passwords (列表)
DELETE /api/admin/temp-passwords/:id

## Chunk切分配置
GET /api/admin/chunking-config
PUT /api/admin/chunking-config

## 提问模板
GET /api/admin/prompt-templates
POST /api/admin/prompt-templates
PUT /api/admin/prompt-templates/:id
DELETE /api/admin/prompt-templates/:id

## 分层Prompt
GET /api/admin/prompt-layers
POST /api/admin/prompt-layers
PUT /api/admin/prompt-layers/:id
DELETE /api/admin/prompt-layers/:id

## 用户管理
GET /api/admin/users
POST /api/admin/users
PUT /api/admin/users/:id
DELETE /api/admin/users/:id

## 系统参数
GET /api/admin/system-config
PUT /api/admin/system-config/:key
```

## 修复步骤

### 第1阶段：数据库设计和迁移
- [ ] 设计所有配置表的结构
- [ ] 创建迁移脚本
- [ ] 执行迁移

### 第2阶段：后端API开发
- [ ] 实现密码配置API
- [ ] 实现Chunk切分配置API
- [ ] 实现提问模板API
- [ ] 实现分层Prompt API
- [ ] 实现用户管理API
- [ ] 实现系统参数API
- [ ] 添加权限检查

### 第3阶段：前端界面开发
- [ ] 创建管理后台配置页面 (扩展现有的 `public/admin.html`)
- [ ] 实现各个配置功能的UI
- [ ] 实现表单验证和提交
- [ ] 实现配置的查看和编辑

### 第4阶段：集成和测试
- [ ] 与其他系统集成
  - 聊天系统读取提问模板
  - 聊天系统读取分层Prompt
  - 知识库系统读取Chunk切分配置
- [ ] 功能测试
- [ ] 性能测试

## 工作量估计

| 阶段 | 任务 | 工作量 |
|------|------|--------|
| 设计 | 数据库和API设计 | 3小时 |
| 数据库 | 创建和迁移 | 1小时 |
| 后端 | 6个功能的API开发 | 6小时 |
| 前端 | 6个功能的UI开发 | 8小时 |
| 集成 | 与各系统集成 | 3小时 |
| 测试 | 功能和性能测试 | 3小时 |
| **总计** | | **24小时** |

## 验收标准

1. ✅ 管理后台能访问配置页面
2. ✅ 密码配置功能正常
3. ✅ Chunk切分配置正常（知识库会使用这个配置）
4. ✅ 提问模板配置正常（聊天页能显示这些模板）
5. ✅ 分层Prompt配置正常（AI会根据用户角色使用不同Prompt）
6. ✅ 用户管理功能正常
7. ✅ 系统参数配置正常
8. ✅ 所有修改都能保存到数据库
9. ✅ 所有测试通过

## 相关功能
- 与聊天系统集成：使用提问模板和分层Prompt
- 与知识库系统集成：使用Chunk切分配置
- 与权限系统集成：只有管理员能访问配置页面