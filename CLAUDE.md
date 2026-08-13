# ai-assistant 项目约定

## 并行任务工作模式（2026-08-13 起）

本项目支持**多个 session 并行推进**。每个 session 认领一个任务包，独立执行。

**每个 session 启动时必须做的 3 件事：**
1. 读 `docs/并行任务入口.md`（项目全景 + 任务分配）
2. 按 `~/.claude/projects/d--temp/memory/work-initialization-checklist.md` 执行工作启动清单
3. 调用相应的 superpowers skill（TDD/调试/计划/验证等）

**文件所有权约定：**
- 每个任务包只能修改自己的文件（任务包文档里写明）
- `server.js` 路由注册行：任务包 C 可追加自己的行，但只加不删，改动后立即记录到进展.md
- 进展.md 每条记录加 `[任务包名称]` 前缀标识来源
- **写进展.md 前必须先 Read 最新状态**（Edit 需要基于当前文件），若发现别人的记录已插入，则在其上方插入自己的，不覆盖