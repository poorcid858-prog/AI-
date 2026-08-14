# Session 任务 4：能力中心后端开发

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 12 小时 |
| 难度 | 高 |
| 依赖 | 任务 2（权限补全） |
| 类型 | 数据库设计 + API 开发 |
| 相关文档 | `docs/任务包-D-能力中心.md` |

---

## 问题描述

缺少"能力中心"功能。能力中心是一个配置系统，管理员可以配置 AI 助手的 5 种能力：Workflow、Skill、Reference、Script、Tool。

本任务负责**后端**（数据库和 API）。前端由任务 5 负责。

---

## 核心概念

用户可以配置这 5 种能力：

1. **Workflow** - 工作流，一系列步骤的组合
2. **Skill** - 技能，AI 助手的专业能力
3. **Reference** - 参考资料，知识库内容
4. **Script** - 脚本，自动化脚本
5. **Tool** - 工具，外部工具集成

配置后，AI 助手就多了对应的能力。

---

## 需要做什么

### 步骤 1：数据库设计（2小时）

创建必要的数据库表。使用 SQL 或 ORM（如 Sequelize）：

```sql
-- 能力表
CREATE TABLE capabilities (
  id INT PRIMARY KEY AUTO_INCREMENT,
  type ENUM('workflow', 'skill', 'reference', 'script', 'tool'),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by INT,
  is_active BOOLEAN DEFAULT TRUE
);

-- 能力详情表
CREATE TABLE capability_details (
  id INT PRIMARY KEY AUTO_INCREMENT,
  capability_id INT NOT NULL,
  content JSON,
  version INT DEFAULT 1,
  FOREIGN KEY (capability_id) REFERENCES capabilities(id)
);

-- 能力关系表（可选）
CREATE TABLE capability_relations (
  id INT PRIMARY KEY AUTO_INCREMENT,
  capability_id INT NOT NULL,
  related_capability_id INT NOT NULL,
  relation_type VARCHAR(50),
  FOREIGN KEY (capability_id) REFERENCES capabilities(id),
  FOREIGN KEY (related_capability_id) REFERENCES capabilities(id)
);
```

**步骤**：
- [ ] 分析现有数据库结构
- [ ] 设计新表的字段和关系
- [ ] 创建迁移脚本
- [ ] 执行迁移（确保数据不丢失）

### 步骤 2：后端 API 开发（8小时）

创建能力管理的 API 接口。在 `routes/capability.js` 中实现：

#### 基础 CRUD 操作

```javascript
// GET /api/capability/list?type=workflow&keyword=...&page=1
// 返回能力列表（支持过滤、搜索、分页）

// POST /api/capability/create
// 创建新能力

// GET /api/capability/:id
// 获取能力详情

// PUT /api/capability/:id
// 编辑能力

// DELETE /api/capability/:id
// 删除能力
```

#### 类型特定的操作

```javascript
// Workflow 相关
GET /api/workflow/list
POST /api/workflow/create
GET /api/workflow/:id
PUT /api/workflow/:id
DELETE /api/workflow/:id
POST /api/workflow/:id/execute (执行工作流)

// Skill 相关
GET /api/skill/list
POST /api/skill/create
GET /api/skill/:id
PUT /api/skill/:id
DELETE /api/skill/:id

// Reference、Script、Tool 类似
```

**实现要点**：
- [ ] 参数验证
- [ ] 权限检查（只有管理员能管理能力）
- [ ] 数据库操作
- [ ] 错误处理
- [ ] 返回正确的 HTTP 状态码

**API 返回格式示例**：
```json
{
  "success": true,
  "data": {
    "id": 1,
    "type": "skill",
    "name": "产品经理分析技能",
    "description": "...",
    "created_at": "2026-08-15T10:00:00Z"
  }
}
```

### 步骤 3：权限控制（1小时）

- [ ] 添加权限检查中间件
- [ ] 确保只有管理员能管理能力
- [ ] 添加日志（记录谁修改了哪个能力）

```javascript
const checkAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
};

router.post('/capability/create', checkAdmin, createCapability);
```

### 步骤 4：测试（1小时）

- [ ] 单元测试：每个 API 都有测试
- [ ] 集成测试：测试权限、数据流等
- [ ] 手动测试：用 curl 或 Postman 测试每个端点

```bash
# 测试列表 API
curl http://localhost:3000/api/capability/list?type=skill

# 测试创建 API
curl -X POST http://localhost:3000/api/capability/create \
  -H "Content-Type: application/json" \
  -d '{"type":"skill","name":"测试技能",...}'
```

---

## 验收标准

✅ 数据库表创建成功  
✅ 所有 API 接口都能正常工作  
✅ API 返回格式正确  
✅ 权限控制正确（只有管理员能管理）  
✅ 参数验证完整  
✅ 错误处理完善  
✅ 单元测试和集成测试通过  
✅ `npm test` 全部通过  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 能力中心后端 API 开发"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况
- [ ] **等待任务 5**（前端）完成后进行集成测试

---

## 重要提示

- ⚠️ 数据库迁移很关键，一定要备份
- ⚠️ API 一定要有权限检查
- ⚠️ 要有完整的错误处理
- ⚠️ 前端任务 5 会基于这个后端开发，所以 API 接口设计要稳定

---

## 与任务 5 的交接

任务 5（前端）需要这些 API：
- `GET /api/capability/list?type={type}`
- `POST /api/capability/create`
- `PUT /api/capability/:id`
- `DELETE /api/capability/:id`

确保这些接口的返回格式是稳定的，文档完整。

---

## 依赖关系

- ✅ 任务 2 必须先完成
- 🔄 可与任务 5（前端）并行进行（但后端要先完成）
- 🔄 可与任务 3、6、7、8、9 并行进行