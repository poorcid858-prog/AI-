# 任务包 H：聊天页提问模板

## 问题描述
在AI助手聊天页面新增一个"提问模板"功能，用户可以直接点击预设的提问模板来快速提问。

## 产品设计

### 功能概述
- 用户在聊天页看到若干提问模板
- 点击模板可以直接填充到输入框或直接发送
- 模板可由管理员配置（见任务包G）

### UI设计

#### 聊天页新增提问模板区域
```
【AI助手聊天页面】

┌─────────────────────────────────────────┐
│ 聊天记录区域                              │
│                                         │
│ ....                                    │
│                                         │
└─────────────────────────────────────────┘

┌─ 提问模板区域 ─────────────────────────┐  <- 新增
│ 快速提问: [模板1] [模板2] [模板3] ...    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 输入框：[用户提问或选中的模板文本]          │
│ [清空] [发送]                            │
└─────────────────────────────────────────┘
```

### 提问模板的两种交互方式

#### 方式1：填充到输入框
- 用户点击模板 → 模板内容填充到输入框
- 用户可以进一步编辑内容
- 用户点击"发送"发送

#### 方式2：直接发送（可选）
- 用户点击模板 → 直接发送该模板的内容
- 不需要用户手动点击"发送"

**建议**：实现方式1为主，方式2为可选配置

### 模板的显示

**显示形式**：按钮或标签
```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ 生成一个PRD   │  │ 代码如何审查  │  │ 写个测试用例  │
└──────────────┘  └──────────────┘  └──────────────┘
```

**响应式设计**：
- 桌面：一行显示多个模板
- 手机：可能需要滚动或换行显示

### 模板的权限控制

根据用户角色显示不同的模板：
- 如果模板被配置为"产品"角色 → 只有产品经理看到
- 如果模板被配置为"前端"角色 → 只有前端工程师看到
- 如果模板被配置为"全部"角色 → 所有人都看到

## 实现步骤

### 第1阶段：前端开发

**HTML结构**：
```html
<div id="prompt-templates" class="prompt-templates-container">
  <div class="templates-label">快速提问:</div>
  <div class="templates-buttons">
    <!-- 动态填充 -->
  </div>
</div>
```

**JavaScript功能**：
1. **初始化** - 页面加载时，从API获取提问模板列表
2. **过滤** - 根据用户角色过滤显示哪些模板
3. **点击处理** - 点击模板时，填充内容到输入框
4. **样式** - 美化模板按钮

```javascript
// 伪代码
async function loadPromptTemplates() {
  const templates = await fetch('/api/prompt-templates?role=' + userRole);
  renderTemplateButtons(templates);
}

function onTemplateClick(templateContent) {
  document.getElementById('chat-input').value = templateContent;
  // 可选：自动发送
  // sendMessage();
}
```

**CSS样式**：
```css
.prompt-templates-container {
  margin-bottom: 15px;
  padding: 10px;
  background-color: #f5f5f5;
  border-radius: 4px;
}

.templates-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.template-btn {
  padding: 6px 12px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.template-btn:hover {
  background-color: #0056b3;
}
```

### 第2阶段：后端集成

**需要的API**：
```
GET /api/prompt-templates?role=product&enabled=true
```

**API应该返回**：
```json
{
  "templates": [
    {
      "id": 1,
      "name": "生成一个PRD",
      "content": "请你作为产品经理...",
      "role": "product",
      "priority": 1
    },
    ...
  ]
}
```

**后端检查清单**：
- [ ] 提问模板API存在
- [ ] API支持按角色筛选
- [ ] API支持过滤已启用的模板
- [ ] API返回格式正确

### 第3阶段：集成测试

- [ ] 聊天页能正常加载
- [ ] 模板按钮显示正确
- [ ] 点击模板能填充到输入框
- [ ] 不同角色的用户看到不同的模板
- [ ] 响应式设计在手机上也能用
- [ ] 输入框中已有内容时，点击模板会覆盖（可选提示）

## 工作量估计

| 任务 | 工作量 |
|------|--------|
| HTML和CSS | 1.5小时 |
| JavaScript | 2小时 |
| 后端API检查 | 1小时 |
| 测试 | 1.5小时 |
| **总计** | **6小时** |

## 验收标准

1. ✅ 聊天页显示提问模板区域
2. ✅ 模板按钮能正常显示
3. ✅ 点击模板能填充内容到输入框
4. ✅ 不同角色用户看到不同模板
5. ✅ 响应式设计正常工作
6. ✅ UI美观，与系统风格一致
7. ✅ 所有测试通过

## 相关依赖
- 任务包G：管理后台配置功能（需要提问模板的配置功能）
- 后端API：提问模板API（需要存在且正常工作）