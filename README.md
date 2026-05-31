# DIY Luggage Tag MVP

Version: `1.4.10`

现场 DIY 行李牌定制系统 MVP，包含客户定制页、后台订单页、编号设置、订单生成、PNG/PDF 下载和打印状态管理。

## Start

```bash
npm install
npm run dev
```

默认地址：

- Frontend: http://127.0.0.1:5173
- API: http://127.0.0.1:3001

默认启用私有部署模式：前端和后端只绑定本机 `127.0.0.1`，公网或局域网访问需要显式开启。

## Features

- V1.1 固定三色模板：深灰色、米灰色、国泰绿
- Canvas 实时预览
- 模板底图不可编辑，仅叠加编号、姓名、时间水印
- 姓名仅允许英文字母，自动大写并过滤中文、数字、表情和特殊字符，最多 12 字符
- 预览不递增编号，确认生成成功后递增
- SQLite 本地数据库
- 后台订单列表、打印状态切换、PNG/PDF 下载
- 后台设置编号前缀、当前编号、编号位数、时间水印开关
- 后台可创建新活动并重置编号，历史订单编号不变，删除订单不回退当前编号
- V1.3 通用智能拼版：A4/A3/A5/自定义纸张、自动计算最优列行、自动旋转优化、裁切线、批量打印
- V1.4 私有部署和登录门禁：未登录用户默认无法访问任何业务页面，后台支持 Private / Invite / Public / Maintenance 四种模式
- V1.4.3 打印输出小票：前端预览保留模板，单张打印、拼版打印和 PDF 导出改为白底黑字，仅包含姓名、编号、时间
- V1.4.4 新活动重置编号：新增活动表，订单绑定活动，重置后只影响新订单，历史订单仍可查询、打印、删除
- V1.4.5 客户定制页退出：邀请码客户进入定制页后也可主动退出登录状态
- V1.4.6 自助终端定制页：`/creator` 竖屏终端风格，预览仅显示模板和姓名，支持 `autoPrint` / `autoReturn`
- V1.4.7 客户预览统一：普通定制页和 `/creator` 预览均只显示模板和姓名，编号与时间仅进入打印小票
- V1.4.8 Kiosk 单动作布局：客户定制页和 `/creator` 改为顶部品牌栏、中间大预览、下方超大姓名输入和提交按钮
- V1.4.9 响应式 Kiosk：保留颜色选择，竖屏预览在上操作在下，横屏/电脑操作与预览左右布局
- V1.4.10 英文姓名输入：前端实时过滤非英文字母，提交前和后端再次校验，并启用英文虚拟键盘属性

## Access Control

默认工作人员账号：

- Username: `admin`
- Password: `admin123`

生产部署建议使用环境变量覆盖：

```powershell
$env:LUGGAGE_TAG_STAFF_USER="your-user"
$env:LUGGAGE_TAG_STAFF_PASSWORD="your-strong-password"
npm run server
```

后台访问模式：

- `Private`：默认模式，定制页和后台都需要工作人员登录
- `Invite`：客户可用邀请码进入定制页，隐藏后台入口，后台仍需工作人员登录
- `Public`：定制页公开，后台、订单、下载、打印仍需工作人员登录
- `Maintenance`：维护模式，定制页关闭，仅工作人员可登录后台切回其它模式

如需局域网或公网绑定：

```powershell
$env:LUGGAGE_TAG_HOST="0.0.0.0"
npm run server
npm run client:lan
```

即使绑定公网，系统仍默认处于 `Private` 模式，必须工作人员登录后才能使用业务页面。

## Printing

V1 浏览器打印：

- 订单生成后自动生成 PDF
- 后台订单列表提供“打印”按钮
- 点击后打开 `/print/:id` 打印预览页
- 打印预览页输出白底黑字小票，不打印模板背景图
- 打印完成后在后台手动标记为“已打印”

V1.2 A4 拼版打印：

- 后台订单列表支持多选订单
- `POST /api/orders/a4-layout` 生成 A4 拼版 PDF
- `/print-a4?ids=1,2,3,4` 打开 A4 浏览器打印页并自动调用 `window.print()`
- A4 页面尺寸为 210mm x 297mm
- 每个行李牌保持 70mm x 110mm
- 2 列 x 2 行自动排版，不足 4 张也可生成
- 每个行李牌带裁切线，并在下方显示编号
- 重新拼版或重新打印不增加编号

V1.3 通用智能拼版：

- 后台可选择 A4、A3、A5 或自定义纸张尺寸
- 可设置成品宽高、最小边距、间距、是否自动旋转、是否显示裁切线、是否显示编号
- `POST /api/layout/preview` 计算最优拼版方案
- `POST /api/orders/imposition` 生成通用拼版 PDF
- `/print-layout?ids=...&layout=...` 打开批量浏览器打印页并自动调用 `window.print()`
- 系统按最大单页容量优先，容量相同时选择浪费面积更小的方案

V2 本地打印服务预留：

- `GET /api/printers` 读取本机打印机和默认打印机
- `PUT /api/printers/selected` 保存选择的打印机
- `POST /api/printers/test` 预留测试打印接口
- `POST /api/orders/:id/print` 预留订单直打接口
- 重新打印不增加编号

## Data

默认数据目录：

```text
data/
  luggage-tag.sqlite
  exports/
```

如需指定数据目录：

```bash
set LUGGAGE_TAG_DATA_DIR=C:\path\to\data
npm run server
```
