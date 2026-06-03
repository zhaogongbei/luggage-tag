import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  dbPath, backupDir, exportDir,
  superAdminUsername, defaultAdminUsername, superAdminPassword,
  backupIntervalMs, backupRetention,
  tokenCleanupIntervalMs, auditLogRetention,
  exportCleanupIntervalMs, exportCleanupMinAgeMs,
  defaultSettings,
  dataDir, normalizePathForCompare, toRelativeExportPath, resolveStoredFilePath
} from "./config.js";

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER,
    order_no TEXT NOT NULL,
    template_id TEXT NOT NULL,
    customer_text TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    print_status TEXT NOT NULL DEFAULT 'pending',
    png_path TEXT NOT NULL,
    pdf_path TEXT NOT NULL,
    deleted_at TEXT,
    created_by INTEGER
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    event_date TEXT NOT NULL,
    current_number INTEGER NOT NULL,
    digits INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    user_id INTEGER,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_login_at TEXT
  );
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_event_id ON orders(event_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);
  CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at);
  CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
`);

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

const usingDefaultPassword = !process.env.SUPER_ADMIN_PASSWORD && !process.env.LUGGAGE_TAG_STAFF_PASSWORD && superAdminPassword === "admin123";
if (usingDefaultPassword) {
  console.warn("SECURITY WARNING: LUGGAGE_TAG_STAFF_PASSWORD is not set. Default password admin123 is unsafe for public deployment.");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, passwordHash) {
  const [method, saltHex, hashHex] = String(passwordHash ?? "").split(":");
  if (method !== "scrypt" || !saltHex || !hashHex) { return false; }
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch { return false; }
}

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((c) => c.name === columnName);
}

function migrateAuthTokensTable() {
  if (!hasColumn("auth_tokens", "user_id")) {
    db.prepare("ALTER TABLE auth_tokens ADD COLUMN user_id INTEGER").run();
  }
}

function migrateOrdersTable() {
  const orderTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
  const needsEventColumn = !hasColumn("orders", "event_id");
  const needsDeletedAtColumn = !hasColumn("orders", "deleted_at");
  const needsCreatedByColumn = !hasColumn("orders", "created_by");
  const hasGlobalUniqueOrderNo = /\border_no\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(orderTable?.sql ?? "");
  if (!needsEventColumn && !needsDeletedAtColumn && !needsCreatedByColumn && !hasGlobalUniqueOrderNo) { return; }
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.exec(`
      CREATE TABLE orders_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_id INTEGER, order_no TEXT NOT NULL,
        template_id TEXT NOT NULL, customer_text TEXT NOT NULL, generated_at TEXT NOT NULL,
        print_status TEXT NOT NULL DEFAULT 'pending', png_path TEXT NOT NULL,
        pdf_path TEXT NOT NULL, deleted_at TEXT, created_by INTEGER
      );
    `);
    const ec = needsEventColumn ? "NULL AS event_id" : "event_id";
    const dc = needsDeletedAtColumn ? "NULL AS deleted_at" : "deleted_at";
    const cc = needsCreatedByColumn ? "NULL AS created_by" : "created_by";
    db.exec(`
      INSERT INTO orders_next (id, event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, deleted_at, created_by)
      SELECT id, ${ec}, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, ${dc}, ${cc} FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_next RENAME TO orders;
    `);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

function ensureActiveEvent() {
  let activeEvent = db.prepare("SELECT * FROM events WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
  if (activeEvent) { return activeEvent; }
  const settings = db.prepare("SELECT key, value FROM settings").all();
  const settingsMap = Object.fromEntries(settings.map((r) => [r.key, r.value]));
  const prefix = String(settingsMap.prefix ?? defaultSettings.prefix).slice(0, 12);
  const currentNumber = Math.max(1, Number.parseInt(settingsMap.currentNumber ?? defaultSettings.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(settingsMap.digits ?? defaultSettings.digits, 10) || 4));
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const result = db.prepare(
    `INSERT INTO events (name, prefix, event_date, current_number, digits, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run("\u9ED8\u8BA4\u6D3B\u52A8", prefix, today, currentNumber, digits, now);
  activeEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
  db.prepare("UPDATE orders SET event_id = ? WHERE event_id IS NULL").run(activeEvent.id);
  return activeEvent;
}

function ensureDefaultSuperAdmin() {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(superAdminUsername);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, password_hash, role, status, created_by, created_at, updated_at) VALUES (?, ?, 'super_admin', 'active', NULL, ?, ?)`
    ).run(superAdminUsername, hashPassword(superAdminPassword), now, now);
  } else if (existing.role !== "super_admin" || existing.status !== "active") {
    db.prepare("UPDATE users SET role = 'super_admin', status = 'active', updated_at = ? WHERE id = ?").run(now, existing.id);
  }
  db.prepare("UPDATE users SET role = 'admin', updated_at = ? WHERE username != ? AND role = 'super_admin'").run(now, superAdminUsername);
  db.prepare("UPDATE users SET role = 'admin', status = 'active', updated_at = ? WHERE username = ? AND role != 'admin'").run(now, defaultAdminUsername);
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_super_admin ON users(role) WHERE role = 'super_admin'").run();
}

function migrateOrderFilePaths() {
  const hasAbsolute = db.prepare(
    "SELECT 1 FROM orders WHERE png_path LIKE '/%' OR png_path LIKE '_:%' OR pdf_path LIKE '/%' OR pdf_path LIKE '_:%' LIMIT 1"
  ).get();
  if (!hasAbsolute) { return; }
  const rows = db.prepare("SELECT id, png_path, pdf_path FROM orders").all();
  const updates = [];
  for (const order of rows) {
    const nextPng = toRelativeExportPath(order.png_path);
    const nextPdf = toRelativeExportPath(order.pdf_path);
    if (nextPng !== order.png_path || nextPdf !== order.pdf_path) {
      updates.push({ id: order.id, pngPath: nextPng, pdfPath: nextPdf });
    }
  }
  for (const u of updates) {
    db.prepare("UPDATE orders SET png_path = ?, pdf_path = ? WHERE id = ?").run(u.pngPath, u.pdfPath, u.id);
  }
}

migrateAuthTokensTable();
migrateOrdersTable();
ensureActiveEvent();
migrateOrderFilePaths();
ensureDefaultSuperAdmin();

function createTimestampForFilename(date = new Date()) {
  const pad = (v) => String(v).padStart(2, "0");
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate()), "-", pad(date.getHours()), pad(date.getMinutes())].join("");
}

async function cleanupBackups() {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = entries.filter((e) => e.isFile() && /^luggage-tag-\d{8}-\d{4}\.sqlite$/.test(e.name)).map((e) => e.name).sort().reverse();
  await Promise.allSettled(backups.slice(backupRetention).map((n) => fs.unlink(path.join(backupDir, n))));
}

async function backupDatabase() {
  try {
    const filename = `luggage-tag-${createTimestampForFilename()}.sqlite`;
    await fs.copyFile(dbPath, path.join(backupDir, filename));
    await cleanupBackups();
  } catch (e) { console.error("Failed to backup SQLite database", e); }
}
backupDatabase();
setInterval(backupDatabase, backupIntervalMs).unref();

function cleanupExpiredTokens() { db.prepare("DELETE FROM auth_tokens WHERE expires_at <= ?").run(Date.now()); }
setInterval(cleanupExpiredTokens, tokenCleanupIntervalMs).unref();

function cleanupAuditLogs() {
  db.prepare("DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)").run(auditLogRetention);
}
setInterval(cleanupAuditLogs, tokenCleanupIntervalMs).unref();

async function cleanupExportFiles() {
  try {
    const rows = db.prepare("SELECT png_path, pdf_path FROM orders").all();
    const usedPaths = new Set(
      rows.flatMap((o) => [o.png_path, o.pdf_path]).filter(Boolean)
        .map((fp) => normalizePathForCompare(
          path.isAbsolute(fp) ? fp :
          fp.replace(/\\/g, "/").startsWith("exports/") ? path.join(dataDir, fp) :
          path.join(exportDir, fp)
        ))
    );
    const entries = await fs.readdir(exportDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.allSettled(entries.filter((e) => e.isFile()).map(async (e) => {
      const fp = path.join(exportDir, e.name);
      if (usedPaths.has(normalizePathForCompare(fp))) { return; }
      const stat = await fs.stat(fp);
      if (now - stat.mtimeMs >= exportCleanupMinAgeMs) { await fs.unlink(fp); }
    }));
  } catch (e) { console.error("Failed to cleanup export files", e); }
}
setInterval(cleanupExportFiles, exportCleanupIntervalMs).unref();

function getActiveEvent() { return ensureActiveEvent(); }

function toPublicEvent(event) {
  if (!event) { return null; }
  return { id: event.id, name: event.name, prefix: event.prefix, eventDate: event.event_date, currentNumber: Number(event.current_number), digits: Number(event.digits), createdAt: event.created_at, isActive: Boolean(event.is_active) };
}

function formatEventOrderNo(event) { return `${event.prefix}${String(event.current_number).padStart(event.digits, "0")}`; }

function syncLegacyNumberSettings(event) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'prefix'").run(event.prefix);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'currentNumber'").run(String(event.current_number));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'digits'").run(String(event.digits));
}

async function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const activeEvent = getActiveEvent();
  return {
    prefix: activeEvent.prefix, currentNumber: Number(activeEvent.current_number), digits: Number(activeEvent.digits),
    watermarkEnabled: (settings.watermarkEnabled ?? defaultSettings.watermarkEnabled) === "true",
    creatorAutoPrint: (settings.creatorAutoPrint ?? defaultSettings.creatorAutoPrint) === "true",
    creatorAutoReturn: (settings.creatorAutoReturn ?? defaultSettings.creatorAutoReturn) === "true",
    selectedPrinter: settings.selectedPrinter ?? defaultSettings.selectedPrinter,
    deploymentMode: ["private", "invite", "public", "maintenance"].includes(settings.deploymentMode) ? settings.deploymentMode : defaultSettings.deploymentMode,
    inviteCode: settings.inviteCode ?? defaultSettings.inviteCode,
    activeEvent: toPublicEvent(activeEvent)
  };
}

function toClientSettings(s) {
  return { prefix: s.prefix, currentNumber: s.currentNumber, digits: s.digits, watermarkEnabled: s.watermarkEnabled, creatorAutoPrint: s.creatorAutoPrint, creatorAutoReturn: s.creatorAutoReturn, deploymentMode: s.deploymentMode, activeEvent: s.activeEvent };
}

function normalizeEventPayload(body) {
  const name = String(body.name ?? "").trim().slice(0, 80);
  const prefix = String(body.prefix ?? "No.").trim().slice(0, 12) || "No.";
  const eventDate = String(body.eventDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const startNumber = Math.max(1, Number.parseInt(body.startNumber ?? body.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(body.digits, 10) || 4));
  if (!name) { throw new Error("\u6D3B\u52A8\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A"); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) { throw new Error("\u6D3B\u52A8\u65E5\u671F\u683C\u5F0F\u65E0\u6548"); }
  return { name, prefix, eventDate, startNumber, digits };
}

function getOrderById(orderId, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  const user = options.user ?? null;
  const oc = user?.role === "client" ? "AND orders.created_by = ?" : "";
  const sql = `SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username FROM orders LEFT JOIN events ON events.id = orders.event_id LEFT JOIN users ON users.id = orders.created_by WHERE orders.id = ? ${includeDeleted ? "" : "AND orders.deleted_at IS NULL"} ${oc}`;
  const params = user?.role === "client" ? [orderId, user.id] : [orderId];
  return db.prepare(sql).get(...params);
}

function getOrdersByIds(orderIds, options = {}) {
  if (!orderIds.length) { return []; }
  const user = options.user ?? null;
  const ph = orderIds.map(() => "?").join(",");
  const oc = user?.role === "client" ? "AND orders.created_by = ?" : "";
  const rows = db.prepare(`SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username FROM orders LEFT JOIN events ON events.id = orders.event_id LEFT JOIN users ON users.id = orders.created_by WHERE orders.id IN (${ph}) AND orders.deleted_at IS NULL ${oc}`).all(...(user?.role === "client" ? [...orderIds, user.id] : orderIds));
  const byId = new Map(rows.map((o) => [o.id, o]));
  return orderIds.map((id) => byId.get(id)).filter(Boolean);
}

function parseOrderIds(value) {
  const rawIds = Array.isArray(value) ? value : String(value ?? "").split(",");
  return rawIds.map((id) => Number.parseInt(id, 10)).filter((id, i, a) => Number.isInteger(id) && id > 0 && a.indexOf(id) === i);
}

function toPublicOrder(order) {
  if (!order) { return null; }
  return { id: order.id, event_id: order.event_id, event_name: order.event_name ?? "", event_date: order.event_date ?? "", order_no: order.order_no, template_id: order.template_id, customer_text: order.customer_text, generated_at: order.generated_at, print_status: order.print_status, deleted_at: order.deleted_at ?? "", created_by: order.created_by ?? null, creator_username: order.creator_username ?? "" };
}

function writeAuditLogEntry(req, actor, action, targetType = "", targetId = "", detail = {}) {
  const ip = String(req?.headers?.["x-forwarded-for"] ?? req?.socket?.remoteAddress ?? "unknown").split(",")[0].trim();
  db.prepare(`INSERT INTO audit_logs (user_id, username, role, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(actor?.id ?? null, actor?.username ?? "", actor?.role ?? "", action, targetType, String(targetId ?? ""), JSON.stringify(detail ?? {}), ip, new Date().toISOString());
}

async function getBrandLogoPath() {
  const { brandLogoCandidates: candidates } = await import("./config.js");
  for (const lp of candidates) {
    try { await fs.access(lp); return lp; } catch { /* next */ }
  }
  return "";
}


export {
  db, usingDefaultPassword, hashPassword, verifyPassword,
  getSettings, toClientSettings, getActiveEvent, toPublicEvent,
  formatEventOrderNo, syncLegacyNumberSettings, normalizeEventPayload,
  getOrderById, getOrdersByIds, parseOrderIds, toPublicOrder,
  getBrandLogoPath, writeAuditLogEntry
};