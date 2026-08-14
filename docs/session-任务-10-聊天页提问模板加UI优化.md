# Session 任务 10：聊天页提问模板 + UI 优化

## 快速信息卡

| 字段 | 内容 |
|------|------|
| 优先级 | 🟡 **中** |
| 工作量 | 33 小时 |
| 难度 | 低～中 |
| 依赖 | 任务 9（提问模板配置） |
| 类型 | 前端开发 + 样式优化 |
| 相关文档 | `docs/任务包-H-聊天页提问模板.md` + `docs/任务包-I-UI优化.md` |

---

## 问题描述

这是最后一个任务包，包括两部分：

### 部分 A：聊天页提问模板（6小时）
在聊天页面添加提问模板功能，用户可以点击模板快速提问。

### 部分 B：UI 优化（27小时）
引入 Bootstrap 5，统一整个系统的 UI 风格，让系统看起来专业。

由于这两部分都是前端工作，可以一起做，总工作量约 33 小时。

---

## 部分 A：聊天页提问模板（6小时）

### 需要做什么

1. **在聊天页添加模板区域（1小时）**
   ```html
   <div class="prompt-templates">
     <span>快速提问:</span>
     <div id="templates-container">
       <!-- 从 API 加载模板 -->
     </div>
   </div>
   ```

2. **从 API 加载模板（1小时）**
   ```javascript
   async function loadPromptTemplates() {
     const response = await fetch('/api/admin/prompt-templates');
     const templates = response.json();
     renderTemplates(templates);
   }
   ```

3. **实现模板交互（2小时）**
   - 点击模板 → 填充到输入框
   - 根据用户角色过滤模板
   - 样式美化

4. **测试（2小时）**
   - 各个模板都能点击
   - 内容填充正确
   - 不同角色看到不同模板

---

## 部分 B：UI 优化（27小时）

### 总体方案

**引入 Bootstrap 5**，统一系统的 UI 风格。

### 实施步骤

1. **引入 Bootstrap 5（1小时）**
   ```html
   <!-- 在 HTML 中添加 Bootstrap CSS 和 JS -->
   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
   <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
   ```

2. **创建自定义主题（2小时）**
   - 定义颜色方案
   - 定义字体
   - 定义间距
   - 保存到 `public/css/custom-theme.css`

3. **页面改造（20小时）**
   按优先级改造所有页面：
   
   **优先级 1（6小时）**：
   - 登录页
   - 聊天页
   - 知识库页
   
   **优先级 2（8小时）**：
   - 管理后台
   - 审核中心
   - 能力中心
   
   **优先级 3（6小时）**：
   - 运营中心
   - 其他页面

4. **测试和优化（4小时）**
   - 跨浏览器测试
   - 响应式设计测试
   - 性能优化

---

## 颜色方案

```css
:root {
  --primary: #007bff;     /* 蓝色 */
  --secondary: #6c757d;   /* 灰色 */
  --success: #28a745;     /* 绿色 */
  --danger: #dc3545;      /* 红色 */
  --warning: #ffc107;     /* 黄色 */
  --info: #17a2b8;        /* 青色 */
  --light: #f8f9fa;       /* 浅灰 */
  --dark: #343a40;        /* 深灰 */
}
```

---

## 验收标准

**部分 A**：
✅ 聊天页显示提问模板  
✅ 点击模板能填充到输入框  
✅ 不同角色看到不同模板  

**部分 B**：
✅ Bootstrap 5 成功引入  
✅ 所有页面颜色统一  
✅ 字体和排版规范  
✅ 按钮、表单、表格等组件样式统一  
✅ 响应式设计正常工作  
✅ 所有功能仍然正常运作  
✅ 系统看起来专业、美观  

---

## 完成后

- [ ] 本地测试通过
- [ ] 提交代码：`git add -A && git commit -m "feat: 聊天页提问模板 + UI优化（Bootstrap5）"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 在 `进展.md` 记录完成情况

---

## 重要提示

- ⚠️ UI 改造要逐步进行，每个页面改好后都要测试
- ⚠️ 不要改动业务逻辑，只改样式
- ⚠️ 保持现有的代码结构，只是增加 Bootstrap 类名
- ⚠️ 如果遇到 Bootstrap 与现有样式冲突，用 CSS 优先级解决

---

## 参考资源

- Bootstrap 5: https://getbootstrap.com/docs/5.0/
- 自定义主题: https://getbootstrap.com/docs/5.0/customize/overview/

---

## 依赖关系

- ✅ 任务 9 需要先完成（提问模板配置）
- 🔄 可与其他任务并行进行（独立前端任务）
- ✅ 所有其他功能任务完成后，这个最后做效果最好

---

## 总结

这 10 个 session 任务覆盖了用户提出的所有 9 条建议。完成这 10 个任务后，系统就有了：

1. ✅ 完整的权限系统
2. ✅ 能力中心（可配置 AI 能力）
3. ✅ 知识库四层架构（可追踪知识来源）
4. ✅ 运营中心（可分析 AI 质量）
5. ✅ 管理后台配置（可配置系统参数）
6. ✅ 审核中心（表格式设计）
7. ✅ 聊天页提问模板（快速提问）
8. ✅ 专业的 UI 设计（Bootstrap5）

预计总工作量：约 130 小时（按 40 小时/周，约 3-4 周）
人员建议：4 人团队，2-3 周完成所有任务