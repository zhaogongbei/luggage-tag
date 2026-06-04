# 打包本地端应用并修复浏览器打印功能计划

## 目标

把真正的无弹窗静默打印收敛到本地端应用：Electron 启动本机 Node 22 后端服务，窗口加载同源本机 Web UI，继续复用 `/api/orders/direct-print` 和系统默认打印机。普通浏览器访问 `https://tag.ycgg.cc.cd/` 时不再假装静默打印，而是创建订单后进入浏览器打印页，由浏览器打开打印窗口/预览。

## 设计决策

1. Electron 不直接 import 后端。后端依赖 `node:sqlite` 和 Node `>=22.5.0`，当前 Electron 26 内置 Node 版本不满足要求，所以桌面端用外部 Node 进程启动 `server/index.js`。
2. Electron 加载 `http://127.0.0.1:<port>/creator`。这样前端生产模式下的 `API_BASE = window.location.origin` 可直接命中本机后端，订单、权限、重打、活动重置都走现有后端。
3. 浏览器客户页根据运行环境分流。本机 Electron/localhost 继续调用 direct-print；远程浏览器调用普通 `/api/orders` 创建订单，然后跳转 `/ticket/:id?autoPrint=1&autoReturn=1`。
4. 打印页支持显式 `autoPrint` 参数。浏览器打印页保留手动打印按钮，自动打印只在被明确要求时触发。
5. 版本号从 `1.4.41` 递增到 `1.4.42`，同步 root 包、前端显示常量和 Electron 包。

## 实施步骤

1. 前端打印分流
   - 增加运行环境判断。
   - `CustomerPage` 根据本地端能力选择 direct-print 或 browser-order flow。
   - direct-print 失败且返回订单 id 时提供浏览器打印页兜底。
   - `/ticket/:id`、`/print/:id`、`/print-layout` 只在 `autoPrint=1` 时自动调用 `window.print()`。

2. 桌面端本机服务
   - Electron main process 启动外部 Node 后端进程。
   - 设置 `PORT`、`LUGGAGE_TAG_HOST=127.0.0.1`、`LUGGAGE_TAG_DATA_DIR=<userData>/data`。
   - 轮询 `/health` 后加载 `/creator`。
   - 应用退出时结束后端进程。
   - 打包配置包含 `server/`、`dist/`、`public/`、root `package*.json`，并增加 root 桌面准备/打包脚本。

3. 文档和版本
   - 记录本地端静默打印与浏览器打印差异。
   - 记录生产域名 `https://tag.ycgg.cc.cd/` 和本地端使用方式。
   - 同步版本号 `1.4.42`。

4. 验证
   - `npm run lint`
   - `npm run build`
   - `npm --prefix electron run build`
   - 尽量执行 Electron pack；如本机依赖缺失，记录阻塞原因。

5. 审查与归档
   - 双模型/协作审查全部变更。
   - 修复 Critical。
   - 写入 `review.md`、`verification.md`。
   - 归档 `.ccg/tasks/package-local-app-and-fix-browser-print` 并提交。
