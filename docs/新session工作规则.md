# 新 Session 工作规则

## 必读文档顺序

每个新 session 启动时，必须按这个顺序读：

1. **本文件** - `docs/新session工作规则.md`（你正在读）
2. **任务文件** - 根据分配的任务号读对应的 `docs/session-任务-X.md`
3. **背景资料** - `docs/需求汇总-2026-08-15.md`
4. **部署信息** - `~/.claude/projects/d--temp/memory/cloud-server-deployment.md`
5. **项目约定** - `d:/temp/CLAUDE.md`

---

## 必须使用 Superpowers 插件

开始实际工作前，根据任务类型调用对应的 superpowers 插件：

| 任务类型 | 调用插件 |
|---------|---------|
| 页面重新设计、新功能设计 | `/superpowers:brainstorming` |
| 修复 Bug、测试相关 | `/superpowers:systematic-debugging` 或 `/superpowers:test-driven-development` |
| 多文件修改、实现计划 | `/superpowers:writing-plans` |
| 代码审查反馈 | `/superpowers:receiving-code-review` |
| 功能完成后验证 | `/superpowers:verification-before-completion` |

**规则**：
- ❌ 不能跳过 superpowers
- ❌ 不能调用后直接写代码，要等待用户批准
- ✅ 遵循 superpowers 工作流，分步骤完成

---

## 工作流程

### 1. 初始化（5分钟）
- [ ] 读完上面的"必读文档"
- [ ] 理解任务的完整背景
- [ ] 确认依赖任务是否完成

### 2. Superpowers 设计阶段（15-30分钟）
- [ ] 调用对应的 superpowers 插件
- [ ] 按插件要求做设计或规划
- [ ] 得到用户批准

### 3. 实现阶段（主要工作）
- [ ] 使用 TodoWrite 创建任务清单
- [ ] 逐步实现
- [ ] 边做边测试

### 4. 验证阶段（测试）
- [ ] 本地测试通过（`npm test`）
- [ ] 手动验证功能
- [ ] 可选：调用 `/superpowers:verification-before-completion` 做最后验证

### 5. 交接阶段（完成）
- [ ] 提交代码：`git add -A && git commit -m "feat: 任务说明"`
- [ ] 推送到 GitHub：`git push origin master`
- [ ] 更新 `进展.md` 记录完成情况
- [ ] 告知 PM 任务已完成

---

## 代码提交规范

提交时使用这个格式：
```bash
git commit -m "feat: 简短描述任务完成了什么"
# 比如
git commit -m "feat: 知识库页面修复（路由配置）"
git commit -m "feat: 审核中心重新设计为表格列表"
```

---

## 进展记录规范

任务完成后，更新 `d:\temp\进展.md`：

```markdown
## 2026-08-15（电脑端/微信端）
- [任务3完成] ✅ 审核中心重新设计
  - 实现了表格列表显示
  - 添加了搜索、筛选、分页功能
  - 实现了审核操作（通过、驳回）
  - UI 符合行业规范
  - 所有测试通过
```

---

## 常见问题

### Q: 为什么一定要用 superpowers？
A: superpowers 确保设计被用户批准后再编码，避免做反复修改。大功能必须先设计再实现。

### Q: 任务互相有依赖，应该怎么办？
A: 查看 `session-任务-X.md` 中的"依赖关系"部分。如果依赖任务没完成，等待或协调其他 session。

### Q: 如果发现现有代码有问题怎么办？
A: 
1. 优先完成分配的任务
2. 如果问题影响任务，先修复问题再继续
3. 在 `进展.md` 记录发现的问题

### Q: 可以并行工作吗？
A: 可以，但要注意：
- 不能同时修改同一个文件（git 冲突）
- 互相有依赖的任务（比如任务4和5）要协调顺序
- 最多 10 个 session 并行（任务1-10一一对应）

---

## 工作量和时间参考

| 工作量 | 预计时间 |
|--------|---------|
| 2h | 1 个 session（约 1 小时工作） |
| 6-12h | 1-2 个 session（约 2-4 小时） |
| 24-27h | 2-3 个 session（约 6-8 小时） |

**重要**：以上是估算。实际时间因人而异。

---

## 云服务器部署

完成本 session 任务后，代码会：
1. Push 到 GitHub
2. 新 session 会 pull GitHub 的代码
3. 最后由某个 session 部署到云服务器（IP: 124.223.99.237）

详细部署流程见：`~/.claude/projects/d--temp/memory/cloud-server-deployment.md`

---

## 问题排查

如果遇到问题：

1. **找不到文件** → 检查路径，可能是大小写或路径错误
2. **API 无法调用** → 检查后端是否启动，查看 `server.log`
3. **依赖问题** → 查看任务的"依赖关系"，确认前置任务完成
4. **权限问题** → 可能需要等待任务2（权限补全）完成
5. **数据库问题** → 查看迁移脚本是否执行，数据是否迁移成功

---

## 成功的 Session 应该是这样的

✅ 读完规则文档  
✅ 读完任务文件  
✅ 调用 superpowers 做设计/规划  
✅ 得到用户批准  
✅ 实现功能  
✅ 充分测试  
✅ 提交代码  
✅ 更新进展记录  
✅ 告知 PM 完成  

---

## 快速链接

- 任务清单：`docs/任务总览-2026-08-15.md`
- 需求汇总：`docs/需求汇总-2026-08-15.md`
- 任务1：`docs/session-任务-1-知识库页面修复.md`
- 任务2：`docs/session-任务-2-系统管理员权限补全.md`
- 任务3：`docs/session-任务-3-审核中心重新设计.md`
- ... 以此类推到任务10

---

## 最后提醒

- 这 10 个 session 会并行工作，预计 2-3 周完成所有任务
- 每个 session 应该专注在自己的任务上
- 如果任务卡住或有疑问，及时记录在 `进展.md` 里
- PM 会根据 `进展.md` 了解进度