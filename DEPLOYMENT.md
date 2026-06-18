# luggage-tag 部署指南

## 📋 部署环境

- **部署域名**: `https://tag.ycgg.cc.cd/`
- **服务器 IP**: `216.167.70.248:41836`
- **反向代理**: OpenResty
- **Node.js 版本**: >= 22.5.0

---

## 🚀 部署步骤

### 1️⃣ 配置后端环境变量

已生成 `.env` 文件，**请务必修改以下配置**：

```bash
# 修改默认密码（必须）
SUPER_ADMIN_PASSWORD=your_secure_password_here
```

其他配置说明：
- `NODE_ENV=production` - 生产模式
- `LUGGAGE_TAG_HOST=127.0.0.1` - 仅监听本地，由 OpenResty 反代
- `PORT=3001` - 后端监听端口
- `LUGGAGE_TAG_TRUST_PROXY=true` - 信任反向代理头信息
- `LUGGAGE_TAG_COOKIE_SECURE=true` - HTTPS Cookie 安全标志
- `LUGGAGE_TAG_ALLOW_ORIGIN=https://tag.ycgg.cc.cd` - CORS 允许的域名

### 2️⃣ 构建前端

```bash
npm run build
```

**重要**：不需要设置 `VITE_API_BASE`，因为前后端同域，会自动使用 `window.location.origin`。

构建完成后，`dist/` 目录包含所有前端静态文件。

### 3️⃣ 配置 OpenResty

已生成配置模板 `openresty-config.conf`，需要在服务器上配置：

#### 步骤：

1. **修改 SSL 证书路径**（在 `openresty-config.conf` 中）：
   ```nginx
   ssl_certificate /path/to/ssl/cert/tag.ycgg.cc.cd.crt;
   ssl_certificate_key /path/to/ssl/cert/tag.ycgg.cc.cd.key;
   ```

2. **上传配置到服务器**：
   ```bash
   # 方式 1: 复制到 OpenResty 配置目录
   scp openresty-config.conf root@216.167.70.248:/etc/openresty/conf.d/luggage-tag.conf

   # 方式 2: 或添加到主配置文件
   # 在 /usr/local/openresty/nginx/conf/nginx.conf 的 http 块中引入：
   # include /etc/openresty/conf.d/*.conf;
   ```

3. **测试配置**：
   ```bash
   sudo openresty -t
   ```

4. **重新加载 OpenResty**：
   ```bash
   sudo openresty -s reload
   # 或
   sudo systemctl reload openresty
   ```

### 4️⃣ 启动后端服务

```bash
# 直接启动
npm run server

# 或使用 PM2 守护进程（推荐）
npm install -g pm2
pm2 start npm --name "luggage-tag" -- run server
pm2 save
pm2 startup
```

### 5️⃣ 验证部署

访问 `https://tag.ycgg.cc.cd` 并检查：

1. ✅ 前端页面正常加载
2. ✅ HTTPS 证书有效
3. ✅ API 请求成功（打开浏览器 DevTools > Network）
4. ✅ Cookie 认证正常工作
5. ✅ 健康检查：`https://tag.ycgg.cc.cd/health`

---

## 🔧 常见问题排查

### 问题 1: API 请求失败

```bash
# 检查后端是否启动
curl http://127.0.0.1:3001/health

# 检查进程
ps aux | grep node

# 检查端口监听
netstat -tlnp | grep 3001
```

### 问题 2: HTTPS 证书错误

确保：
- SSL 证书路径正确
- 证书文件权限正确（通常 644）
- 证书未过期

```bash
# 检查证书有效期
openssl x509 -in /path/to/cert.crt -noout -dates
```

### 问题 3: Cookie 认证失败

检查 `.env` 配置：
```bash
LUGGAGE_TAG_TRUST_PROXY=true
LUGGAGE_TAG_COOKIE_SECURE=true
```

### 问题 4: CORS 错误

检查浏览器控制台，确认：
```bash
LUGGAGE_TAG_ALLOW_ORIGIN=https://tag.ycgg.cc.cd
```

### 查看日志

```bash
# OpenResty 日志
tail -f /var/log/openresty/luggage-tag-error.log
tail -f /var/log/openresty/luggage-tag-access.log

# Node.js 日志（如使用 PM2）
pm2 logs luggage-tag
```

---

## 🔐 安全建议

1. ✅ **修改默认密码** - `.env` 中的 `SUPER_ADMIN_PASSWORD`
2. ✅ **使用 HTTPS** - 已配置
3. ✅ **定期备份数据库** - 默认每 6 小时自动备份
4. ✅ **限制 SSH 访问** - 使用密钥认证
5. ✅ **配置防火墙** - 仅开放必要端口（80, 443）
6. ✅ **定期更新依赖** - `npm audit` 检查漏洞

---

## 📊 生产环境监控

```bash
# 使用 PM2 监控
pm2 monit

# 查看应用状态
pm2 status

# 重启应用
pm2 restart luggage-tag

# 停止应用
pm2 stop luggage-tag
```

---

## 🎯 后端代理地址配置总结

**回答你的原始问题**：

> **后端代理地址应该填写什么？**

**答案：不需要填写！**

因为：
1. 前后端部署在同一域名 `https://tag.ycgg.cc.cd`
2. 前端会自动使用 `window.location.origin` 作为 API 地址
3. OpenResty 反向代理会将所有请求转发到后端 `127.0.0.1:3001`
4. 后端在生产模式下会自动服务 `dist/` 目录的前端文件

如果未来需要分离部署，才需要设置：
```bash
# .env.production
VITE_API_BASE=https://api.yourdomain.com
```

但你的当前部署架构**不需要**这个配置。
