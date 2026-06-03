# 剩余优化工作项 (第二阶段)

## 优先级说明
- **H(High)**: 性能/可靠性，需立即处理
- **M(Medium)**: 安全/可观测性，建议处理
- **验收标准**: 代码必须无bug、功能完整、通过回归测试

---

## H2: 统计查询合并 (高优先级 - 性能)
**影响**: /api/orders/stats 响应时间 5x 加速，高频端点

### 修改文件
**路径**: `server/index.js` 第 335-346 行

### 当前代码
```javascript
app.get("/api/orders/stats", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const user = getRequestUser(req);
  const oc = user.role === "client" ? "AND created_by = ?" : "";
  const params = user.role === "client" ? [user.id] : [];
  const today = new Date().toISOString().slice(0, 10);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL ${oc}`).get(...params);
  const printed = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL AND print_status = 'printed' ${oc}`).get(...params);
  const pending = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL AND print_status != 'printed' ${oc}`).get(...params);
  const deleted = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NOT NULL ${oc}`).get(...params);
  const todayCount = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE deleted_at IS NULL AND date(generated_at) = date(?) ${oc}`).get(today, ...params);
  res.json({ total: Number(total?.count ?? 0), printed: Number(printed?.count ?? 0), pending: Number(pending?.count ?? 0), deleted: Number(deleted?.count ?? 0), today: Number(todayCount?.count ?? 0) });
});
```

### 新代码
```javascript
app.get("/api/orders/stats", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const user = getRequestUser(req);
  const oc = user.role === "client" ? "WHERE orders.created_by = ?" : "";
  const params = user.role === "client" ? [user.id] : [];
  const today = new Date().toISOString().slice(0, 10);
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as total,
      SUM(CASE WHEN deleted_at IS NULL AND print_status = 'printed' THEN 1 ELSE 0 END) as printed,
      SUM(CASE WHEN deleted_at IS NULL AND print_status != 'printed' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) as deleted,
      SUM(CASE WHEN deleted_at IS NULL AND date(generated_at) = date(?) THEN 1 ELSE 0 END) as today
    FROM orders ${oc}
  `).get(today, ...params);
  res.json({
    total: Number(stats?.total ?? 0),
    printed: Number(stats?.printed ?? 0),
    pending: Number(stats?.pending ?? 0),
    deleted: Number(stats?.deleted ?? 0),
    today: Number(stats?.today ?? 0)
  });
});
```

### 验收标准
- [ ] 仪表板加载统计数据时，网络面板显示 1 个 /api/orders/stats 请求（非 5 个）
- [ ] 返回的数据与原代码一致（手动对比同一用户的 total/printed/pending/deleted/today）
- [ ] 响应时间 < 200ms（原来 500ms+ on 10K records）

---

## H4: Map 内存泄漏清理 (高优先级 - 可靠性)
**影响**: 长期运行防止内存溢出，特别是高攻击流量场景

### 修改文件
**路径**: `server/auth.js` 第 1-42 行

### 当前代码
```javascript
const loginFailures = new Map();
const inviteFailures = new Map();

function getLoginFailure(req) {
  const ip = getRequestIp(req);
  const failure = loginFailures.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (failure.lockedUntil && failure.lockedUntil <= Date.now()) {
    loginFailures.delete(ip);
    return { ip, failure: { count: 0, lockedUntil: 0 } };
  }
  return { ip, failure };
}
```

### 新代码 (完整替换)
```javascript
const loginFailures = new Map();
const inviteFailures = new Map();

function getLoginFailure(req) {
  const ip = getRequestIp(req);
  const failure = loginFailures.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (failure.lockedUntil && failure.lockedUntil <= Date.now()) {
    loginFailures.delete(ip);
    return { ip, failure: { count: 0, lockedUntil: 0 } };
  }
  return { ip, failure };
}

function getInviteFailure(ip) {
  const failure = inviteFailures.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (failure.lockedUntil && failure.lockedUntil <= Date.now()) {
    inviteFailures.delete(ip);
    return { count: 0, lockedUntil: 0 };
  }
  return failure;
}

function cleanupAttempts() {
  const now = Date.now();
  for (const [ip, failure] of loginFailures.entries()) {
    if (failure.lockedUntil && failure.lockedUntil <= now) {
      loginFailures.delete(ip);
    }
  }
  for (const [ip, failure] of inviteFailures.entries()) {
    if (failure.lockedUntil && failure.lockedUntil <= now) {
      inviteFailures.delete(ip);
    }
  }
}
setInterval(cleanupAttempts, 60_000).unref();
```

### 需要更新的地方
**路径**: `server/index.js` 第 151-173 行 (POST /api/auth/invite)

**当前代码**:
```javascript
app.post("/api/auth/invite", async (req, res) => {
  const ip = getRequestIp(req);
  const inviteFailure = inviteFailures.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (inviteFailure.lockedUntil > Date.now()) {
    ...
  }
  ...
});
```

**新代码**:
```javascript
app.post("/api/auth/invite", async (req, res) => {
  const ip = getRequestIp(req);
  const inviteFailure = getInviteFailure(ip);  // 改这里，使用新函数
  if (inviteFailure.lockedUntil > Date.now()) {
    ...
  }
  ...
});
```

### 导入新函数
**路径**: `server/index.js` 第 23-33 行

添加导入:
```javascript
import {
  getRequestIp, inviteFailures,
  getLoginFailure, recordLoginFailure, clearLoginFailure, getInviteFailure,  // 新增 getInviteFailure
  ...
} from "./auth.js";
```

### 验收标准
- [ ] 登录失败锁定后 30 秒解除，Map 中对应 IP 被删除（用 node 调试器或加 console.log 验证）
- [ ] 邀请码失败锁定后 30 秒解除，Map 中对应 IP 被删除
- [ ] 运行 12 小时后，loginFailures 和 inviteFailures Map 大小 < 100（非无限增长）

---

## M2: 数据库索引优化 (中优先级 - 查询性能)
**影响**: JOIN 查询性能 +30%，特别是大数据量下

### 修改文件
**路径**: `server/db.js` 第 79-83 行

### 当前代码
```javascript
  CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
  CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
```

### 新代码 (追加到 exec 语句末尾)
```javascript
  CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
  CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_events_id ON events(id);
  CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);
  CREATE INDEX IF NOT EXISTS idx_orders_deleted_print ON orders(deleted_at, print_status);
  CREATE INDEX IF NOT EXISTS idx_orders_deleted_date ON orders(deleted_at, generated_at);
```

### 验收标准
- [ ] 数据库初始化后，sqlite_master 表中包含 8 个 orders/events/users/auth_tokens 相关索引
- [ ] 订单列表分页查询 (带排序): < 50ms on 10K records
- [ ] 统计查询 (后接 SUM+CASE): < 100ms on 50K records

---

## H1: 审计日志清理算法优化 (高优先级 - 大数据处理)
**影响**: 日志清理速度 100x 加速（当日志 > 10K 条时明显）

### 修改文件
**路径**: `server/db.js` 第 233-236 行

### 当前代码
```javascript
function cleanupAuditLogs() {
  db.prepare("DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)").run(auditLogRetention);
}
setInterval(cleanupAuditLogs, auditCleanupIntervalMs).unref();
```

### 新代码
```javascript
function cleanupAuditLogs() {
  try {
    const offset = db.prepare("SELECT id FROM audit_logs ORDER BY id DESC LIMIT 1 OFFSET ?").get(auditLogRetention);
    if (offset) {
      db.prepare("DELETE FROM audit_logs WHERE id < ?").run(offset.id);
    }
  } catch (e) {
    console.error("Failed to cleanup audit logs", e);
  }
}
setInterval(cleanupAuditLogs, auditCleanupIntervalMs).unref();
```

### 验收标准
- [ ] 仪表板 → 操作日志 → 日志数量始终 ≤ auditLogRetention (默认 5000)
- [ ] 清理任务耗时 < 100ms（即使 10K 条日志）
- [ ] 清理前后的数据完整性无误

---

## M1: API 全局速率限制 (中优先级 - 安全)
**影响**: 防止 DoS 滥用，保护耗时操作 (PDF 生成、订单创建)

### 新增文件
**路径**: `server/middleware.js` (在现有导出前追加)

### 当前 middleware.js 末尾
```javascript
export { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess };
```

### 新增内容 (在导出前)
```javascript
const requestLimits = new Map();

function getRateLimitKey(req, resource = "") {
  const ip = getRequestIp(req);
  const userId = getRequestUser(req)?.id ?? "";
  return `${ip}:${userId}:${resource}`;
}

function checkRateLimit(key, maxRequests = 100, windowMs = 1000) {
  const now = Date.now();
  const entry = requestLimits.get(key);
  if (!entry || now - entry.resetTime >= windowMs) {
    requestLimits.set(key, { count: 1, resetTime: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetTime + windowMs - now) / 1000) };
  }
  return { allowed: true, remaining: maxRequests - entry.count };
}

function rateLimitMiddleware(resource, maxRequests = 100, windowMs = 1000) {
  return (req, res, next) => {
    const key = getRateLimitKey(req, resource);
    const limit = checkRateLimit(key, maxRequests, windowMs);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, limit.remaining));
    if (!limit.allowed) {
      res.setHeader("Retry-After", limit.retryAfter);
      return res.status(429).json({ message: `请求过于频繁，请${limit.retryAfter}秒后重试` });
    }
    next();
  };
}

function cleanupRateLimitMap() {
  const now = Date.now();
  for (const [key, entry] of requestLimits.entries()) {
    if (now - entry.resetTime > 60_000) requestLimits.delete(key);
  }
}
setInterval(cleanupRateLimitMap, 30_000).unref();

export { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess, rateLimitMiddleware };
```

### 修改文件
**路径**: `server/index.js` 导入部分 (第 38 行)

### 当前代码
```javascript
import { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess } from "./middleware.js";
```

### 新代码
```javascript
import { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess, rateLimitMiddleware } from "./middleware.js";
```

### 在 app 初始化后添加限流规则
**路径**: `server/index.js` 第 100 行（express.json 之后）

```javascript
app.use(express.json({ limit: "12mb" }));

// 全局速率限制
app.use("/api/orders", rateLimitMiddleware("orders", 200, 60_000));  // 200 req/min
app.use("/api/orders/imposition", rateLimitMiddleware("imposition", 20, 60_000));  // 20 req/min
app.use("/api/orders/a4-layout", rateLimitMiddleware("a4layout", 20, 60_000));  // 20 req/min
app.use("/api/layout/preview", rateLimitMiddleware("preview", 100, 60_000));  // 100 req/min
```

### 验收标准
- [ ] 快速发送 150 个 POST /api/orders 请求：第 151 个返回 429，包含 Retry-After 头
- [ ] 快速发送 25 个 POST /api/orders/imposition 请求：第 26 个返回 429
- [ ] 1 分钟后重新请求：返回 200，计数器重置
- [ ] 不同 IP/用户ID 的限流计数独立

---

## M3: 健康检查端点 (中优先级 - 可观测性)
**影响**: Kubernetes/容器编排可以探测服务健康

### 修改文件
**路径**: `server/index.js` 第 115 行（auth routes 前）

### 当前代码
```javascript
// ---- Auth routes ----
app.get("/api/auth/status", async (req, res) => { res.json(await getAccessState(req)); });
```

### 新代码 (在 auth routes 前插入)
```javascript
// ---- Health check ----
app.get("/health", async (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: "unhealthy", error: error.message, uptime: Math.floor(process.uptime()) });
  }
});

// ---- Auth routes ----
app.get("/api/auth/status", async (req, res) => { res.json(await getAccessState(req)); });
```

### 验收标准
- [ ] `curl http://localhost:3000/health` 返回 200 + JSON (status: "ok")
- [ ] 启用期间数据库连接异常时，/health 返回 503
- [ ] 响应时间 < 10ms

---

## M4: 错误响应统一 + 结构化日志 (中优先级 - 可维护性)
**影响**: 便于日志聚合、监控告警

### 修改文件
**路径**: `server/index.js` 第 40-44 行

### 当前代码
```javascript
function sendServerError(res, err, fallbackMsg) {
  console.error(err);
  const message = process.env.NODE_ENV === "production" ? fallbackMsg : (err?.message || fallbackMsg);
  res.status(500).json({ message });
}
```

### 新代码
```javascript
function sendServerError(res, err, fallbackMsg, errorCode = "INTERNAL_ERROR") {
  const statusCode = 500;
  const timestamp = new Date().toISOString();
  const requestId = crypto.randomBytes(8).toString("hex");
  console.error(JSON.stringify({
    timestamp,
    requestId,
    errorCode,
    statusCode,
    message: err?.message || fallbackMsg,
    stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
  }));
  const message = process.env.NODE_ENV === "production" ? fallbackMsg : (err?.message || fallbackMsg);
  res.status(statusCode).json({ errorCode, message, requestId });
}
```

### 修改所有调用处
在 `server/index.js` 中搜索所有 `sendServerError` 调用，补充 errorCode 参数：

**例 1** - 第 368 行:
```javascript
// 原: res.status(400).json({ message: error.message });
// 新:
catch (error) {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), errorCode: "INVALID_LAYOUT", message: error.message }));
  res.status(400).json({ errorCode: "INVALID_LAYOUT", message: error.message });
}
```

**例 2** - 第 368 行 (imposition):
```javascript
// 原: sendServerError(res, error, "Failed to create imposition PDF");
// 新:
catch (error) { sendServerError(res, error, "Failed to create imposition PDF", "PDF_GENERATION_FAILED"); }
```

### 验收标准
- [ ] 服务器错误响应包含 errorCode, message, requestId 三个字段
- [ ] console.error 输出结构化 JSON（可被 ELK/DataDog 聚合）
- [ ] 生产环境不泄露堆栈，开发环境包含 stack

---

## 测试方案

### 自动化测试检查 (必须通过)
```bash
# 1. 代码格式 + 语法
npm run lint

# 2. 启动服务
npm run dev &
SERVER_PID=$!
sleep 3

# 3. 功能测试
# H2: 统计合并
curl -H "Cookie: session=TOKEN" http://localhost:3000/api/orders/stats
# 期望: 1 个请求返回 { total, printed, pending, deleted, today }

# H4: Rate limit cleanup
sleep 61  # 等 cleanup 执行
# 检查 loginFailures/inviteFailures 大小

# M1: 速率限制
for i in {1..25}; do curl -X POST http://localhost:3000/api/orders/imposition; done
# 第 21-25 个请求应返回 429

# M3: 健康检查
curl http://localhost:3000/health
# 期望: { status: "ok", uptime: ... }

kill $SERVER_PID
```

### 手动回归测试 (核心业务流)
1. **登录流程**
   - [ ] 连续 5 次错误密码 → 锁定 60 秒 → 第 6 次显示锁定信息
   - [ ] 60 秒后登录成功

2. **订单创建**
   - [ ] 创建订单 → PNG 保存成功 → 编号自增
   - [ ] 上传非 PNG 文件 → 返回 "Not a valid PNG"

3. **仪表板统计**
   - [ ] 刷新统计信息 < 500ms
   - [ ] 统计总数 = 所有页面订单数之和

4. **打印机缓存**
   - [ ] 快速连续两次刷新打印机列表 → 第二次使用缓存（console 无重复 PowerShell 输出）

5. **审计日志**
   - [ ] 日志数量始终 ≤ 5000
   - [ ] 清理不删除最新 5000 条

6. **速率限制**
   - [ ] 1 分钟内 POST /api/orders/imposition 超过 20 次 → 返回 429
   - [ ] 返回包含 Retry-After 头

7. **数据库备份**
   - [ ] 启动 5 分钟后 /backups 目录有新的 VACUUM INTO 文件（非 copy）
   - [ ] 文件大小合理（< 原数据库 20MB）

---

## 验收清单

### 代码质量
- [ ] npm run lint 无错误
- [ ] npm run format 代码格式化后无差异
- [ ] 所有修改文件通过 TypeScript 类型检查（如有 ts 文件）

### 功能完整性
- [ ] 所有 7 项优化都已实现（H2, H4, H1, M1, M2, M3, M4）
- [ ] 无新增 console.error (除结构化日志)
- [ ] 无 TODO/FIXME 注释

### 性能验证
- [ ] H2: /api/orders/stats 单次请求 (原 5 次 → 1 次)
- [ ] H4: 12 小时运行后 Map 大小 < 100
- [ ] H1: 审计日志清理 < 100ms
- [ ] M2: 订单列表查询 < 50ms

### 安全验证
- [ ] M1: 超限返回 429 + Retry-After
- [ ] M4: 生产环境错误无堆栈泄露

### 部署验证
- [ ] 启动后服务正常，/health 返回 200
- [ ] 核心业务流 (登录 → 创建订单 → 打印 → 查看统计) 全部通过
- [ ] 仪表板加载不卡顿

---

## 交付清单
- [ ] 代码已 commit (勿 push)
- [ ] OPTIMIZATION_PLAN.md 标记为已完成
- [ ] 运行日志截图 (npm run dev 启动 + curl 测试结果)
- [ ] 性能对比表 (优化前后响应时间)
