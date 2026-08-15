# 前端全面重构+统一 + 双口令部署 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 消除所有内联 `<style>` 和 CDN 引用，统一 Bootstrap 5.3 深色主题，实现双口令登录机制

**Architecture:**
- 🔟 前端重构：6 个含内联样式的页面统一抽到 `style.css` 或 `custom-theme.css`；3 个用 CDN 的页面改为本地引用；admin-capability 的 `<style>` 移入独立 CSS
- 1️⃣1️⃣ 双口令：访客口令（演示模式，写不落库）+ 调试口令（真实模式），在 `index.html` 登录页切换

**Tech Stack:** Bootstrap 5.3 + 本地 vendor 文件

**Spec:** `docs/差距分析与重构方案.md` 任务包🔟和1️⃣1️⃣

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `public/admin-capability.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/admin-compare.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/admin-config.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/admin-qa.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/admin.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/password-mgmt.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/admin-logs.html` | 修改 | CDN→本地 + 内联 `<style>` |
| `public/admin-model.html` | 修改 | CDN→本地 + 内联 `<style>` |
| `public/admin-users.html` | 修改 | CDN→本地 + 内联 `<style>` |
| `public/knowledge-quality.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/service-admin.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/service-chat.html` | 修改 | 内联 `<style>` → 移到独立 CSS |
| `public/index.html` | 修改 | 加双口令切换 |
| `public/css/custom-theme.css` | 追加 | 统一 admin 页面样式 |
| `public/css/style.css` | 追加 | 补充通用样式 |
| `routes/auth.js` | 修改 | 双口令验证 |
| `config.js` | 修改 | 双口令配置 |
| `server.js` | 修改 | 双口令模式 |

---

### 任务🔟: 前端全面重构

**现状：** 19 个页面中 11 个含内联 `<style>`，3 个用 CDN 而非本地 vendor

**做法：** 每个页面三步：
1. CDN → 本地 vendor（`/css/vendor/bootstrap.min.css` 和 `/js/vendor/bootstrap.bundle.min.js`）
2. 内联 `<style>` → 移到 `public/css/custom-theme.css` 或 `public/css/style.css`
3. 验证页面不崩

---

### 任务1️⃣1️⃣: 双口令

**做法：**
- `config.js` 新增 `guestPassword` 和 `debugPassword` 配置
- `routes/auth.js` 登录时判断口令类型
- `index.html` 登录页加双口令切换入口