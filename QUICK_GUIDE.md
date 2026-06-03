# 优化工作快速指南

## 核心改动总结

| 优化项 | 文件 | 改动行数 | 工作量 | 预期收益 |
|-------|------|---------|--------|---------|
| **H2** | server/index.js | 335-346 | 10min | 5x 快 (统计端点) |
| **H4** | server/auth.js + server/index.js | auth.js: 新增函数; index.js: L33,173 | 15min | 防内存泄漏 |
| **H1** | server/db.js | 233-236 | 10min | 100x 快 (日志清理) |
| **M2** | server/db.js | 79-83 | 5min | 30% 性能提升 |
| **M1** | server/middleware.js + server/index.js | 新增中间件 + 挂载点 | 25min | 防 DoS |
| **M3** | server/index.js | 115 前 | 5min | Kubernetes 兼容 |
| **M4** | server/index.js | 40-44 + 多处调用 | 15min | 可观测性 |

**总工作量**: ~85 min | **总测试**: ~30 min

---

## 快速修改指南

### 步骤 1: H2 (最快 ⚡)
编辑 `server/index.js` 第 335-346 行
- 原: 5 个独立 SELECT COUNT
- 新: 1 个 SELECT 配合 SUM(CASE WHEN...)
- 验证: `curl http://localhost:3000/api/orders/stats` (应该快很多)

### 步骤 2: H4 (防内存泄漏)
编辑 `server/auth.js`:
1. 新增 `getInviteFailure()` 函数
2. 新增 `cleanupAttempts()` 定时器
3. 编辑 `server/index.js` L33 导入新函数
4. 编辑 `server/index.js` L173 改用 `getInviteFailure(ip)`

### 步骤 3: M2 (索引优化)
编辑 `server/db.js` 第 79-83 行
- 追加 4 行 CREATE INDEX
- 无需改业务逻辑

### 步骤 4: H1 (日志清理)
编辑 `server/db.js` 第 233-236 行
- 原: NOT IN 子查询
- 新: 先找 threshold id，再 DELETE WHERE id <
- 加上 try-catch

### 步骤 5: M1 (速率限制)
1. 编辑 `server/middleware.js`: 新增 `rateLimitMiddleware()`
2. 编辑 `server/index.js` L33: 导入新函数
3. 编辑 `server/index.js` L100 后: 挂载中间件到各 API

### 步骤 6: M3 (健康检查)
编辑 `server/index.js` L115 前
- 新增 GET /health 端点

### 步骤 7: M4 (错误统一)
编辑 `server/index.js` L40-44
- 改 `sendServerError` 签名
- 加 errorCode + requestId
- 改全部调用处

---

## 测试快速路径

```bash
cd /c/Users/Administrator/luggage-tag

# 1. 代码检查
npm run lint

# 2. 启动
npm run dev &
sleep 3

# 3. 关键功能测试
# 统计端点 (H2)
curl -H "Cookie: session=your_token" http://localhost:3000/api/orders/stats

# 健康检查 (M3)
curl http://localhost:3000/health

# 速率限制 (M1) - 快速发 25 次
for i in {1..25}; do curl -X POST http://localhost:3000/api/orders/imposition -d '{}' 2>/dev/null; done
# 第 21-25 应返回 429

# 4. 仪表板完整流程
# - 登录 → 查看统计 (应 < 500ms)
# - 创建订单 → 分页查看 (应能翻页)
```

---

## 高风险项标记

### M4 需要特别关注
改 `sendServerError` 后，需要改**全部调用处**:
- server/index.js L352: /api/layout/preview
- server/index.js L368: /api/orders/imposition
- server/index.js L381: /api/orders/a4-layout
- 其他 catch 块

**验收**: console.error 输出应是 JSON（不是纯文本）

### H4 需要验证 cleanup
登录失败 → 锁定 60 秒 → 查看 Map 大小是否清理
**验收**: 运行 2 小时后 Map.size 应 < 50

---

## 部署检查清单

✅ 前置: `npm run lint` 通过
✅ 前置: 服务启动无错误
✅ H2: 仪表板统计数据正确 + 快
✅ H4: 登录锁定后能正常解除
✅ H1: 审计日志数量 ≤ 5000 上限
✅ M2: 订单列表翻页速度 < 50ms
✅ M1: 超限 API 返回 429
✅ M3: /health 返回 200
✅ M4: 错误响应包含 errorCode + requestId

**全部绿灯 → 可合并 / 部署**
