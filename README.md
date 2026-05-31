# DIY Luggage Tag MVP

现场 DIY 行李牌定制系统 MVP，包含客户定制页、后台订单页、编号设置、订单生成、PNG/PDF 下载和打印状态管理。

## Start

```bash
npm install
npm run dev
```

默认地址：

- Frontend: http://localhost:5173
- API: http://localhost:3001

## Features

- V1.1 固定三色模板：深灰色、米灰色、国泰绿
- Canvas 实时预览
- 模板底图不可编辑，仅叠加编号、姓名、时间水印
- 姓名自动大写，英文最多 12 字符，中文最多 6 字符
- 预览不递增编号，确认生成成功后递增
- SQLite 本地数据库
- 后台订单列表、打印状态切换、PNG/PDF 下载
- 后台设置编号前缀、当前编号、编号位数、时间水印开关

## Printing

V1 浏览器打印：

- 订单生成后自动生成 PDF
- 后台订单列表提供“打印”按钮
- 点击后打开 `/print/:id` 打印预览页
- 打印预览页加载 PNG 后自动调用 `window.print()`
- 打印完成后在后台手动标记为“已打印”

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
