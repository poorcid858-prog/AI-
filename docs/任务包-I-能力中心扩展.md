# 任务包 I：能力中心扩展（5菜单完整实现）

## PM 要求（来自问题3）
能力中心中有各种菜单包含：
- **workflow** — 步骤编排（从0配置AI助手能力的工作流式配置）
- **skill** — 角色设定、任务指令、输出格式、边界约束
- **reference** — 挂载参考资料（行业模板、规范文档）
- **script/tool** — 输出后处理（格式校验、字段补全）
- **prompt** — 模板可编辑 + 版本 + 试跑对比 + 一键回滚

## 核心需求
用户可以从0开始配置一个AI助手的能力，从workflow一路配置下去，配置好以后AI助手就多一个能力。

## 当前状态
- 需求5已完成基础能力中心（capability-engine.js + routes/capability.js + admin-capability.html）
- 草稿/试跑/对比/发布/回滚/审计 已实现
- 五种能力类型可能已定义但未完整实现

## 修复范围
- `lib/capability-engine.js` — 5种能力类型（workflow/skill/reference/script/tool）的完整数据模型 + 增删改查 + 配置链路
- `routes/capability.js` — API支持5种能力类型
- `public/admin-capability.html` — 完整UI，5个菜单Tab，配置链路可视化
- `server.js` — 确认路由已注册

## 验收标准
1. 能力中心有5个菜单Tab（workflow/skill/reference/script/tool）
2. 每个菜单都可以配置对应的能力
3. 支持从0开始配置能力：workflow → skill → reference → script/tool → prompt
4. 配置完成后，AI助手就多一个能力
5. 已有功能（草稿/试跑/对比/发布/回滚/审计）适用于所有5种能力类型