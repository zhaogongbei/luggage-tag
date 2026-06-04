# 审查记录

## 审查方式

- CCG 指定的 `~/.claude/bin/codeagent-wrapper` 在本机不存在，无法使用模板直接调用外部 codex/Claude wrapper。
- 已使用两个独立 `ccg-review` 子代理进行双路审查。

## Critical

- 已修复：Electron 加载本机 HTTP UI 时原先启用 `nodeIntegration`，并且远程 URL 模式导航限制不够严格。修复为 `nodeIntegration: false`，并限制 `window.open`、导航、重定向只能访问本机服务 origin 或自定义 scheme。
- 已修复：Electron 本地服务启动失败页将错误文本插入 `data:text/html` 前未转义。已增加 HTML escaping。

## Warning

- 桌面端依赖外部 Node.js `>=22.5.0`，因为后端使用 `node:sqlite`，当前 Electron 26 内置 Node 不满足。README 和启动错误页已明确提示，可通过 `LUGGAGE_TAG_NODE_PATH` 指向指定 Node。
- `localhost` / `127.0.0.1` 浏览器会被视为本地打印环境并调用 `/api/orders/direct-print`。这是本机打印服务模式的预期行为；生产域名 `https://tag.ycgg.cc.cd/` 不会命中该分支。
- Electron 正常退出会 kill 后端子进程；若 Electron 被硬崩溃终止，仍可能残留 Node 子进程，这是外部子进程模式的运行风险。

## Info

- 生产浏览器路径正确：非本地 hostname 会 `POST /api/orders`，然后跳转 `/ticket/:id?autoPrint=1&autoReturn=1`。
- Electron 本地端路径正确：启动 127.0.0.1 后端，等待 `/health` 后加载 `/creator`。
- 打包资源路径正确：`desktop:prepare` 生成 `electron/local-server`，`electron-builder` 通过 `extraResources` 复制到 `resources/local-server`，运行时查找该目录。
- Direct-print 失败后前端复用后端返回的订单 id 打开浏览器打印页，不重复创建订单。

## 结论

无剩余 Critical。Warning 均为已知运行约束，已记录在文档或符合本机打印服务设计。
