# 验证记录

## 已通过

- `npm run lint`
- `npm run build`
- `npm --prefix electron run build`
- `npm run desktop:prepare`
- `npm --prefix electron run electron:pack`
- `git diff --check -- . ':!electron/dist/**' ':!electron/local-server/**'`

## 桌面端包结构

- `electron/dist/win-unpacked/LuggageTag.exe` 存在
- `electron/dist/win-unpacked/resources/local-server/server/index.js` 存在
- `electron/dist/win-unpacked/resources/local-server/dist/index.html` 存在
- `electron/dist/win-unpacked/resources/local-server/node_modules/express` 存在

## 打包后本地服务健康检查

使用 `electron/dist/win-unpacked/resources/local-server` 作为工作目录启动生产后端，设置临时数据目录和端口 `3198`，调用 `/health` 返回：

```json
{"status":"ok","uptime":0,"timestamp":"2026-06-04T03:32:37.747Z"}
```

## 说明

- `electron:pack` 生成的是目录包 `electron/dist/win-unpacked`。
- 打包过程使用 `extraResources` 复制本地服务，确保 Node 子进程可访问 `server/`、`dist/`、`public/` 和生产依赖。
