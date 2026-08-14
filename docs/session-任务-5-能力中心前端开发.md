# Session 任务 5：能力中心前端开发

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟠 **高** |
| 工作量 | 10 小时 |
| 难度 | 高 |
| 依赖 | 任务 4（后端 API） |
| 类型 | 前端页面开发 |
| 相关文档 | `docs/任务包-D-能力中心.md` |

---

## 问题描述

能力中心前端页面不存在。需要创建一个完整的管理界面，支持配置 5 种能力（Workflow、Skill、Reference、Script、Tool）。

---

## 页面结构

```
能力中心
├── 左侧菜单（导航）
│   ├── Workflow
│   ├── Skill
│   ├── Reference
│   ├── Script
│   └── Tool
├── 中间区域（列表）
│   ├── 搜索框
│   ├── 能力列表（表格）
│   └── 分页
└── 右侧区域（编辑）
    ├── 能力详情
    ├── 编辑表单
    └── 保存/删除按钮
```

---

## 需要做什么

### 步骤 1：创建基础 HTML 页面（2小时）

创建 `public/capability.html`，结构包括：
- 左侧菜单
- 中间列表区域
- 右侧详情区域

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>能力中心</title>
  <link rel="stylesheet" href="css/capability.css">
</head>
<body>
  <div class="capability-container">
    <!-- 左侧菜单 -->
    <div class="sidebar">
      <h2>能力中心</h2>
      <ul class="menu">
        <li><a href="#" data-type="workflow">Workflow</a></li>
        <li><a href="#" data-type="skill">Skill</a></li>
        <li><a href="#" data-type="reference">Reference</a></li>
        <li><a href="#" data-type="script">Script</a></li>
        <li><a href="#" data-type="tool">Tool</a></li>
      </ul>
    </div>

    <!-- 中间区域 -->
    <div class="content">
      <div class="list-area">
        <input type="text" id="search" placeholder="搜索...">
        <table id="capability-list">
          <!-- 动态填充 -->
        </table>
        <div class="pagination">
          <!-- 分页 -->
        </div>
      </div>

      <!-- 右侧区域 -->
      <div class="detail-area">
        <div id="detail-content">
          <!-- 动态显示详情和编辑表单 -->
        </div>
      </div>
    </div>
  </div>

  <script src="js/capability.js"></script>
</body>
</html>
```

### 步骤 2：实现 JavaScript 交互（5小时）

在 `public/js/capability.js` 中实现核心功能：

```javascript
// 全局变量
let currentType = 'workflow';
let currentPage = 1;

// 1. 加载能力列表
async function loadCapabilities(type, page = 1) {
  const response = await fetch(`/api/capability/list?type=${type}&page=${page}`);
  const data = await response.json();
  renderList(data.items);
  renderPagination(data.total, data.page, data.pageSize);
}

// 2. 左侧菜单切换
document.querySelectorAll('.menu a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    currentType = e.target.dataset.type;
    currentPage = 1;
    loadCapabilities(currentType);
  });
});

// 3. 表格渲染
function renderList(items) {
  const tbody = document.querySelector('#capability-list tbody');
  tbody.innerHTML = items.map(item => `
    <tr onclick="showDetail(${item.id})">
      <td>${item.name}</td>
      <td>${item.description || '-'}</td>
      <td>${item.created_at}</td>
      <td><span class="status-${item.is_active ? 'active' : 'inactive'}">${item.is_active ? '启用' : '禁用'}</span></td>
    </tr>
  `).join('');
}

// 4. 显示详情
async function showDetail(id) {
  const response = await fetch(`/api/capability/${id}`);
  const data = response.json();
  renderDetail(data);
}

// 5. 编辑和保存
async function saveCapability(id, formData) {
  const response = await fetch(`/api/capability/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });
  if (response.ok) {
    loadCapabilities(currentType);
  }
}

// 6. 删除
async function deleteCapability(id) {
  if (confirm('确定删除吗？')) {
    await fetch(`/api/capability/${id}`, { method: 'DELETE' });
    loadCapabilities(currentType);
  }
}

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  loadCapabilities(currentType);
});
```

### 步骤 3：添加样式（2小时）

创建 `public/css/capability.css`，包括：
- 布局样式
- 菜单样式
- 表格样式
- 表单样式
- 响应式设计

```css
.capability-container {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  background: #f5f5f5;
  padding: 20px;
  border-right: 1px solid #ddd;
}

.content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.list-area {
  width: 50%;
  padding: 20px;
  border-right: 1px solid #ddd;
  overflow-y: auto;
}

.detail-area {
  width: 50%;
  padding: 20px;
  overflow-y: auto;
}

.menu {
  list-style: none;
  padding: 0;
}

.menu li {
  margin: 10px 0;
}

.menu a {
  display: block;
  padding: 8px 12px;
  color: #333;
  text-decoration: none;
  border-radius: 4px;
  cursor: pointer;
}

.menu a:hover,
.menu a.active {
  background: #007bff;
  color: white;
}

#capability-list {
  width: 100%;
  border-collapse: collapse;
}

#capability-list th,
#capability-list td {
  padding: 12px;
  border: 1px solid #ddd;
  text-align: left;
}

#capability-list th {
  background: #f5f5f5;
  font-weight: bold;
}

#capability-list tr:hover {
  background: #f9f9f9;
  cursor: pointer;
}
```

### 步骤 4：集成测试（1小时）

- [ ] 点击菜单，不同的能力类型显示不同的列表
- [ ] 搜索功能正常
- [ ] 创建、编辑、删除能力都能工作
- [ ] 分页正常
- [ ] 响应式设计在不同屏幕大小都能用

---

## 验收标准

✅ 能力中心页面可以访问  
✅ 五个菜单都能正常显示  
✅ 能够创建、编辑、删除各种能力  
✅ 能力列表能够搜索、筛选、分页  
✅ 能力配置能够保存  
✅ UI 美观，符合系统设计风格  
✅ 响应式设计正常工作  
✅ 所有功能都能正常执行  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 能力中心前端页面开发"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况
- [ ] 进行集成测试（与任务 4 的后端集成）

---

## 与任务 4 的配合

这个任务依赖任务 4 的这些 API：
- `GET /api/capability/list?type={type}&page={page}`
- `GET /api/capability/:id`
- `POST /api/capability/create`
- `PUT /api/capability/:id`
- `DELETE /api/capability/:id`

如果 API 还没完成，可以先用 mock 数据进行开发。

---

## 依赖关系

- ✅ 任务 4 需要先完成（或并行开发）
- 🔄 可与其他任务并行进行