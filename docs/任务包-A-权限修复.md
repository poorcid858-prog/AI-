# 任务包 A：权限修复

## 问题描述
系统管理员（admin）缺少审核权限，需要全面检查权限模型并修复。

## 当前问题
- `config.js` 中角色定义：admin 角色 `canWrite: true, canReview: false`
- 管理员应该拥有全部权限，包括审核
- 需要检查 `lib/auth.js` 中的权限判定逻辑，确保 admin 拥有 write + review + use 全部权限

## 修复范围
- `config.js` — 修改 admin 角色配置
- `lib/auth.js` — 检查权限判定函数
- `mock-data/users.json` — 确认用户角色配置正确

## 检查清单
- [ ] admin 角色 canReview 应为 true
- [ ] can(user, 'review') 返回正确
- [ ] requireReview 中间件放行 admin
- [ ] 验证其他角色权限是否正确（reviewer 不能 write，product 不能 review 等）
- [ ] 测试全部通过：`npm test`

## 验收标准
1. 管理员可以访问审核页面
2. 管理员可以执行审核操作（通过/驳回）
3. 其他角色权限不受影响
4. 所有测试通过