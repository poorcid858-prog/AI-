# 任务包 C：CronCreate 定时任务自动触发

> **状态**：⬜ 待认领
> **难度**：中等
> **预计时长**：30 分钟
> **使用 skill**：`superpowers:test-driven-development`

## 任务描述

将现有的报告 API（需求 2）与 CronCreate 集成，实现定时任务自动触发：
- 每天 23:00 自动生成日汇总报告
- 会话结束时自动生成会话报告

## 背景

报告引擎（`lib/reports.js`）和报告 API（`routes/reports.js`）已实现，但目前只有手动触发方式。需要集成 CronCreate 实现自动触发。

## 需求详情

### 功能 1：定时日报告
- 每天 23:00 自动触发
- 读取当天的所有会话记录
- 调用 `generateDailyReport()` 并保存
- 在进展.md 记录

### 功能 2：会话报告自动触发
- 每次聊天完成时自动生成
- 从 `qa-history.json` 读取会话数据
- 调用 `generateSessionReport()` 并保存

## 实现方案

### 步骤 1：创建定时任务模块
- `lib/scheduler.js` 或直接集成到 `server.js`
- 使用 `CronCreate` 工具（Node.js 原生定时器）

### 步骤 2：注册定时任务
- 在 `server.js` 启动时注册
- 每天 23:00 触发

### 步骤 3：测试
- 测试定时任务是否正确注册
- 测试任务触发时数据是否正确生成

## 涉及文件

- **改**：`server.js` — 注册定时任务
- **改**：`lib/reports.js` — 添加定时触发的钩子函数
- **改**：`routes/chat.js` — 聊天结束时触发报告生成
- **新**：`test/scheduler.test.js` — 定时任务测试

## 验收标准

- [ ] 每天 23:00 自动生成日报告
- [ ] 会话结束时自动生成会话报告
- [ ] 报告文件保存在 `data/reports/` 目录
- [ ] 不影响现有测试（全部通过）

## 注意事项

- CronCreate 的 recurring 任务 7 天自动过期，需告知 PM
- 测试时不要真的等到 23:00，可以用短间隔测试

## 任务完成标记

```markdown
[任务包 C] CronCreate 定时任务
- 日报告自动触发：✅/❌
- 会话报告自动触发：✅/❌
- 测试全部通过：xxx/xxx
```