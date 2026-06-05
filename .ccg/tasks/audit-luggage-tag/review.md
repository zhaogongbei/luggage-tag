# 代码审查报告 — luggage-tag v1.4.46

- 日期: 2026-06-05
- 策略: review-audit（外部模型 codex/gemini 本环境 API 不可用，降级为 Claude 单模型主审）
- 范围: 全项目（server/ 8 文件逐行 + src/ 核心文件 + 全项目模式扫描）

## 总体
安全底子扎实：SQL注入/命令注入/XSS/IDOR/路径穿越均已正确防御；OPTIMIZATION_PLAN.md 的 H1/H2/H4/M1/M2/M3/M4 七项全部已落实（已逐一核对代码）。

## Critical（0）
无可直接利用的高危漏洞。参数化SQL、execFile+env传参、React转义+客户名白名单、client越权过滤、scrypt+timingSafeEqual 均到位。

## High（4）
- H-1 默认密码 admin123 启动保护盲区：isPublicHostBinding 只认 0.0.0.0/::，绑定具体内网IP时 admin123 在局域网可用。index.js:67-69,608。建议非 127.0.0.1 绑定+默认密码统一拒绝启动 + 首登强制改密。
- H-2 管理端搜索/筛选只在当前页生效：服务端分页但客户端 filter 当前50条，跨页搜索失效。AdminPage.jsx:84-92,124-143,328-331。建议搜索条件下发后端SQL过滤。
- H-3 前端无 ErrorBoundary：main.jsx:229，子组件抛错整页白屏，kiosk场景致命。
- H-4 X-Forwarded-For 伪造绕过限流：trustProxy=true 时取最左值，伪造IP绕过锁定。auth.js:10-15。

## Warning（7）
- CSP connectSrc:['self','*'] 形同虚设 index.js:114
- CORS 宽松（空Origin+内网全段+credentials），sameSite:strict 缓解 index.js:52-65
- 无自动化测试（仅手工 TEST_CASES.md）
- AdminPage.jsx 680行巨组件 + 3处 eslint-disable exhaustive-deps
- 每订单一个Cookie，header膨胀风险 auth.js:146-148
- invite限流逻辑重复且与login不一致 index.js:194-203
- 登录用户名枚举时序差异 index.js:160-161

## Info（6）
- node:sqlite 同步API阻塞事件循环 db.js:16
- jspdf 同步生成大批量拼版PDF阻塞 pdf.js:158-177
- express.json 12mb 全局放宽DoS面 index.js:118
- ESC/POS 前端未接入（android原生 EscPosPlugin.java 已实现）src/plugins/escpos.ts
- 限流/失败计数进程内存，多实例不共享/重启清零
- 硬编码 superAdminUsername=gongbei config.js:22

## 总计: 0 Critical / 4 High / 7 Warning / 6 Info

## 修复记录（2026-06-05·已应用 direct-fix）
4 个 High 全部修复，变更 4 文件 +79/-20，后端 `node --check` 通过：
- H-1 `index.js`: `isPublicHostBinding`→`isLocalHostBinding`，非 localhost 绑定 + 默认密码即拒绝启动（保留 ALLOW_DEFAULT_PASSWORD 逃生阀）
- H-2 `index.js` `/api/orders`: 增加 search/status/template 服务端 SQL 过滤（参数化）；`AdminPage` loadOrders 下发条件 + 300ms 防抖 + 删冗余 showDeleted effect
- H-3 `main.jsx`: 新增 ErrorBoundary class 包裹 App
- H-4 `auth.js` `getRequestIp`: 取 X-Forwarded-For 链最右 IP（防伪造绕过限流）

Warning/Info 项未改动，留待后续。

## 验证（2026-06-05）
- 后端 `node --check server/*.js` 通过；`npm install --legacy-peer-deps` + `vite build` + `eslint` 全部 rc=0。4 个 High 修复编译/lint 通过。

## 验证中新发现 W-8（Warning）
- eslint@^10.4.1 与 eslint-plugin-react@7.37.5（peer 仅支持 eslint ≤9.7）冲突 → 全新 clone 默认 `npm install` 报 ERESOLVE 失败，须 `--legacy-peer-deps`。建议：降 eslint 至 ^9，或升 eslint-plugin-react 至支持 v10 版本，或加 `.npmrc` `legacy-peer-deps=true`。
