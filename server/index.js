import express from "express";
import cors from "cors";
import path from "node:path";
import crypto from "node:crypto";
import helmet from "helmet";

import {
  rootDir, port, host, allowedOrigins,
  sessionCookieName, inviteCookieName, sessionTtlMs, inviteTtlMs, loginMaxFailures, loginLockMs,
  deploymentModes, defaultLayoutOptions, resolveStoredFilePath,
  allowDefaultPasswordOnPublicHost, normalizeTicketPrintLayout
} from "./config.js";

import {
  db, usingDefaultPassword, hashPassword, verifyPassword,
  getSettings, toClientSettings, getActiveEvent, toPublicEvent,
  formatEventOrderNo, syncLegacyNumberSettings, normalizeEventPayload,
  getOrderById, getOrdersByIds, parseOrderIds, toPublicOrder,
  getBrandLogoPath
} from "./db.js";

import {
  getRequestIp, inviteFailures,
  getLoginFailure, recordLoginFailure, clearLoginFailure, getInviteFailure,
  parseCookies, createToken, deleteToken,
  setSessionCookie, setInviteCookie, clearAuthCookies,
  createOrderAccessToken, setOrderAccessCookie, hasOrderAccess,
  toPublicUser, isStaffRequest,
  normalizeUsername, normalizePassword, normalizeUserRole,
  normalizeRequestedUserRole, validateUserRoleRequest, normalizeUserStatus,
  assertCanChangeUser, writeAuditLog, writeAuditLogEntry, getRequestUser
} from "./auth.js";

import { createOrderFromPayload } from "./orders.js";
import { createTicketPdfBuffer, createImpositionPdf, computeImpositionLayout } from "./pdf.js";
import { getSystemPrinters, printTicketDirect, printOrderTicket } from "./printing.js";
import { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess, rateLimitMiddleware } from "./middleware.js";

function sendServerError(res, err, fallbackMsg, errorCode = "INTERNAL_ERROR") {
  const statusCode = 500;
  const timestamp = new Date().toISOString();
  const requestId = crypto.randomBytes(8).toString("hex");
  console.error(JSON.stringify({
    timestamp, requestId, errorCode, statusCode,
    message: err?.message || fallbackMsg,
    stack: process.env.NODE_ENV === "development" ? err?.stack : undefined
  }));
  const message = process.env.NODE_ENV === "production" ? fallbackMsg : (err?.message || fallbackMsg);
  res.status(statusCode).json({ errorCode, message, requestId });
}

function isAllowedOrigin(origin, req) {
  if (!origin) { return true; }
  if (allowedOrigins.includes(origin)) { return true; }
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  const requestHost = String(req.headers.host ?? "").split(":")[0];
  if (requestHost && parsed.hostname === requestHost) { return true; }
  const hostname = parsed.hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) { return true; }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) { return true; }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) { return true; }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) { return true; }
  return false;
}

function isPublicHostBinding() {
  return ["0.0.0.0", "::", "[::]"].includes(String(host).toLowerCase());
}

function saveSetting(key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, String(value));
}

function withTicketLayoutProductDefaults(layoutOptions, printLayout) {
  return {
    ...layoutOptions,
    productWidth: layoutOptions.productWidth ?? printLayout.widthMm,
    productHeight: layoutOptions.productHeight ?? printLayout.heightMm
  };
}

function canAccessCustomerOrder(req, order) {
  const user = getRequestUser(req);
  if (user && ["super_admin", "admin"].includes(user.role)) { return true; }
  if (user?.role === "client" && Number(order.created_by) === Number(user.id)) { return true; }
  return hasOrderAccess(req, order.id);
}

function issueOrderAccessCookie(req, res, orderId) {
  setOrderAccessCookie(req, res, orderId, createOrderAccessToken(orderId));
}

const app = express();
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin, req)) {
    return res.status(403).json({ message: "CORS origin not allowed" });
  }
  next();
});
app.use(cors((req, callback) => {
  const origin = req.headers.origin;
  const allowOrigin = !origin || isAllowedOrigin(origin, req);
  callback(null, { credentials: true, origin: allowOrigin });
}));
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "*"], // 局域网多端访问；如可收敛请按部署域名收紧
    }
  }
}));
app.use(express.json({ limit: "12mb" }));

// 全局速率限制
app.use("/api/orders", rateLimitMiddleware("orders", 200, 60_000));
app.use("/api/orders/imposition", rateLimitMiddleware("imposition", 20, 60_000));
app.use("/api/orders/a4-layout", rateLimitMiddleware("a4layout", 20, 60_000));
app.use("/api/layout/preview", rateLimitMiddleware("preview", 100, 60_000));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(rootDir, "dist")));
}

app.get("/brand-logo", async (_req, res) => {
  const logoPath = await getBrandLogoPath();
  if (!logoPath) { return res.status(404).send("Brand logo not found"); }
  // 允许跨域加载 Logo（开发环境前后端端口不同）
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.sendFile(logoPath);
});

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

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "");
  const { ip, failure } = getLoginFailure(req);
  if (failure.lockedUntil > Date.now()) {
    const retrySeconds = Math.ceil((failure.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ message: `\u767B\u5F55\u5931\u8D25\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 ${retrySeconds} \u79D2\u540E\u518D\u8BD5` });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || user.status !== "active" || !verifyPassword(password, user.password_hash)) {
    const nextFailure = recordLoginFailure(ip, failure);
    if (nextFailure.lockedUntil > Date.now()) {
      const retrySeconds = Math.ceil((nextFailure.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ message: `\u767B\u5F55\u5931\u8D25\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 ${retrySeconds} \u79D2\u540E\u518D\u8BD5` });
    }
    return res.status(401).json({ message: "\u8D26\u53F7\u6216\u5BC6\u7801\u9519\u8BEF" });
  }
  clearLoginFailure(ip);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);
  setSessionCookie(req, res, createToken("staff", sessionTtlMs, user.id));
  writeAuditLogEntry(req, user, "auth.login", "user", user.id, { username: user.username, role: user.role });
  const settings = await getSettings();
  res.json({
    authenticated: ["super_admin", "admin"].includes(user.role),
    sessionAuthenticated: true, invited: false,
    role: user.role,
    user: { id: user.id, username: user.username, role: user.role, status: user.status },
    customerAccess: settings.deploymentMode !== "maintenance",
    deploymentMode: settings.deploymentMode,
    forcePasswordChange: usingDefaultPassword
  });
});

app.post("/api/auth/invite", async (req, res) => {
  const ip = getRequestIp(req);
  const inviteFailure = getInviteFailure(ip);
  if (inviteFailure.lockedUntil > Date.now()) {
    const retrySeconds = Math.ceil((inviteFailure.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ message: `\u5C1D\u8BD5\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 ${retrySeconds} \u79D2\u540E\u518D\u8BD5` });
  }
  const settings = await getSettings();
  const inviteCode = String(req.body.inviteCode ?? "").trim();
  if (settings.deploymentMode !== "invite" || !settings.inviteCode || inviteCode !== settings.inviteCode) {
    const next = { count: inviteFailure.count + 1, lockedUntil: 0 };
    if (next.count >= loginMaxFailures) { next.lockedUntil = Date.now() + loginLockMs; }
    inviteFailures.set(ip, next);
    if (next.lockedUntil > Date.now()) {
      const retrySeconds = Math.ceil((next.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ message: `\u5C1D\u8BD5\u6B21\u6570\u8FC7\u591A\uFF0C\u8BF7 ${retrySeconds} \u79D2\u540E\u518D\u8BD5` });
    }
    return res.status(401).json({ message: "\u9080\u8BF7\u7801\u65E0\u6548" });
  }
  inviteFailures.delete(ip);
  setInviteCookie(req, res, createToken("invite", inviteTtlMs));
  res.json({ authenticated: false, invited: true, customerAccess: true, deploymentMode: settings.deploymentMode });
});

app.post("/api/auth/logout", async (req, res) => {
  const cookies = parseCookies(req);
  writeAuditLog(req, "auth.logout", "user", getRequestUser(req)?.id ?? "", {});
  deleteToken("staff", cookies[sessionCookieName]);
  deleteToken("invite", cookies[inviteCookieName]);
  clearAuthCookies(req, res);
  res.json({ ok: true });
});

// ---- User routes ----
app.get("/api/users", requireRole(["super_admin"]), async (_req, res) => {
  const users = db.prepare(`SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users ORDER BY id ASC`).all();
  res.json(users.map(toPublicUser));
});

app.post("/api/users", requireRole(["super_admin"]), async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  const requestedRole = normalizeUserRole(req.body.role);
  const role = normalizeRequestedUserRole(username, requestedRole);
  const status = normalizeUserStatus(req.body.status);
  if (!username || username.length < 3) { return res.status(400).json({ message: "\u8D26\u53F7\u81F3\u5C11\u9700\u8981 3 \u4E2A\u5B57\u7B26" }); }
  if (password.length < 6) { return res.status(400).json({ message: "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 6 \u4E2A\u5B57\u7B26" }); }
  try {
    validateUserRoleRequest(username, requestedRole);
    const now = new Date().toISOString();
    const actor = getRequestUser(req);
    const result = db.prepare(
      `INSERT INTO users (username, password_hash, role, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(username, hashPassword(password), role, status, actor.id, now, now);
    const user = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(result.lastInsertRowid);
    writeAuditLog(req, "users.create", "user", user.id, { username: user.username, role: user.role, status: user.status });
    res.status(201).json(toPublicUser(user));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) { return res.status(409).json({ message: "\u8D26\u53F7\u5DF2\u5B58\u5728" }); }
    console.error(error); res.status(500).json({ message: "\u8D26\u53F7\u521B\u5EFA\u5931\u8D25" });
  }
});

app.patch("/api/users/:id", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const username = normalizeUsername(req.body.username ?? targetUser?.username);
  const requestedRole = normalizeUserRole(req.body.role ?? targetUser?.role);
  const role = normalizeRequestedUserRole(username, requestedRole);
  const status = normalizeUserStatus(req.body.status ?? targetUser?.status);
  if (!username || username.length < 3) { return res.status(400).json({ message: "\u8D26\u53F7\u81F3\u5C11\u9700\u8981 3 \u4E2A\u5B57\u7B26" }); }
  try {
    validateUserRoleRequest(username, requestedRole);
    assertCanChangeUser(req, targetUser, role, status);
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, updated_at = ? WHERE id = ?").run(username, role, status, new Date().toISOString(), userId);
    const nextUser = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(userId);
    if (status === "disabled") { db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId); }
    writeAuditLog(req, "users.update", "user", userId, { username, role, status });
    res.json(toPublicUser(nextUser));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) { return res.status(409).json({ message: "\u8D26\u53F7\u5DF2\u5B58\u5728" }); }
    res.status(400).json({ message: error.message || "\u8D26\u53F7\u66F4\u65B0\u5931\u8D25" });
  }
});

app.post("/api/users/:id/reset-password", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const password = normalizePassword(req.body.password);
  if (!targetUser) { return res.status(404).json({ message: "\u8D26\u53F7\u4E0D\u5B58\u5728" }); }
  if (password.length < 6) { return res.status(400).json({ message: "\u5BC6\u7801\u81F3\u5C11\u9700\u8981 6 \u4E2A\u5B57\u7B26" }); }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), new Date().toISOString(), userId);
  db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
  writeAuditLog(req, "users.reset_password", "user", userId, { username: targetUser.username });
  res.json({ ok: true });
});

app.delete("/api/users/:id", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const actor = getRequestUser(req);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!targetUser) { return res.status(404).json({ message: "\u8D26\u53F7\u4E0D\u5B58\u5728" }); }
  if (targetUser.id === actor.id) { return res.status(400).json({ message: "Super Admin \u4E0D\u80FD\u5220\u9664\u81EA\u5DF1" }); }
  try {
    assertCanChangeUser(req, targetUser, "deleted", "disabled");
    db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    writeAuditLog(req, "users.delete", "user", userId, { username: targetUser.username, role: targetUser.role });
    res.json({ ok: true });
  } catch (error) { res.status(400).json({ message: error.message || "\u8D26\u53F7\u5220\u9664\u5931\u8D25" }); }
});

app.get("/api/audit-logs", requireRole(["super_admin"]), async (_req, res) => {
  const logs = db.prepare(`SELECT id, user_id, username, role, action, target_type, target_id, detail, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 300`).all();
  res.json(logs.map((log) => ({ ...log, detail: (() => { try { return JSON.parse(log.detail || "{}"); } catch { return {}; } })() })));
});
// ---- Settings routes ----
app.get("/api/settings", requireSettingsAccess, async (req, res) => {
  const settings = await getSettings();
  res.json({ ...toClientSettings(settings), ...(isStaffRequest(req) ? { selectedPrinter: settings.selectedPrinter, inviteCode: settings.inviteCode } : {}) });
});

app.put("/api/settings", requireRole(["super_admin"]), async (req, res) => {
  const currentSettings = await getSettings();
  const prefix = String(req.body.prefix ?? "No.").slice(0, 12);
  const currentNumber = Math.max(1, Number.parseInt(req.body.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(req.body.digits, 10) || 4));
  const watermarkEnabled = Boolean(req.body.watermarkEnabled);
  const creatorAutoPrint = Boolean(req.body.creatorAutoPrint);
  const creatorAutoReturn = Boolean(req.body.creatorAutoReturn);
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  const deploymentMode = deploymentModes.includes(req.body.deploymentMode) ? req.body.deploymentMode : "private";
  const inviteCode = String(req.body.inviteCode ?? "").slice(0, 64);
  const ticketLayout = normalizeTicketPrintLayout(req.body.ticketPrintLayout ?? {}, currentSettings.ticketPrintLayout);
  saveSetting("prefix", prefix);
  saveSetting("currentNumber", currentNumber);
  saveSetting("digits", digits);
  db.prepare("UPDATE events SET prefix = ?, current_number = ?, digits = ? WHERE id = ?").run(prefix, currentNumber, digits, getActiveEvent().id);
  saveSetting("watermarkEnabled", watermarkEnabled);
  saveSetting("creatorAutoPrint", creatorAutoPrint);
  saveSetting("creatorAutoReturn", creatorAutoReturn);
  saveSetting("selectedPrinter", selectedPrinter);
  saveSetting("deploymentMode", deploymentMode);
  saveSetting("inviteCode", inviteCode);
  saveSetting("ticketWidthMm", ticketLayout.widthMm);
  saveSetting("ticketHeightMm", ticketLayout.heightMm);
  saveSetting("ticketTopOffsetMm", ticketLayout.topOffsetMm);
  saveSetting("ticketPaddingTopMm", ticketLayout.paddingTopMm);
  saveSetting("ticketNameFontSize", ticketLayout.nameFontSize);
  saveSetting("ticketSerialFontSize", ticketLayout.serialFontSize);
  saveSetting("ticketTimeFontSize", ticketLayout.timeFontSize);
  saveSetting("ticketNameMarginBottomMm", ticketLayout.nameMarginBottomMm);
  saveSetting("ticketSerialMarginBottomMm", ticketLayout.serialMarginBottomMm);
  saveSetting("ticketContentAlign", ticketLayout.contentAlign);
  writeAuditLog(req, "settings.update", "settings", "system", { deploymentMode, creatorAutoPrint, creatorAutoReturn, ticketPrintLayout: ticketLayout });
  res.json(await getSettings());
});

app.post("/api/events/reset", requireRole(["super_admin"]), async (req, res) => {
  try {
    const event = normalizeEventPayload(req.body);
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    db.prepare("UPDATE events SET is_active = 0").run();
    const result = db.prepare(`INSERT INTO events (name, prefix, event_date, current_number, digits, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`).run(event.name, event.prefix, event.eventDate, event.startNumber, event.digits, now);
    const activeEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
    syncLegacyNumberSettings(activeEvent);
    db.exec("COMMIT");
    writeAuditLog(req, "events.reset", "event", activeEvent.id, { name: activeEvent.name, prefix: activeEvent.prefix, currentNumber: activeEvent.current_number, digits: activeEvent.digits });
    res.json({ event: toPublicEvent(activeEvent), settings: await getSettings() });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    res.status(400).json({ message: error.message || "\u65B0\u6D3B\u52A8\u91CD\u7F6E\u5931\u8D25" });
  }
});

app.get("/api/preview-number", requireCustomerAccess, async (_req, res) => {
  const settings = await getSettings();
  const activeEvent = getActiveEvent();
  res.json({ orderNo: formatEventOrderNo(activeEvent), settings: toClientSettings(settings) });
});

// ---- Order routes ----
app.get("/api/orders", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const includeDeleted = req.query.deleted === "true";
  const user = getRequestUser(req);
  const ownershipClause = user.role === "client" ? "AND orders.created_by = ?" : "";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const params = user.role === "client" ? [user.id] : [];
  const rows = db.prepare(`SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username FROM orders LEFT JOIN events ON events.id = orders.event_id LEFT JOIN users ON users.id = orders.created_by WHERE ${includeDeleted ? "orders.deleted_at IS NOT NULL" : "orders.deleted_at IS NULL"} ${ownershipClause} ORDER BY orders.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE ${includeDeleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"} ${ownershipClause}`).get(...params);
  res.json({ orders: rows.map(toPublicOrder), page, pageSize, total: Number(total?.count ?? 0) });
});

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

app.post("/api/layout/preview", requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const settings = await getSettings();
    const layout = computeImpositionLayout(withTicketLayoutProductDefaults(req.body.layoutOptions ?? req.body, settings.ticketPrintLayout));
    res.json({ paperWidth: layout.pageWidth, paperHeight: layout.pageHeight, productWidth: layout.itemWidth, productHeight: layout.itemHeight, columns: layout.columns, rows: layout.rows, capacity: layout.capacity, autoRotated: layout.itemRotated, pageRotated: layout.pageRotated, gap: layout.gap, margin: layout.margin, showOrderNo: layout.showOrderNo, cropMarks: layout.cropMarks, labelHeight: layout.labelHeight, positions: layout.positions });
  } catch (error) { res.status(400).json({ message: error.message }); }
});

app.post("/api/orders/imposition", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) { return res.status(400).json({ message: "Select at least one order" }); }
  try {
    const settings = await getSettings();
    const layoutOptions = withTicketLayoutProductDefaults(req.body.layoutOptions ?? req.body, settings.ticketPrintLayout);
    const layout = computeImpositionLayout(layoutOptions);
    const pdfBuffer = await createImpositionPdf(orders, layoutOptions, settings.ticketPrintLayout);
    const filename = `imposition-${layout.paperPreset.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    writeAuditLog(req, "orders.imposition", "orders", orderIds.join(","), { count: orders.length, paperPreset: layout.paperPreset });
    res.send(pdfBuffer);
  } catch (error) { sendServerError(res, error, "Failed to create imposition PDF", "PDF_GENERATION_FAILED"); }
});

app.post("/api/orders/a4-layout", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) { return res.status(400).json({ message: "Select at least one order" }); }
  try {
    const settings = await getSettings();
    const pdfBuffer = await createImpositionPdf(orders, { ...defaultLayoutOptions, productWidth: settings.ticketPrintLayout.widthMm, productHeight: settings.ticketPrintLayout.heightMm, ...(req.body.layoutOptions ?? {}), showOrderNo: req.body.showOrderNo !== false }, settings.ticketPrintLayout);
    const filename = `a4-layout-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) { sendServerError(res, error, "Failed to create A4 layout PDF", "PDF_GENERATION_FAILED"); }
});

app.get("/api/orders/batch", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.query.ids);
  const orders = getOrdersByIds(orderIds);
  const settings = await getSettings();
  res.json(orders.map((order) => ({ ...toPublicOrder(order), ticketPrintLayout: settings.ticketPrintLayout })));
});

app.get("/api/orders/:id", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true, user: getRequestUser(req) });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  const settings = await getSettings();
  res.json({ ...toPublicOrder(order), ticketPrintLayout: settings.ticketPrintLayout });
});

app.get("/api/orders/:id/ticket", requireCustomerAccess, async (req, res) => {
  const user = getRequestUser(req);
  const order = getOrderById(req.params.id, { includeDeleted: false, user });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  if (!canAccessCustomerOrder(req, order)) { return res.status(403).json({ message: "Order access denied" }); }
  const settings = await getSettings();
  res.json({ ...toPublicOrder(order), ticketPrintLayout: settings.ticketPrintLayout });
});

app.post("/api/orders", requireCustomerAccess, async (req, res) => {
  try {
    const created = await createOrderFromPayload(req);
    issueOrderAccessCookie(req, res, created.id);
    res.status(201).json({ id: created.id, orderNo: created.orderNo, generatedAt: created.generatedAt });
  } catch (error) { console.error(error); res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Failed to create order" }); }
});

app.post("/api/orders/direct-print", requireCustomerAccess, async (req, res) => {
  let created;
  try { created = await createOrderFromPayload(req); }
  catch (error) { console.error(error); return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Failed to create order" }); }
  const order = getOrderById(created.id, { includeDeleted: false, user: getRequestUser(req) });
  issueOrderAccessCookie(req, res, order.id);
  try {
    const result = await printOrderTicket(order);
    db.prepare("UPDATE orders SET print_status = 'printed' WHERE id = ? AND deleted_at IS NULL").run(order.id);
    writeAuditLog(req, "orders.direct_print", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.status(201).json({ ok: true, id: order.id, orderNo: order.order_no, generatedAt: order.generated_at, printerName: result.printerName, printStatus: "printed", message: `\u6253\u5370\u5DF2\u53D1\u9001\uFF1A${result.printerName}` });
  } catch (error) { console.error(error); writeAuditLog(req, "orders.direct_print_failed", "order", order.id, { orderNo: order.order_no, error: error.message }); res.status(500).json({ ok: false, message: process.env.NODE_ENV === "production" ? `\u6253\u5370\u5931\u8D25\uFF1B\u8BA2\u5355 ${order.order_no} \u5DF2\u4FDD\u5B58\uFF0C\u8BF7\u68C0\u67E5\u6253\u5370\u673A\u540E\u5230\u540E\u53F0\u91CD\u6253` : `\u6253\u5370\u5931\u8D25\uFF1A${error.message}\uFF1B\u8BA2\u5355 ${order.order_no} \u5DF2\u4FDD\u5B58\uFF0C\u8BF7\u68C0\u67E5\u6253\u5370\u673A\u540E\u5230\u540E\u53F0\u91CD\u6253`, id: order.id, orderNo: order.order_no, generatedAt: order.generated_at, printStatus: "pending" }); }
});

app.patch("/api/orders/:id/print-status", requireRole(["super_admin", "admin"]), async (req, res) => {
  const status = req.body.printStatus === "printed" ? "printed" : "pending";
  db.prepare("UPDATE orders SET print_status = ? WHERE id = ? AND deleted_at IS NULL").run(status, req.params.id);
  const order = getOrderById(req.params.id);
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  writeAuditLog(req, "orders.print_status", "order", order.id, { orderNo: order.order_no, printStatus: status });
  res.json(toPublicOrder(order));
});

app.delete("/api/orders/:id", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  db.prepare("UPDATE orders SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  writeAuditLog(req, "orders.delete", "order", order.id, { orderNo: order.order_no });
  res.json({ ok: true, order: toPublicOrder(order) });
});

app.patch("/api/orders/:id/restore", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  db.prepare("UPDATE orders SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  writeAuditLog(req, "orders.restore", "order", order.id, { orderNo: order.order_no });
  res.json(toPublicOrder(getOrderById(req.params.id)));
});

// ---- Printer routes ----
app.get("/api/printers", requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const refresh = req.query.refresh === "true";
    const printers = await getSystemPrinters({ refresh });
    const settings = await getSettings();
    res.json({ printers, defaultPrinter: printers.find((p) => p.isDefault)?.name ?? "", selectedPrinter: settings.selectedPrinter });
  } catch (error) { sendServerError(res, error, "Failed to read printers", "PRINTER_READ_FAILED"); res.json({ printers: [], defaultPrinter: "", selectedPrinter: "" }); }
});

app.put("/api/printers/selected", requireRole(["super_admin"]), async (req, res) => {
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  writeAuditLog(req, "printers.select", "printer", selectedPrinter, {});
  res.json({ selectedPrinter });
});

app.post("/api/printers/test", requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const testOrder = { order_no: "TEST-PRINT", customer_text: "TEST", generated_at: new Date().toISOString() };
    const result = await printTicketDirect(testOrder, String(req.body?.printerName ?? ""));
    writeAuditLog(req, "printers.test", "printer", result.printerName, {});
    res.json({ ok: true, message: `\u6D4B\u8BD5\u6253\u5370\u5DF2\u53D1\u9001\uFF1A${result.printerName}`, printerName: result.printerName });
  } catch (error) { sendServerError(res, error, "测试打印失败", "PRINT_TEST_FAILED"); }
});

app.post("/api/orders/:id/print", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  if (order.deleted_at) { return res.status(409).json({ message: "\u8BA2\u5355\u5DF2\u5728\u56DE\u6536\u7AD9\uFF0C\u8BF7\u5148\u6062\u590D\u540E\u518D\u6253\u5370" }); }
  try {
    const result = await printOrderTicket(order, String(req.body?.printerName ?? ""));
    db.prepare("UPDATE orders SET print_status = 'printed' WHERE id = ? AND deleted_at IS NULL").run(order.id);
    const updatedOrder = getOrderById(req.params.id, { includeDeleted: true });
    writeAuditLog(req, "orders.print", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.json({ ok: true, message: `\u6253\u5370\u5DF2\u53D1\u9001\uFF1A${result.printerName}`, printerName: result.printerName, order: toPublicOrder(updatedOrder) });
  } catch (error) { console.error(error); res.status(500).json({ message: process.env.NODE_ENV === "production" ? `\u6253\u5370\u5931\u8D25` : `\u6253\u5370\u5931\u8D25\uFF1A${error.message}`, order: toPublicOrder(order) }); }
});

app.post("/api/orders/:id/print-ticket", requireCustomerAccess, async (req, res) => {
  const user = getRequestUser(req);
  const order = getOrderById(req.params.id, { includeDeleted: false, user });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  if (!canAccessCustomerOrder(req, order)) { return res.status(403).json({ message: "Order access denied" }); }
  try {
    const result = await printOrderTicket(order, String(req.body?.printerName ?? ""));
    db.prepare("UPDATE orders SET print_status = 'printed' WHERE id = ? AND deleted_at IS NULL").run(order.id);
    const updatedOrder = getOrderById(req.params.id, { includeDeleted: false, user });
    writeAuditLog(req, "orders.print_ticket", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.json({ ok: true, message: `\u6253\u5370\u5DF2\u53D1\u9001\uFF1A${result.printerName}`, printerName: result.printerName, order: toPublicOrder(updatedOrder) });
  } catch (error) { console.error(error); res.status(500).json({ message: process.env.NODE_ENV === "production" ? `\u6253\u5370\u5931\u8D25` : `\u6253\u5370\u5931\u8D25\uFF1A${error.message}`, order: toPublicOrder(order) }); }
});

// ---- Download routes ----
app.get("/api/orders/:id/download/:type", requireRole(["super_admin", "admin"]), async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) { return res.status(400).json({ message: "Unsupported download type" }); }
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  if (type === "pdf") {
    const settings = await getSettings();
    const pdfBuffer = createTicketPdfBuffer(order, settings.ticketPrintLayout);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${order.order_no}.pdf"`);
    return res.send(pdfBuffer);
  }
  res.download(resolveStoredFilePath(order.png_path), `${order.order_no}.png`);
});

app.get("/api/orders/:id/file/:type", requireRole(["super_admin", "admin"]), async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) { return res.status(400).json({ message: "Unsupported file type" }); }
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) { return res.status(404).json({ message: "Order not found" }); }
  if (type === "pdf") {
    const settings = await getSettings();
    res.type("pdf");
    return res.send(createTicketPdfBuffer(order, settings.ticketPrintLayout));
  }
  const filePath = resolveStoredFilePath(order.png_path);
  res.type(type);
  res.sendFile(filePath);
});

// ---- Production SPA fallback + error handler + listen ----
if (process.env.NODE_ENV === "production") {
  app.get("/{*splat}", (_req, res) => { res.sendFile(path.join(rootDir, "dist", "index.html")); });
}

app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

if (usingDefaultPassword && isPublicHostBinding() && !allowDefaultPasswordOnPublicHost) {
  throw new Error("Refusing to start with the default staff password on a public host binding. Set LUGGAGE_TAG_STAFF_PASSWORD or bind to 127.0.0.1.");
}

app.listen(port, host, () => {
  console.log(`API server running at http://${host}:${port}`);
  if (host === "127.0.0.1" || host === "localhost") {
    console.log("Private deployment mode: API server is bound to localhost only. Set LUGGAGE_TAG_HOST=0.0.0.0 to expose on LAN/public networks.");
  } else if (usingDefaultPassword) {
    console.warn("SECURITY WARNING: Public host binding is using the default staff password because LUGGAGE_TAG_ALLOW_DEFAULT_PASSWORD_ON_PUBLIC_HOST=true.");
  }
});
