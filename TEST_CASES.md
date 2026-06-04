# 测试用例集

## 前置条件
- 服务已启动: `npm run dev`
- 可用 token (从登录端点获取或使用测试 token)
- SQLite 数据库可访问

---

## TC-SILENT-01: 客户页静默直打

### 场景
验证客户点击【打印】不会进入浏览器打印页，而是由后台本地打印服务创建订单并发送打印机。

### 步骤
1. 后台配置实体打印机，或确保系统默认打印机是实体打印机。
2. 进入定制页，选择颜色并输入英文姓名。
3. 点击【打印】。
4. 观察浏览器是否出现打印窗口或跳转 `/ticket`。
5. 后台订单列表检查新订单状态。

### 验收
- 页面不调用浏览器打印窗口，不显示打印预览。
- 网络请求为 `POST /api/orders/direct-print`。
- 成功响应包含 `ok: true`、`orderNo`、`printerName`、`printStatus: "printed"`。
- 页面短暂显示打印成功和编号后自动清空姓名并聚焦输入框。
- 后台订单状态为已打印。
- 端到端前台闭环在本地打印服务和打印机驱动正常响应时目标不超过 3 秒。

---

## TC-SILENT-02: 静默打印失败可追溯

### 场景
验证打印机不可用时订单仍被保存，工作人员可以从后台重打。

### 步骤
1. 后台选择不存在或不可用的打印机，或断开实体打印机。
2. 定制页输入英文姓名并点击【打印】。
3. 记录页面返回的订单编号。
4. 恢复打印机后进入后台订单列表。
5. 点击该订单【打印】重新发送。

### 验收
- 客户页不跳转浏览器打印页。
- 失败响应包含 `ok: false`、`id`、`orderNo`、`printStatus: "pending"`。
- 后台可按编号找到订单。
- 后台重打成功后订单状态变为已打印。

---

## TC-SILENT-03: 回收站订单禁止重打

### 场景
验证软删除订单不会被 API 直接发送到打印机，避免恢复后状态不一致。

### 步骤
1. 后台删除一个订单，使其进入回收站。
2. 直接调用 `POST /api/orders/:id/print`。
3. 恢复该订单并查看打印状态。

### 验收
- 接口返回 409。
- 订单不会发送到打印机。
- 订单恢复后打印状态保持删除前状态。

---

## TC-H2-01: 统计查询合并 (响应时间)

### 场景
确保 /api/orders/stats 只执行 1 个数据库查询

### 步骤
1. 启动 Node 服务，启用数据库日志
2. 调用 5 次 /api/orders/stats
3. 检查网络面板 → 应该看到 5 个请求
4. 检查数据库日志 → 应该看到 5 个查询（非 25 个）

### 验收
```bash
curl -s -H "Cookie: session=TOKEN" http://localhost:3000/api/orders/stats | jq '.'
# 输出应包含: { "total": X, "printed": Y, "pending": Z, "deleted": W, "today": V }
# 响应时间 < 200ms
```

---

## TC-H4-01: 登录失败 Map 清理

### 场景
验证登录失败计数在超时后被清理

### 步骤
1. 添加 console.log 到 auth.js 的 cleanupAttempts()
2. 启动服务
3. 尝试 10 次错误登录（同一 IP）
4. 观察 loginFailures Map 大小
5. 等待 60 秒（cleanup 间隔）
6. 再次观察 Map 大小

### 验收
```javascript
// 修改 server/auth.js cleanupAttempts() 添加:
console.log(`[CLEANUP] loginFailures.size = ${loginFailures.size}, inviteFailures.size = ${inviteFailures.size}`);

// 预期输出（60秒后）:
// [CLEANUP] loginFailures.size = 0, inviteFailures.size = 0
```

---

## TC-H4-02: 邀请码失败清理

### 场景
验证邀请码失败计数也被清理

### 步骤
1. 快速发送 15 次错误邀请码请求
2. 第 5 次后应被锁定 (loginMaxFailures = 5)
3. 等待 60 秒
4. 验证能正常请求

### 验收
```bash
# 错误邀请码 15 次
for i in {1..15}; do
  curl -s -X POST http://localhost:3000/api/auth/invite \
    -H "Content-Type: application/json" \
    -d '{"inviteCode":"wrong"}' | jq '.message'
done

# 第 1-4 返回 "邀请码无效"
# 第 5-15 返回 "尝试次数过多，请 X 秒后重试"
# 60 秒后应能再请求
```

---

## TC-M2-01: 索引创建

### 场景
验证所有 8 个索引都被创建

### 步骤
```sql
SELECT name, tbl_name FROM sqlite_master 
WHERE type='index' AND tbl_name IN ('orders', 'events', 'users', 'auth_tokens');
```

### 验收
应包含:
- idx_orders_event_id
- idx_orders_created_by
- idx_orders_deleted_at
- idx_orders_deleted_print
- idx_orders_deleted_date
- idx_auth_tokens_user_id
- idx_events_id
- idx_users_id

```bash
sqlite3 luggage_tag.db "SELECT COUNT(*) as index_count FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';"
# 输出应为: 8
```

---

## TC-H1-01: 审计日志清理

### 场景
验证审计日志数量保持在 5000 以内

### 步骤
1. 创建大量订单或执行操作生成审计日志
2. 等待清理定时器执行（auditCleanupIntervalMs，默认 10 min）
3. 查询日志数量

### 验收
```bash
# 查询日志数
sqlite3 luggage_tag.db "SELECT COUNT(*) FROM audit_logs;"
# 输出应 <= 5000

# 查看最新日志
sqlite3 luggage_tag.db "SELECT id, action, created_at FROM audit_logs ORDER BY id DESC LIMIT 3;"
# 应显示最新的日志
```

---

## TC-M1-01: 速率限制 - 正常请求

### 场景
验证限制内的请求能通过

### 步骤
```bash
# 快速发送 20 个 POST /api/orders/imposition (限制 20/min)
for i in {1..20}; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/orders/imposition \
    -H "Content-Type: application/json" \
    -d '{"orderIds":[]}')
  echo "Request $i: HTTP $HTTP_CODE"
done
```

### 验收
```
Request 1-20: HTTP 400  (或其他非 429 的错误码，因为 orderIds 为空)
# 关键是前 20 个不应返回 429
```

---

## TC-M1-02: 速率限制 - 超限请求

### 场景
验证超限请求返回 429

### 步骤
```bash
# 快速发送 25 个请求
for i in {1..25}; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/orders/imposition \
    -H "Content-Type: application/json" \
    -d '{"orderIds":[]}')
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | head -n -1)
  if [ "$HTTP_CODE" = "429" ]; then
    echo "Request $i: HTTP 429 (LIMITED)"
    echo "  Message: $(echo $BODY | jq '.message')"
    echo "  Retry-After: $(echo $BODY | jq '.retryAfter')"
  else
    echo "Request $i: HTTP $HTTP_CODE (ALLOWED)"
  fi
done
```

### 验收
```
Request 1-20: HTTP 400 (ALLOWED)
Request 21-25: HTTP 429 (LIMITED)
Response headers 包含 X-RateLimit-Limit: 20, X-RateLimit-Remaining: 0
Response body 包含 Retry-After: X
```

---

## TC-M3-01: 健康检查

### 场景
验证 /health 端点工作

### 步骤
```bash
curl -s http://localhost:3000/health | jq '.'
```

### 验收
```json
{
  "status": "ok",
  "uptime": 123456,
  "timestamp": "2026-06-03T10:30:00Z"
}
```

---

## TC-M3-02: 健康检查 - 数据库异常

### 场景
验证数据库异常时返回 503

### 步骤
1. 临时中止数据库服务 (或移除数据库文件)
2. 调用 /health
3. 恢复数据库

### 验收
```bash
curl -s -w "\nHTTP %{http_code}\n" http://localhost:3000/health | jq '.'

# 输出应为:
# {
#   "status": "unhealthy",
#   "error": "...",
#   "uptime": 123
# }
# HTTP 503
```

---

## TC-M4-01: 错误响应格式

### 场景
验证错误响应包含 errorCode + requestId

### 步骤
```bash
# 触发 400 错误 (无效的 orderIds)
curl -s -X POST http://localhost:3000/api/orders/imposition \
  -H "Content-Type: application/json" \
  -d '{}' | jq '.'

# 检查 console.error 输出
# 应该看到结构化 JSON，例如:
# {"timestamp":"...","requestId":"abc123","errorCode":"...","statusCode":400,"message":"..."}
```

### 验收
```bash
# 响应包含:
{
  "errorCode": "...",
  "message": "...",
  "requestId": "..."
}

# console.error 包含:
# {"timestamp":"...","requestId":"...","errorCode":"...","statusCode":...,"message":"..."}
```

---

## TC-M4-02: 生产环境隐藏堆栈

### 场景
验证生产环境不泄露堆栈

### 步骤
1. 设置 NODE_ENV=production
2. 重启服务
3. 触发错误

### 验收
```bash
# 在生产环境:
NODE_ENV=production npm run dev &

# 触发错误后:
# console.error 应 NOT 包含 "stack" 字段
# 仅包含: timestamp, requestId, errorCode, statusCode, message
```

---

## TC-通用-01: 无回归

### 场景
验证优化没有破坏现有功能

### 步骤
1. **登录流程**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"admin","password":"admin123"}' | jq '.'
   ```
   应返回有效 session cookie

2. **创建订单**
   ```bash
   curl -X POST http://localhost:3000/api/orders \
     -H "Cookie: session=TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"templateId":"...","customerText":"TEST","pngDataUrl":"..."}' | jq '.'
   ```
   应返回 201 + order id

3. **查询订单**
   ```bash
   curl -H "Cookie: session=TOKEN" \
     "http://localhost:3000/api/orders?page=1&pageSize=20" | jq '.'
   ```
   应返回 orders 数组

4. **打印配置**
   ```bash
   curl -H "Cookie: session=TOKEN" \
     http://localhost:3000/api/printers | jq '.'
   ```
   应返回 printers 数组

### 验收
所有请求返回 200 且数据格式正确

---

## 快速验收脚本

```bash
#!/bin/bash
# 运行 5 个关键测试

echo "1. 统计查询 (H2)"
curl -s http://localhost:3000/api/orders/stats | jq '.total' || echo "FAIL"

echo "2. 健康检查 (M3)"
curl -s http://localhost:3000/health | jq '.status' || echo "FAIL"

echo "3. 速率限制 (M1)"
for i in {1..22}; do curl -s -X POST http://localhost:3000/api/orders/imposition -d '{}' -w "(%{http_code})" 2>/dev/null; done | grep -c "429" || echo "FAIL"

echo "4. 数据库索引 (M2)"
sqlite3 luggage_tag.db "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%';" || echo "FAIL"

echo "5. 审计日志 (H1)"
sqlite3 luggage_tag.db "SELECT COUNT(*) FROM audit_logs;" || echo "FAIL"

echo "✓ 所有关键点已检查"
```

---

## 故障排查

### 问题: /api/orders/stats 仍然很慢
**检查**:
- 确认代码已改为 SUM(CASE) 而非 5 个 COUNT
- 查看数据库查询计划: `EXPLAIN QUERY PLAN SELECT ...`

### 问题: Map 一直在增长
**检查**:
- cleanupAttempts() 是否被调用 (加 console.log)
- 定时器间隔是否正确 (60_000 ms)

### 问题: 限流不工作
**检查**:
- rateLimitMiddleware 是否被挂载到正确的路由
- 检查 requestLimits Map 是否被更新

### 问题: 索引没有创建
**检查**:
- 数据库文件是否被重新初始化
- 运行 VACUUM; ANALYZE; 后重新检查

---

**所有测试通过？→ 准备部署！**
