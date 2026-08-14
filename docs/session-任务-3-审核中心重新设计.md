# Session 任务 3：审核中心重新设计

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 10 小时 |
| 难度 | 中 |
| 依赖 | 任务 2（权限补全） |
| 类型 | 页面重新设计 + API 开发 |
| 相关文档 | `docs/任务包-C-审核中心重新设计.md` |

---

## 问题描述

审核中心当前设计太草率，没有表格，不符合行业规范。  
需要重新设计成表格列表形式，一行对应一个待审文件，有操作栏。

---

## 核心需求

### 前端（表格设计）

表格应该包含以下列：
| 列 | 说明 |
|----|------|
| 文件名 | 上传的文档名称 |
| 上传者 | 上传用户 |
| 上传时间 | 上传时间 |
| 文档类型 | PDF/Word/TXT 等 |
| 审核状态 | 待审/已通过/已驳回 |
| 操作 | 查看、审核通过、审核驳回、下载 |

### 后端（API 检查）

需要有 API 提供数据：
- `GET /api/audit/list` - 获取待审文件列表
- `POST /api/audit/approve` - 审核通过
- `POST /api/audit/reject` - 审核驳回

---

## 需要做什么

### 步骤 1：理解现有审核中心（1小时）

- [ ] 找到现有的审核中心页面（`public/audit.html` 或类似）
- [ ] 找到相关的后端 API（`routes/` 中的审核相关接口）
- [ ] 理解现有数据模型
- [ ] 列出现有问题（没有表格、设计不规范等）

### 步骤 2：设计新的 HTML 结构（2小时）

创建一个完整的表格设计：

```html
<div class="audit-center">
  <!-- 搜索和筛选 -->
  <div class="filters">
    <input type="text" placeholder="搜索文件名...">
    <select>
      <option>所有状态</option>
      <option>待审</option>
      <option>已通过</option>
      <option>已驳回</option>
    </select>
    <button>查询</button>
  </div>

  <!-- 表格 -->
  <table class="audit-table">
    <thead>
      <tr>
        <th>文件名</th>
        <th>上传者</th>
        <th>上传时间</th>
        <th>类型</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      <!-- 动态填充 -->
    </tbody>
  </table>

  <!-- 分页 -->
  <div class="pagination">
    <!-- 分页按钮 -->
  </div>
</div>
```

### 步骤 3：添加样式（2小时）

- [ ] 表格样式（边框、背景色、悬停效果）
- [ ] 状态标签样式（待审=黄、通过=绿、驳回=红）
- [ ] 按钮样式（操作按钮组）
- [ ] 响应式设计

示例颜色：
```css
.status-pending { background: #ffc107; }  /* 黄色 */
.status-approved { background: #28a745; } /* 绿色 */
.status-rejected { background: #dc3545; } /* 红色 */
```

### 步骤 4：实现 JavaScript 交互（2小时）

- [ ] 加载待审文件列表
- [ ] 实现搜索和筛选
- [ ] 实现审核通过按钮（调用 API）
- [ ] 实现审核驳回按钮（弹出输入框要求填写原因）
- [ ] 实现分页

```javascript
async function loadAuditList() {
  const response = await fetch('/api/audit/list');
  const data = await response.json();
  renderTable(data.items);
}

async function approveAudit(fileId) {
  const response = await fetch('/api/audit/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId })
  });
  if (response.ok) {
    loadAuditList(); // 刷新列表
  }
}
```

### 步骤 5：后端 API 检查和修复（2小时）

确保后端 API 能够：
- [ ] 返回待审文件列表（带搜索、筛选、分页）
- [ ] 支持审核通过操作
- [ ] 支持审核驳回操作（记录驳回原因）
- [ ] 返回正确的数据格式

**需要的 API 响应格式**：
```json
{
  "items": [
    {
      "id": "file_001",
      "filename": "产品规划.pdf",
      "uploader": "user1",
      "uploadTime": "2026-08-15 10:00",
      "type": "pdf",
      "status": "pending"
    }
  ],
  "total": 25,
  "page": 1,
  "pageSize": 10
}
```

### 步骤 6：集成和测试（1小时）

- [ ] 访问审核中心页面
- [ ] 验证表格显示正确
- [ ] 测试搜索和筛选功能
- [ ] 测试审核操作
- [ ] 测试其他页面是否受影响
- [ ] `npm test` 全部通过

---

## 验收标准

✅ 审核中心有表格列表显示待审文件  
✅ 表格有搜索、筛选、排序功能  
✅ 表格有操作栏，可以进行审核操作  
✅ UI 美观，参考行业标准设计  
✅ 响应式设计（手机端也能用）  
✅ 所有操作都能正常执行  
✅ `npm test` 测试全部通过  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "refactor: 审核中心重新设计为表格列表"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况

---

## 参考资源

表格设计参考：
- Ant Design Table: https://ant.design/components/table/
- Bootstrap Table: https://getbootstrap.com/docs/5.0/content/tables/

---

## 依赖关系

- ✅ 任务 2 必须先完成（权限系统）
- 可与任务 4、5、6、7 并行进行