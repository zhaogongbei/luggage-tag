# 🧳 DIY Luggage Tag — 现场行李牌定制与打印系统

> 面向活动现场、机场/酒店礼宾、品牌快闪等场景的 **自助行李牌定制 + 即时出票** 系统。
> 客户在自助终端选色、输入英文姓名并实时预览，工作人员后台统一管理订单、编号与打印；
> 支持浏览器打印、PDF 拼版、现场直连热敏打印机静默出票，以及内置 Node 运行时的桌面端一键部署。

<p>
  <img alt="version" src="https://img.shields.io/badge/version-1.4.46-2f6f5e" />
  <img alt="frontend" src="https://img.shields.io/badge/React_19-Vite_7-61dafb" />
  <img alt="backend" src="https://img.shields.io/badge/Express_5-node%3Asqlite-3c873a" />
  <img alt="desktop" src="https://img.shields.io/badge/Electron-Capacitor_8-47848f" />
</p>

**生产环境**：<https://tag.ycgg.cc.cd/>

---

## 📑 目录

- [系统概述](#-系统概述)
- [功能概览](#-功能概览)
- [技术栈](#️-技术栈)
- [目录结构](#-目录结构)
- [快速开始](#-快速开始)
- [环境变量配置](#️-环境变量配置)
- [访问控制与部署模式](#-访问控制与部署模式)
- [打印体系](#️-打印体系)
- [热敏小票可视化排版](#-热敏小票可视化排版)
- [桌面端（静默打印）](#️-桌面端静默打印)
- [数据与备份](#-数据与备份)
- [API 一览](#-api-一览)
- [版本日志](#-版本日志)

---

## 🎯 系统概述

DIY Luggage Tag 是一套 **前后端一体** 的现场定制发牌系统。它把"客户自助设计 → 生成唯一编号 → 即时打印出票 → 后台统一管理"整条链路做成了开箱即用的一体化应用：

- **对客户**：竖屏/横屏自适应的 Kiosk 自助页，固定品牌模板 + 大字号姓名输入，所见即所得，一键提交即出票。
- **对工作人员**：后台集中管理订单、编号、活动、打印机与账号权限，支持单张/批量/拼版多种出票方式。
- **对部署方**：默认私有绑定本机、四档访问模式、登录锁定与审计日志、SQLite 自动备份，既能桌面端单机静默打印，也能局域网/公网多端协作。

典型使用场景：活动签到发牌、酒店/机场礼宾行李牌、品牌快闪定制、展会现场出票。

---

## ✨ 功能概览

### 🎨 客户自助定制（Kiosk）
- 固定三色品牌模板：**深灰色 / 米灰色 / 国泰绿**，模板底图不可编辑，仅叠加编号、姓名与时间水印。
- **Canvas 实时预览**，所见即所得；客户预览仅显示模板与姓名，编号与时间仅进入打印小票。
- **英文姓名输入**：实时过滤非英文字符，强制大写、允许单词间空格、最长 12 字符；提交前端 + 后端双重校验，并启用英文虚拟键盘属性。
- **响应式 Kiosk 布局**：竖屏「预览在上、操作在下」，横屏/电脑「预览与操作左右分栏」；监听 `visualViewport` 适配移动键盘，输入聚焦时缩小预览、上移操作区，采用 `100dvh` 布局。
- 专用自助终端入口 `/creator`（竖屏终端风格）；邀请码客户进入定制页后可主动退出。

### 🧾 订单与编号管理
- **预览不递增、确认生成成功后才递增编号**，杜绝空号。
- **并发安全取号**：取号、入库、自增在同一事务内同步执行，文件写入移出事务并带失败补偿，避免高并发重号。
- 后台订单列表：状态筛选、关键字搜索（服务端 SQL 过滤，跨页生效）、打印状态切换、PNG/PDF 下载。
- **软删除 / 恢复**：删除订单不回退当前编号，可恢复。

### 🗂️ 活动管理
- 后台可创建新活动并重置编号；订单绑定活动，重置只影响新订单。
- 历史订单编号不变，仍可查询、打印、删除。

### 🧮 智能拼版
- 支持 **A4 / A3 / A5 / 自定义** 纸张，可设置成品宽高、最小边距、间距、自动旋转、裁切线、编号显示。
- 自动计算最优列×行方案：按单页最大容量优先，容量相同时选浪费面积更小者。
- 批量浏览器打印页自动触发 `window.print()`；重新拼版/重打不增加编号。

### 🎫 热敏小票可视化排版（v1.4.46 新增）
- 后台「系统设置 → 热敏小票排版」提供 **双列可视化编辑器**：左列 1:1 实时预览，右列滑块即时调参。
- 可调：小票宽高、整体对齐、内容上边距、整体偏移、各行字号与下边距；常用尺寸预设（80×60 / 58×40 / 100×80）、预览姓名、内容溢出提示、一键恢复默认。
- 预览（DOM）、PDF、Windows 直连打印（GDI）**共用同一套排版参数**，保存即对三种输出生效。

### 🔐 权限、部署与安全
- 角色：**Super Admin / Admin / Client**；四档部署模式 Private / Invite / Public / Maintenance。
- 安全加固：`helmet` 安全响应头、CORS 白名单、默认私有绑定本机、**非本机绑定时默认密码拒绝启动**、登录失败锁定、`X-Forwarded-For` 取最右真实 IP 防限流绕过、参数化 SQL、`scrypt` + `timingSafeEqual` 密码校验、前端 ErrorBoundary 防白屏。
- 数据保护：SQLite **定时自动备份**（默认 6h，保留 24 份）、导出文件定时清理、审计日志（默认保留 5000 条）。

---

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 · Vite 7 · lucide-react · Canvas 2D |
| 后端 | Node.js ≥ 22.5（`node:sqlite` `DatabaseSync` 实验特性）· Express 5 · helmet · cors · jspdf |
| 系统打印 | `execFile` 调用 Windows PowerShell `System.Drawing` (GDI) / Linux·macOS CUPS `lp` |
| 桌面端 | Electron + `@capacitor-community/electron`（打包内置 Node 运行时，静默打印） |
| 移动端 | Capacitor 8 Android（含原生 ESC/POS 插件桥 `src/plugins/escpos.ts`） |
| 工程化 | ESLint · Prettier · concurrently |

---

## 📂 目录结构

```text
luggage-tag/
├─ src/                     # React 前端
│  ├─ components/           #   TicketPrint / BrandLogo / CanvasPreview 等
│  ├─ pages/                #   AdminPage / CustomerPage / PrintPage / ImpositionPrintPage / AccessGate ...
│  ├─ lib/                  #   constants（含小票默认参数）/ format / layout 工具
│  └─ plugins/              #   escpos.ts（Capacitor 原生桥）
├─ server/                  # Express 后端
│  ├─ index.js              #   路由装配与中间件
│  ├─ config.js             #   配置与环境变量
│  ├─ auth.js               #   认证 / 会话 / 限流 / 审计
│  ├─ db.js                 #   node:sqlite / 自动备份 / 设置
│  ├─ orders.js             #   订单与并发取号事务
│  ├─ pdf.js                #   jspdf 小票与拼版渲染
│  ├─ printing.js           #   系统打印（GDI / CUPS）
│  └─ middleware.js         #   校验 / 角色中间件
├─ electron/                # 桌面端打包工程
├─ android/                 # Capacitor Android 工程
├─ scripts/                 # dev.mjs / prepare-desktop.mjs 等
├─ public/                  # 静态资源、模板底图、brand-logo
└─ data/                    # sqlite + exports/ + backups/（运行时生成）
```

---

## 🚀 快速开始

```bash
npm install        # 依赖冲突时使用：npm install --legacy-peer-deps
npm run dev        # 同时启动前端(Vite) + 后端(Express)
```

默认地址：

- 前端：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:3001>

> 默认启用 **私有部署模式**：前后端仅绑定本机 `127.0.0.1`，公网/局域网访问需显式开启（见下文）。

默认超级管理员账号：

| 字段 | 值 |
|------|-----|
| Username | `gongbei` |
| Password | `admin123` ⚠️ 生产环境务必通过环境变量覆盖 |

常用脚本：

```bash
npm run dev            # 开发（前端 + 后端）
npm run server         # 仅启动后端 API
npm run client:lan     # 前端绑定 0.0.0.0（局域网）
npm run build          # 构建前端到 dist/
npm run lint           # ESLint 检查
npm run desktop:pack   # 构建并打包 Windows 桌面端（portable）
```

---

## ⚙️ 环境变量配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LUGGAGE_TAG_HOST` / `HOST` | `127.0.0.1` | 后端绑定地址，设 `0.0.0.0` 暴露到局域网/公网 |
| `PORT` | `3001` | API 端口 |
| `LUGGAGE_TAG_DATA_DIR` | `./data` | 数据目录（sqlite / exports / backups） |
| `SUPER_ADMIN_PASSWORD` / `LUGGAGE_TAG_STAFF_PASSWORD` | `admin123` | 超级管理员密码 |
| `LUGGAGE_TAG_STAFF_USER` | — | 覆盖工作人员用户名 |
| `LUGGAGE_TAG_LOGIN_MAX_FAILURES` | `5` | 登录失败锁定阈值（≥3） |
| `LUGGAGE_TAG_LOGIN_LOCK_MS` | `300000` | 锁定时长（毫秒，≥60s） |
| `LUGGAGE_TAG_BACKUP_INTERVAL_MS` | `21600000` | 自动备份间隔（默认 6 小时） |
| `LUGGAGE_TAG_BACKUP_RETENTION` | `24` | 备份保留份数 |
| `LUGGAGE_TAG_EXPORT_CLEANUP_INTERVAL_MS` | `86400000` | 导出清理间隔 |
| `LUGGAGE_TAG_EXPORT_CLEANUP_MIN_AGE_MS` | `604800000` | 导出文件最小保留（默认 7 天） |
| `LUGGAGE_TAG_AUDIT_RETENTION` | `5000` | 审计日志保留条数 |
| `LUGGAGE_TAG_COOKIE_SECURE` | `false` | 强制 `Secure` Cookie（HTTPS 部署设 `true`） |
| `LUGGAGE_TAG_TRUST_PROXY` | `false` | 信任反代，按 `X-Forwarded-For` 最右 IP 限流 |
| `LUGGAGE_TAG_ALLOW_ORIGIN` | — | CORS 白名单（逗号分隔） |
| `LUGGAGE_TAG_ALLOW_DEFAULT_PASSWORD_ON_PUBLIC_HOST` | `false` | 逃生阀：允许公网绑定仍用默认密码（不建议） |
| `LUGGAGE_TAG_BRAND_LOGO_PATH` | — | 自定义品牌 Logo 路径 |
| `LUGGAGE_TAG_TICKET_*` | 见 `server/config.js` | 小票排版默认值（宽高/字号/边距/对齐等） |

---

## 🔐 访问控制与部署模式

四档后台访问模式（后台可随时切换）：

| 模式 | 定制页 | 后台 | 说明 |
|------|--------|------|------|
| `Private` | 需登录 | 需登录 | **默认模式**，定制页与后台都需工作人员登录 |
| `Invite` | 邀请码 | 需登录 | 客户用邀请码进入定制页，隐藏后台入口 |
| `Public` | 公开 | 需登录 | 定制页公开，后台/订单/下载/打印仍需登录 |
| `Maintenance` | 关闭 | 需登录 | 维护模式，仅工作人员可登录后台切回其它模式 |

生产部署覆盖密码：

```powershell
$env:LUGGAGE_TAG_STAFF_USER="your-user"
$env:LUGGAGE_TAG_STAFF_PASSWORD="your-strong-password"
npm run server
```

局域网 / 公网绑定：

```powershell
$env:LUGGAGE_TAG_HOST="0.0.0.0"
npm run server
npm run client:lan
```

> 即使绑定公网，系统仍默认处于 `Private` 模式；且 **非本机绑定时若仍使用默认密码会拒绝启动**（可用逃生阀环境变量临时放行）。

---

## 🖨️ 打印体系

系统提供多通道出票，适配不同部署形态：

| 通道 | 入口 | 输出 | 适用 |
|------|------|------|------|
| 浏览器打印 | `/print/:id` | 白底黑字小票（不含模板背景） | 任意浏览器，手动标记已打印 |
| PDF 导出 | 订单列表下载 | PNG / PDF | 留档、异地打印 |
| A4 / 通用拼版 | `/print-a4`、`/print-layout` | 多张拼版 PDF | 批量裁切出牌 |
| 现场直连静默打印 | `POST /api/orders/direct-print` | 实体热敏打印机 | 本地端/本机服务，秒级出票 |

要点：

- **浏览器路径** 受浏览器安全模型限制，必须显示系统打印交互，不模拟静默打印。
- **本地端/本机服务路径** 点击【打印】直接创建订单、生成编号与时间并发送到后台配置的实体打印机；成功后页面短暂显示编号即自动清空，等待下一位。
- 打印失败时订单保留为 `pending`，后台可按编号追溯并重打；页面提供浏览器打印兜底链接。
- 后台打印设置会标注 **虚拟打印机**，避免误选不出纸设备。
- 所有重打/重新拼版 **均不增加编号**。

---

## 🎫 热敏小票可视化排版

后台 **系统设置 → 热敏小票排版** 提供可视化编辑器：

- 左列 **1:1 实时预览**（可改预览姓名、内容溢出告警）；
- 右列滑块即时调整字号、内容上边距、整体偏移、各行下边距；
- 常用尺寸一键预设、整体对齐、一键恢复默认；
- DOM 预览 / PDF / Windows GDI 三种输出共用同一参数，保存即全通道生效。

> 提示：`整体偏移` 填负数上移、正数下移，用于校准热敏打印机进纸。

---

## 🖥️ 桌面端（静默打印）

桌面端用于连接现场电脑的默认打印机，实现 **无浏览器弹窗的静默打印**。打包后的 Windows 桌面端 **已内置 Node 运行时**，客户电脑无需单独安装 Node.js。

```powershell
npm run desktop:pack
```

打包前会自动执行 Web 构建，并把 `server/`、`dist/`、`public/` 及生产依赖同步到 Electron 的本地服务目录；生成的 portable 应用位于 `electron/dist/`。桌面端 `/creator` 顶部在工作人员登录后会显示后台入口，可直接进入 `/admin`。

---

## 💾 数据与备份

默认数据目录：

```text
data/
├─ luggage-tag.sqlite      # 主数据库
├─ exports/                # 生成的 PNG / PDF
└─ backups/                # 自动备份（默认每 6h，保留 24 份）
```

指定数据目录：

```bash
set LUGGAGE_TAG_DATA_DIR=C:\path\to\data
npm run server
```

---

## 📡 API 一览

> 业务接口默认需要工作人员会话；客户侧接口受当前部署模式约束。

<details>
<summary>展开完整 API 路由表</summary>

**健康与品牌**
- `GET /health` — 健康检查
- `GET /brand-logo` — 品牌 Logo

**认证**
- `POST /api/auth/login` · `POST /api/auth/logout` · `POST /api/auth/invite`
- `GET /api/auth/status` — 当前登录态与部署模式

**订单**
- `GET /api/orders` — 列表（服务端搜索/状态/活动筛选）
- `GET /api/orders/:id` · `GET /api/orders/batch` · `GET /api/orders/stats`
- `POST /api/orders` — 创建订单（取号）
- `DELETE /api/orders/:id` — 软删除
- `PATCH /api/orders/:id/restore` — 恢复
- `PATCH /api/orders/:id/print-status` — 切换打印状态

**文件**
- `GET /api/orders/:id/download/:type` · `GET /api/orders/:id/file/:type` · `GET /api/orders/:id/ticket`

**打印**
- `POST /api/orders/a4-layout` · `POST /api/orders/imposition` — 拼版 PDF
- `POST /api/layout/preview` — 计算最优拼版
- `POST /api/orders/direct-print` — 现场直连出票
- `POST /api/orders/:id/print` · `POST /api/orders/:id/print-ticket` — 重打
- `GET /api/printers` · `PUT /api/printers/selected` · `POST /api/printers/test`

**设置与活动**
- `GET /api/settings` · `PUT /api/settings`
- `GET /api/preview-number` — 预览下一个编号（不递增）
- `POST /api/events/reset` — 新活动并重置编号

**用户与审计**
- `GET /api/users` · `POST /api/users` · `PATCH /api/users/:id` · `DELETE /api/users/:id`
- `POST /api/users/:id/reset-password`
- `GET /api/audit-logs`

</details>

---

## 📋 版本日志

<details>
<summary>展开完整版本日志（V1.1 → V1.4.46）</summary>

- **V1.4.46** 安全加固与可视化排版：非本机绑定 + 默认密码即拒绝启动；`X-Forwarded-For` 取最右真实 IP 防限流绕过；前端新增 ErrorBoundary 防白屏；管理端搜索/筛选下沉服务端 SQL；新增 **热敏小票排版可视化编辑器**（1:1 实时预览 + 滑块调参 + 尺寸预设），移除无效的「时间下边距」参数并统一三引擎坐标。
- **V1.4.45** 本地端内置 Node：桌面端打包时内置 Node 运行时，客户电脑无需单独安装 Node.js 即可启动本地打印服务。
- **V1.4.44** 本地端启动修复：目录包缺少 `app-update.yml` 时跳过自动更新检查，避免启动时弹出未处理错误。
- **V1.4.43** 本地端后台入口：本地端 `/creator` 顶部在工作人员登录后显示后台入口，可直接进入 `/admin`。
- **V1.4.42** 本地端静默打印：Electron 本地端启动 127.0.0.1 打印服务并加载定制页，实体静默打印只在本地端/本机服务场景执行；普通浏览器创建订单后进入浏览器打印页。
- **V1.4.41** 现场静默打印闭环：客户页【打印】固定调用后台本地打印服务，不再进入浏览器打印页；成功后自动清空并等待下一位，后台重打成功会同步标记已打印。
- **V1.4.40** 现场直连打印：定制页【打印】直接创建订单并发送到后台配置的实体打印机，后台打印设置会标注虚拟打印机并避免默认选中不出纸设备。
- **V1.4.16** 迭代优化：平板后台适配、模板图缓存、导出相对路径、导出残留清理、拼版预设、操作菜单、会话持久化和 HTTPS Cookie/输入合成优化。
- **V1.4.15** 上线前安全与数据保护：登录失败锁定、CORS 白名单、订单软删除/恢复、SQLite 自动备份、编号调低确认和键盘可见性增强。
- **V1.4.14** 并发取号修复：订单创建事务内只执行同步取号、入库和自增，文件写入移出事务并失败补偿。
- **V1.4.13** 移动键盘适配：监听 `visualViewport`，输入聚焦时缩小预览、上移操作区，并使用 `100dvh` 布局。
- **V1.4.12** 英文大写空格：姓名强制大写，允许英文单词之间输入空格。
- **V1.4.11** 英文大小写：姓名输入保留用户输入的大小写，不再强制转换为大写。
- **V1.4.10** 英文姓名输入：前端实时过滤非英文字母，提交前和后端再次校验，并启用英文虚拟键盘属性。
- **V1.4.9** 响应式 Kiosk：保留颜色选择，竖屏预览在上操作在下，横屏/电脑操作与预览左右布局。
- **V1.4.8** Kiosk 单动作布局：客户定制页和 `/creator` 改为顶部品牌栏、中间大预览、下方超大姓名输入和提交按钮。
- **V1.4.7** 客户预览统一：普通定制页和 `/creator` 预览均只显示模板和姓名，编号与时间仅进入打印小票。
- **V1.4.6** 自助终端定制页：`/creator` 竖屏终端风格，预览仅显示模板和姓名。
- **V1.4.5** 客户定制页退出：邀请码客户进入定制页后也可主动退出登录状态。
- **V1.4.4** 新活动重置编号：新增活动表，订单绑定活动，重置后只影响新订单，历史订单仍可查询、打印、删除。
- **V1.4.3** 打印输出小票：前端预览保留模板，单张打印、拼版打印和 PDF 导出改为白底黑字，仅包含姓名、编号、时间。
- **V1.4** 私有部署和登录门禁：未登录用户默认无法访问任何业务页面，后台支持 Private / Invite / Public / Maintenance 四种模式。
- **V1.3** 通用智能拼版：A4/A3/A5/自定义纸张、自动计算最优列行、自动旋转优化、裁切线、批量打印。
- **V1.1** 基础能力：固定三色模板（深灰/米灰/国泰绿）、Canvas 实时预览、模板底图不可编辑仅叠加编号/姓名/时间水印、英文姓名校验（强制大写、最多 12 字符）、预览不递增编号、SQLite 本地数据库、后台订单列表与打印状态切换、PNG/PDF 下载、编号前缀/位数/水印设置。

</details>

---

<sub>现场 DIY 行李牌定制系统 · 当前版本 `1.4.46`</sub>
