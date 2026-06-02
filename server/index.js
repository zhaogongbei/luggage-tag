import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { jsPDF } from "jspdf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.LUGGAGE_TAG_DATA_DIR
  ? path.resolve(process.env.LUGGAGE_TAG_DATA_DIR)
  : path.join(rootDir, "data");
const exportDir = path.join(dataDir, "exports");
const backupDir = path.join(dataDir, "backups");
const dbPath = path.join(dataDir, "luggage-tag.sqlite");
const port = Number(process.env.PORT || 3001);
const host = process.env.LUGGAGE_TAG_HOST || process.env.HOST || "0.0.0.0";
const execFileAsync = promisify(execFile);
const sessionCookieName = "luggage_tag_session";
const inviteCookieName = "luggage_tag_invite";
const sessionTtlMs = 1000 * 60 * 60 * 12;
const inviteTtlMs = 1000 * 60 * 60 * 24;
const superAdminUsername = "gongbei";
const defaultAdminUsername = "admin";
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.LUGGAGE_TAG_STAFF_PASSWORD || "admin123";
const loginFailures = new Map();
const loginMaxFailures = Math.max(3, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_MAX_FAILURES ?? "5", 10) || 5);
const loginLockMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_LOCK_MS ?? "300000", 10) || 300_000);
const backupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_INTERVAL_MS ?? "21600000", 10) || 21_600_000);
const backupRetention = Math.max(1, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_RETENTION ?? "24", 10) || 24);
const exportCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_INTERVAL_MS ?? "86400000", 10) || 86_400_000);
const exportCleanupMinAgeMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_MIN_AGE_MS ?? "604800000", 10) || 604_800_000);
const tokenCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_TOKEN_CLEANUP_INTERVAL_MS ?? "3600000", 10) || 3_600_000);
const auditLogRetention = Math.max(1000, Number.parseInt(process.env.LUGGAGE_TAG_AUDIT_RETENTION ?? "5000", 10) || 5000);
const forceSecureCookie = process.env.LUGGAGE_TAG_COOKIE_SECURE === "true";
const brandLogoCandidates = [
  process.env.LUGGAGE_TAG_BRAND_LOGO_PATH,
  path.join(rootDir, "public", "brand-logo.png"),
  path.join(rootDir, "public", "brand-logo.svg"),
  "D:\\文档\\logo\\南航\\China_Southern_Airlines-Logo.wine.png",
  "D:\\文档\\logo\\南航\\China_Southern_Airlines-Logo.wine.svg"
].filter(Boolean);
const allowedOrigins = String(process.env.LUGGAGE_TAG_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

await fs.mkdir(exportDir, { recursive: true });
await fs.mkdir(backupDir, { recursive: true });

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
`);

const defaultSettings = {
  prefix: "No.",
  currentNumber: "1",
  digits: "4",
  watermarkEnabled: "true",
  creatorAutoPrint: "false",
  creatorAutoReturn: "false",
  selectedPrinter: "",
  deploymentMode: "private",
  inviteCode: ""
};
const deploymentModes = ["private", "invite", "public", "maintenance"];
const userRoles = ["super_admin", "admin", "client"];
const userStatuses = ["active", "disabled"];
const templateIds = ["template_01", "template_02", "template_03"];
const paperPresets = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 }
};
const defaultLayoutOptions = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  productWidth: 70,
  productHeight: 110,
  margin: 8,
  gap: 6,
  showOrderNo: true,
  cropMarks: true,
  autoRotate: true
};

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

if (!process.env.SUPER_ADMIN_PASSWORD && !process.env.LUGGAGE_TAG_STAFF_PASSWORD && superAdminPassword === "admin123") {
  console.warn("SECURITY WARNING: LUGGAGE_TAG_STAFF_PASSWORD is not set. Default password admin123 is unsafe for public deployment.");
}

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
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

  if (!needsEventColumn && !needsDeletedAtColumn && !needsCreatedByColumn && !hasGlobalUniqueOrderNo) {
    return;
  }

  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    db.exec(`
      CREATE TABLE orders_next (
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
    `);
    const eventColumn = needsEventColumn ? "NULL AS event_id" : "event_id";
    const deletedAtColumn = needsDeletedAtColumn ? "NULL AS deleted_at" : "deleted_at";
    const createdByColumn = needsCreatedByColumn ? "NULL AS created_by" : "created_by";
    db.exec(`
      INSERT INTO orders_next (id, event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, deleted_at, created_by)
      SELECT id, ${eventColumn}, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, ${deletedAtColumn}, ${createdByColumn}
      FROM orders;
      DROP TABLE orders;
      ALTER TABLE orders_next RENAME TO orders;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensureActiveEvent() {
  let activeEvent = db.prepare("SELECT * FROM events WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get();
  if (activeEvent) {
    return activeEvent;
  }

  const settings = db.prepare("SELECT key, value FROM settings").all();
  const settingsMap = Object.fromEntries(settings.map((row) => [row.key, row.value]));
  const prefix = String(settingsMap.prefix ?? defaultSettings.prefix).slice(0, 12);
  const currentNumber = Math.max(1, Number.parseInt(settingsMap.currentNumber ?? defaultSettings.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(settingsMap.digits ?? defaultSettings.digits, 10) || 4));
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const result = db.prepare(
    `INSERT INTO events (name, prefix, event_date, current_number, digits, created_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  ).run("默认活动", prefix, today, currentNumber, digits, now);
  activeEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
  db.prepare("UPDATE orders SET event_id = ? WHERE event_id IS NULL").run(activeEvent.id);
  return activeEvent;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, passwordHash) {
  const [method, saltHex, hashHex] = String(passwordHash ?? "").split(":");
  if (method !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function ensureDefaultSuperAdmin() {
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM users WHERE username = ?").get(superAdminUsername);
  if (!existing) {
    db.prepare(
      `INSERT INTO users (username, password_hash, role, status, created_by, created_at, updated_at)
       VALUES (?, ?, 'super_admin', 'active', NULL, ?, ?)`
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
  if (!hasAbsolute) {
    return;
  }
  const rows = db.prepare("SELECT id, png_path, pdf_path FROM orders").all();
  const updates = [];
  for (const order of rows) {
    const nextPngPath = toRelativeExportPath(order.png_path);
    const nextPdfPath = toRelativeExportPath(order.pdf_path);
    if (nextPngPath !== order.png_path || nextPdfPath !== order.pdf_path) {
      updates.push({ id: order.id, pngPath: nextPngPath, pdfPath: nextPdfPath });
    }
  }
  for (const update of updates) {
    db.prepare("UPDATE orders SET png_path = ?, pdf_path = ? WHERE id = ?").run(update.pngPath, update.pdfPath, update.id);
  }
}

migrateAuthTokensTable();
migrateOrdersTable();
ensureActiveEvent();
migrateOrderFilePaths();
ensureDefaultSuperAdmin();
backupDatabase();
setInterval(backupDatabase, backupIntervalMs).unref();
cleanupExpiredTokens();
setInterval(cleanupExpiredTokens, tokenCleanupIntervalMs).unref();
cleanupAuditLogs();
setInterval(cleanupAuditLogs, tokenCleanupIntervalMs).unref();
cleanupExportFiles();
setInterval(cleanupExportFiles, exportCleanupIntervalMs).unref();

const app = express();
app.use((req, res, next) => {
  if (!isAllowedOrigin(req.headers.origin, req)) {
    return res.status(403).json({ message: "CORS origin not allowed" });
  }
  next();
});
app.use(cors((req, callback) => {
  callback(null, {
    credentials: true,
    origin: true
  });
}));
app.use(express.json({ limit: "12mb" }));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(rootDir, "dist")));
}

app.get("/brand-logo", async (_req, res) => {
  const logoPath = await getBrandLogoPath();
  if (!logoPath) {
    return res.status(404).send("Brand logo not found");
  }
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.sendFile(logoPath);
});

async function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const activeEvent = getActiveEvent();
  return {
    prefix: activeEvent.prefix,
    currentNumber: Number(activeEvent.current_number),
    digits: Number(activeEvent.digits),
    watermarkEnabled: (settings.watermarkEnabled ?? defaultSettings.watermarkEnabled) === "true",
    creatorAutoPrint: (settings.creatorAutoPrint ?? defaultSettings.creatorAutoPrint) === "true",
    creatorAutoReturn: (settings.creatorAutoReturn ?? defaultSettings.creatorAutoReturn) === "true",
    selectedPrinter: settings.selectedPrinter ?? defaultSettings.selectedPrinter,
    deploymentMode: deploymentModes.includes(settings.deploymentMode)
      ? settings.deploymentMode
      : defaultSettings.deploymentMode,
    inviteCode: settings.inviteCode ?? defaultSettings.inviteCode,
    activeEvent: toPublicEvent(activeEvent)
  };
}

function toClientSettings(settings) {
  return {
    prefix: settings.prefix,
    currentNumber: settings.currentNumber,
    digits: settings.digits,
    watermarkEnabled: settings.watermarkEnabled,
    creatorAutoPrint: settings.creatorAutoPrint,
    creatorAutoReturn: settings.creatorAutoReturn,
    deploymentMode: settings.deploymentMode,
    activeEvent: settings.activeEvent
  };
}

function getActiveEvent() {
  return ensureActiveEvent();
}

function toPublicEvent(event) {
  if (!event) {
    return null;
  }
  return {
    id: event.id,
    name: event.name,
    prefix: event.prefix,
    eventDate: event.event_date,
    currentNumber: Number(event.current_number),
    digits: Number(event.digits),
    createdAt: event.created_at,
    isActive: Boolean(event.is_active)
  };
}

function formatEventOrderNo(event) {
  return `${event.prefix}${String(event.current_number).padStart(event.digits, "0")}`;
}

function syncLegacyNumberSettings(event) {
  db.prepare("UPDATE settings SET value = ? WHERE key = 'prefix'").run(event.prefix);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'currentNumber'").run(String(event.current_number));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'digits'").run(String(event.digits));
}

function getRequestIp(req) {
  return String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
}

function getLoginFailure(req) {
  const ip = getRequestIp(req);
  const failure = loginFailures.get(ip) ?? { count: 0, lockedUntil: 0 };
  if (failure.lockedUntil && failure.lockedUntil <= Date.now()) {
    loginFailures.delete(ip);
    return { ip, failure: { count: 0, lockedUntil: 0 } };
  }
  return { ip, failure };
}

function recordLoginFailure(ip, failure) {
  const nextFailure = {
    count: failure.count + 1,
    lockedUntil: 0
  };
  if (nextFailure.count >= loginMaxFailures) {
    nextFailure.lockedUntil = Date.now() + loginLockMs;
  }
  loginFailures.set(ip, nextFailure);
  return nextFailure;
}

function clearLoginFailure(ip) {
  loginFailures.delete(ip);
}

function isAllowedOrigin(origin, req) {
  if (!origin) {
    return true;
  }
  if (allowedOrigins.includes(origin)) {
    return true;
  }
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const requestHost = String(req.headers.host ?? "").split(":")[0];
  if (requestHost && parsed.hostname === requestHost) {
    return true;
  }
  const hostname = parsed.hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return true;
  }
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }
  return false;
}

function createTimestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes())
  ].join("");
}

async function cleanupBackups() {
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const backups = entries
    .filter((entry) => entry.isFile() && /^luggage-tag-\d{8}-\d{4}\.sqlite$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.allSettled(
    backups.slice(backupRetention).map((name) => fs.unlink(path.join(backupDir, name)))
  );
}

async function backupDatabase() {
  try {
    const filename = `luggage-tag-${createTimestampForFilename()}.sqlite`;
    await fs.copyFile(dbPath, path.join(backupDir, filename));
    await cleanupBackups();
  } catch (error) {
    console.error("Failed to backup SQLite database", error);
  }
}

function normalizePathForCompare(value) {
  return path.resolve(value).toLowerCase();
}

function toRelativeExportPath(filePath) {
  if (!filePath) {
    return filePath;
  }
  if (!path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, "/");
  }
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(exportDir, absolutePath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return path.join("exports", relativePath).replace(/\\/g, "/");
  }
  return filePath;
}

function resolveStoredFilePath(filePath) {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (normalizedPath.startsWith("exports/")) {
    return path.join(dataDir, normalizedPath);
  }
  return path.join(exportDir, normalizedPath);
}

function getExportRelativePath(filename) {
  return path.join("exports", filename).replace(/\\/g, "/");
}

async function getBrandLogoPath() {
  for (const logoPath of brandLogoCandidates) {
    try {
      await fs.access(logoPath);
      return logoPath;
    } catch {
      // try next candidate
    }
  }
  return "";
}

async function cleanupExportFiles() {
  try {
    const rows = db.prepare("SELECT png_path, pdf_path FROM orders").all();
    const usedPaths = new Set(
      rows
        .flatMap((order) => [order.png_path, order.pdf_path])
        .filter(Boolean)
        .map((filePath) => normalizePathForCompare(resolveStoredFilePath(filePath)))
    );
    const entries = await fs.readdir(exportDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.allSettled(entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => {
        const filePath = path.join(exportDir, entry.name);
        if (usedPaths.has(normalizePathForCompare(filePath))) {
          return;
        }
        const stat = await fs.stat(filePath);
        if (now - stat.mtimeMs >= exportCleanupMinAgeMs) {
          await fs.unlink(filePath);
        }
      }));
  } catch (error) {
    console.error("Failed to cleanup export files", error);
  }
}

function normalizeEventPayload(body) {
  const name = String(body.name ?? "").trim().slice(0, 80);
  const prefix = String(body.prefix ?? "No.").trim().slice(0, 12) || "No.";
  const eventDate = String(body.eventDate ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const startNumber = Math.max(1, Number.parseInt(body.startNumber ?? body.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(body.digits, 10) || 4));

  if (!name) {
    throw new Error("活动名称不能为空");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error("活动日期格式无效");
  }

  return { name, prefix, eventDate, startNumber, digits };
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separatorIndex = cookie.indexOf("=");
        if (separatorIndex === -1) {
          return [cookie, ""];
        }
        return [
          decodeURIComponent(cookie.slice(0, separatorIndex)),
          decodeURIComponent(cookie.slice(separatorIndex + 1))
        ];
      })
  );
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createToken(type, ttlMs, userId = null) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR REPLACE INTO auth_tokens (token_hash, type, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token),
    type,
    userId,
    Date.now() + ttlMs,
    new Date().toISOString()
  );
  return token;
}

function getTokenRecord(type, token) {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT token_hash, user_id, expires_at FROM auth_tokens WHERE token_hash = ? AND type = ?").get(tokenHash, type);
  if (!row) {
    return null;
  }
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return row;
}

function isValidToken(type, token) {
  return Boolean(getTokenRecord(type, token));
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[sessionCookieName];
  const tokenRecord = getTokenRecord("staff", token);
  if (!tokenRecord?.user_id) {
    return null;
  }
  const user = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(tokenRecord.user_id);
  if (!user || user.status !== "active") {
    deleteToken("staff", token);
    return null;
  }
  return user;
}

function toPublicUser(user) {
  if (!user) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    status: user.status,
    created_by: user.created_by,
    created_at: user.created_at,
    updated_at: user.updated_at,
    last_login_at: user.last_login_at ?? ""
  };
}

function getAuditActor(req) {
  const user = getSessionUser(req);
  return user ? { id: user.id, username: user.username, role: user.role } : null;
}

function writeAuditLog(req, action, targetType = "", targetId = "", detail = {}) {
  const actor = getAuditActor(req);
  writeAuditLogEntry(req, actor, action, targetType, targetId, detail);
}

function writeAuditLogEntry(req, actor, action, targetType = "", targetId = "", detail = {}) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, role, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    actor?.id ?? null,
    actor?.username ?? "",
    actor?.role ?? "",
    action,
    targetType,
    String(targetId ?? ""),
    JSON.stringify(detail ?? {}),
    getRequestIp(req),
    new Date().toISOString()
  );
}

function normalizeUsername(value) {
  return String(value ?? "").trim().slice(0, 64);
}

function normalizePassword(value) {
  return String(value ?? "");
}

function normalizeUserRole(value) {
  return userRoles.includes(value) ? value : "client";
}

function normalizeRequestedUserRole(username, role) {
  if (username === superAdminUsername) {
    return "super_admin";
  }
  if (username === defaultAdminUsername) {
    return "admin";
  }
  return role === "super_admin" ? "admin" : role;
}

function validateUserRoleRequest(username, requestedRole) {
  if (requestedRole === "super_admin" && username !== superAdminUsername) {
    throw new Error("Super Admin 账号唯一，只能是 gongbei");
  }
}

function normalizeUserStatus(value) {
  return userStatuses.includes(value) ? value : "active";
}

function countActiveSuperAdmins(excludeUserId = null) {
  const row = excludeUserId
    ? db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?").get(excludeUserId)
    : db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active'").get();
  return Number(row?.count ?? 0);
}

function assertCanChangeUser(req, targetUser, nextRole = targetUser?.role, nextStatus = targetUser?.status) {
  const actor = getRequestUser(req);
  if (!targetUser) {
    throw new Error("账号不存在");
  }
  if (actor?.role !== "super_admin") {
    throw new Error("无权管理账号");
  }
  if (targetUser.id === actor.id && (nextRole !== "super_admin" || nextStatus !== "active")) {
    throw new Error("超级管理员不能禁用或降级自己");
  }
  if (targetUser.username === superAdminUsername && (nextRole !== "super_admin" || nextStatus !== "active")) {
    throw new Error("gongbei 是唯一 Super Admin，不能禁用或降级");
  }
  if (targetUser.username !== superAdminUsername && nextRole === "super_admin") {
    throw new Error("Super Admin 账号唯一，只能是 gongbei");
  }
  if (targetUser.role === "super_admin" && (nextRole !== "super_admin" || nextStatus !== "active") && countActiveSuperAdmins(targetUser.id) < 1) {
    throw new Error("至少需要保留 gongbei 作为启用的 Super Admin");
  }
}

function getRequestUser(req) {
  if (!req.currentUser) {
    req.currentUser = getSessionUser(req);
  }
  return req.currentUser;
}

function hasRole(user, roles) {
  return Boolean(user && roles.includes(user.role));
}

function deleteToken(type, token) {
  if (token) {
    db.prepare("DELETE FROM auth_tokens WHERE token_hash = ? AND type = ?").run(hashToken(token), type);
  }
}

function cleanupExpiredTokens() {
  db.prepare("DELETE FROM auth_tokens WHERE expires_at <= ?").run(Date.now());
}

function cleanupAuditLogs() {
  db.prepare(
    "DELETE FROM audit_logs WHERE id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)"
  ).run(auditLogRetention);
}

function shouldUseSecureCookie(req) {
  return forceSecureCookie || req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req, res, token) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    maxAge: sessionTtlMs,
    sameSite: "lax",
    secure: shouldUseSecureCookie(req)
  });
}

function setInviteCookie(req, res, token) {
  res.cookie(inviteCookieName, token, {
    httpOnly: true,
    maxAge: inviteTtlMs,
    sameSite: "lax",
    secure: shouldUseSecureCookie(req)
  });
}

function clearAuthCookies(req, res) {
  const options = { sameSite: "lax", secure: shouldUseSecureCookie(req) };
  res.clearCookie(sessionCookieName, options);
  res.clearCookie(inviteCookieName, options);
}

function isStaffRequest(req) {
  const user = getSessionUser(req);
  return Boolean(user && ["super_admin", "admin"].includes(user.role));
}

function isInviteRequest(req) {
  const cookies = parseCookies(req);
  return isValidToken("invite", cookies[inviteCookieName]);
}

async function getAccessState(req) {
  const settings = await getSettings();
  const user = getSessionUser(req);
  const authenticated = Boolean(user && ["super_admin", "admin"].includes(user.role));
  const invited = isInviteRequest(req);
  const loggedInCustomer = Boolean(user && ["super_admin", "admin", "client"].includes(user.role));
  const customerAccess = loggedInCustomer ||
    settings.deploymentMode === "public" ||
    (settings.deploymentMode === "invite" && invited);
  return {
    authenticated,
    sessionAuthenticated: Boolean(user),
    invited,
    role: user?.role ?? "",
    user: user ? { id: user.id, username: user.username, role: user.role, status: user.status } : null,
    customerAccess: settings.deploymentMode === "maintenance" ? false : customerAccess,
    deploymentMode: settings.deploymentMode
  };
}

async function requireStaff(req, res, next) {
  const user = getRequestUser(req);
  const access = await getAccessState(req);
  if (!hasRole(user, ["super_admin", "admin"])) {
    return res.status(401).json({ message: "Staff login required", access });
  }
  next();
}

function requireRole(roles) {
  return async (req, res, next) => {
    const user = getRequestUser(req);
    if (!user) {
      return res.status(401).json({ message: "Login required", access: await getAccessState(req) });
    }
    if (!hasRole(user, roles)) {
      return res.status(403).json({ message: "Permission denied", access: await getAccessState(req) });
    }
    next();
  };
}

async function requireCustomerAccess(req, res, next) {
  const access = await getAccessState(req);
  if (!access.customerAccess) {
    return res.status(access.deploymentMode === "maintenance" ? 503 : 401).json({
      message: access.deploymentMode === "maintenance" ? "System is in maintenance mode" : "Login required",
      access
    });
  }
  next();
}

async function requireSettingsAccess(req, res, next) {
  const access = await getAccessState(req);
  if (!access.customerAccess && !access.authenticated) {
    return res.status(access.deploymentMode === "maintenance" ? 503 : 401).json({
      message: access.deploymentMode === "maintenance" ? "System is in maintenance mode" : "Login required",
      access
    });
  }
  next();
}

function imageDataToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid PNG data URL");
  }
  return Buffer.from(match[1], "base64");
}

function normalizeCustomerName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/^ +/g, "")
    .replace(/ {2,}/g, " ")
    .slice(0, 12)
    .trim();
}

function isValidCustomerName(value) {
  return /^[A-Z]+(?: [A-Z]+)*$/.test(value) && value.length <= 12;
}

function isValidRawCustomerName(value) {
  return /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(value ?? "").trim()) && String(value ?? "").trim().length <= 12;
}

async function createOrderFromPayload(req) {
  const templateId = String(req.body.templateId ?? "");
  const rawCustomerText = String(req.body.customerText ?? "");
  const customerText = normalizeCustomerName(rawCustomerText);
  const pngDataUrl = String(req.body.pngDataUrl ?? "");

  if (!templateIds.includes(templateId)) {
    const error = new Error("Invalid template");
    error.statusCode = 400;
    throw error;
  }
  if (!isValidRawCustomerName(rawCustomerText) || !isValidCustomerName(customerText)) {
    const error = new Error("Customer name must contain 1-12 English letters only");
    error.statusCode = 400;
    throw error;
  }

  let created;
  try {
    const generatedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    const activeEvent = getActiveEvent();
    const orderNo = formatEventOrderNo(activeEvent);
    const safeName = `${orderNo}-${generatedAt}-${crypto.randomBytes(4).toString("hex")}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const pngPath = getExportRelativePath(`${safeName}.png`);
    const pdfPath = getExportRelativePath(`${safeName}.pdf`);

    const result = db.prepare(
      `INSERT INTO orders (event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, created_by)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(
      activeEvent.id,
      orderNo,
      templateId,
      customerText,
      generatedAt,
      pngPath,
      pdfPath,
      getRequestUser(req)?.id ?? null
    );
    const nextNumber = Number(activeEvent.current_number) + 1;
    db.prepare("UPDATE events SET current_number = ? WHERE id = ?").run(nextNumber, activeEvent.id);
    syncLegacyNumberSettings({ ...activeEvent, current_number: nextNumber });
    db.exec("COMMIT");
    created = { id: result.lastInsertRowid, orderNo, generatedAt, pngPath, pdfPath, customerText, templateId };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    throw error;
  }

  try {
    await fs.writeFile(resolveStoredFilePath(created.pngPath), imageDataToBuffer(pngDataUrl));
    await createTicketPdf(
      { order_no: created.orderNo, customer_text: customerText, generated_at: created.generatedAt },
      resolveStoredFilePath(created.pdfPath)
    );
  } catch (error) {
    db.prepare("DELETE FROM orders WHERE id = ?").run(created.id);
    throw error;
  }
  writeAuditLog(req, "orders.create", "order", created.id, { orderNo: created.orderNo, customerText, templateId });
  return created;
}

function toPublicOrder(order) {
  if (!order) {
    return null;
  }
  return {
    id: order.id,
    event_id: order.event_id,
    event_name: order.event_name ?? "",
    event_date: order.event_date ?? "",
    order_no: order.order_no,
    template_id: order.template_id,
    customer_text: order.customer_text,
    generated_at: order.generated_at,
    print_status: order.print_status,
    deleted_at: order.deleted_at ?? "",
    created_by: order.created_by ?? null,
    creator_username: order.creator_username ?? ""
  };
}

function getOrderById(orderId, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  const user = options.user ?? null;
  const ownershipClause = user?.role === "client" ? "AND orders.created_by = ?" : "";
  const sql = `
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    LEFT JOIN users ON users.id = orders.created_by
    WHERE orders.id = ?
    ${includeDeleted ? "" : "AND orders.deleted_at IS NULL"}
    ${ownershipClause}
  `;
  const params = user?.role === "client" ? [orderId, user.id] : [orderId];
  return db.prepare(sql).get(...params);
}

function parseOrderIds(value) {
  const rawIds = Array.isArray(value) ? value : String(value ?? "").split(",");
  return rawIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index);
}

function getOrdersByIds(orderIds, options = {}) {
  if (!orderIds.length) {
    return [];
  }
  const user = options.user ?? null;
  const placeholders = orderIds.map(() => "?").join(",");
  const ownershipClause = user?.role === "client" ? "AND orders.created_by = ?" : "";
  const rows = db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    LEFT JOIN users ON users.id = orders.created_by
    WHERE orders.id IN (${placeholders})
      AND orders.deleted_at IS NULL
      ${ownershipClause}
  `).all(...(user?.role === "client" ? [...orderIds, user.id] : orderIds));
  const byId = new Map(rows.map((order) => [order.id, order]));
  return orderIds.map((id) => byId.get(id)).filter(Boolean);
}

function parseNumber(value, fallback, min = 0.1, max = 2000) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizeLayoutOptions(value = {}) {
  const preset = String(value.paperPreset ?? defaultLayoutOptions.paperPreset).toUpperCase();
  const presetSize = paperPresets[preset];
  const paperWidth = presetSize
    ? presetSize.width
    : parseNumber(value.paperWidth, defaultLayoutOptions.paperWidth, 20);
  const paperHeight = presetSize
    ? presetSize.height
    : parseNumber(value.paperHeight, defaultLayoutOptions.paperHeight, 20);

  return {
    paperPreset: presetSize ? preset : "CUSTOM",
    paperWidth,
    paperHeight,
    productWidth: parseNumber(value.productWidth, defaultLayoutOptions.productWidth, 5),
    productHeight: parseNumber(value.productHeight, defaultLayoutOptions.productHeight, 5),
    margin: parseNumber(value.margin, defaultLayoutOptions.margin, 0),
    gap: parseNumber(value.gap, defaultLayoutOptions.gap, 0),
    showOrderNo: value.showOrderNo !== false,
    cropMarks: value.cropMarks !== false,
    autoRotate: value.autoRotate !== false
  };
}

function scoreLayout(candidate) {
  const usedWidth = candidate.columns * candidate.itemWidth + (candidate.columns - 1) * candidate.gap;
  const usedHeight = candidate.rows * candidate.blockHeight + (candidate.rows - 1) * candidate.gap;
  return {
    capacity: candidate.capacity,
    usedArea: usedWidth * usedHeight,
    waste: candidate.pageWidth * candidate.pageHeight - usedWidth * usedHeight
  };
}

function computeImpositionLayout(rawOptions = {}) {
  const options = normalizeLayoutOptions(rawOptions);
  const labelHeight = options.showOrderNo ? 6 : 0;
  const pageOrientations = [
    { pageWidth: options.paperWidth, pageHeight: options.paperHeight, pageRotated: false },
    { pageWidth: options.paperHeight, pageHeight: options.paperWidth, pageRotated: true }
  ];
  const itemOrientations = [
    { itemWidth: options.productWidth, itemHeight: options.productHeight, itemRotated: false },
    { itemWidth: options.productHeight, itemHeight: options.productWidth, itemRotated: true }
  ].filter((item, index) => index === 0 || options.autoRotate);

  const candidates = [];
  for (const page of pageOrientations) {
    for (const item of itemOrientations) {
      const usableWidth = page.pageWidth - options.margin * 2;
      const usableHeight = page.pageHeight - options.margin * 2;
      const blockHeight = item.itemHeight + labelHeight;
      const columns = Math.floor((usableWidth + options.gap) / (item.itemWidth + options.gap));
      const rows = Math.floor((usableHeight + options.gap) / (blockHeight + options.gap));
      if (columns > 0 && rows > 0) {
        candidates.push({
          ...options,
          ...page,
          ...item,
          blockHeight,
          columns,
          rows,
          capacity: columns * rows,
          labelHeight
        });
      }
    }
  }

  if (!candidates.length) {
    throw new Error("Product size does not fit on selected paper");
  }

  candidates.sort((left, right) => {
    const leftScore = scoreLayout(left);
    const rightScore = scoreLayout(right);
    if (rightScore.capacity !== leftScore.capacity) {
      return rightScore.capacity - leftScore.capacity;
    }
    return leftScore.waste - rightScore.waste;
  });

  const best = candidates[0];
  const totalWidth = best.columns * best.itemWidth + (best.columns - 1) * best.gap;
  const totalHeight = best.rows * best.blockHeight + (best.rows - 1) * best.gap;
  const startX = (best.pageWidth - totalWidth) / 2;
  const startY = (best.pageHeight - totalHeight) / 2;
  const positions = Array.from({ length: best.capacity }, (_, index) => {
    const column = index % best.columns;
    const row = Math.floor(index / best.columns);
    return {
      x: startX + column * (best.itemWidth + best.gap),
      y: startY + row * (best.blockHeight + best.gap),
      index,
      column,
      row
    };
  });

  return { ...best, positions };
}

async function getWindowsPrinters() {
  const command = [
    "-NoProfile",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress"
  ];
  const { stdout } = await execFileAsync("powershell.exe", command, { windowsHide: true });
  if (!stdout.trim()) {
    return [];
  }
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((printer) => ({
    name: printer.Name,
    isDefault: Boolean(printer.Default),
    isVirtual: isVirtualPrinterName(printer.Name)
  }));
}

function isVirtualPrinterName(name) {
  return /\b(pdf|xps|onenote|fax)\b|wps|导出为/i.test(String(name ?? ""));
}

async function getCupsPrinters() {
  try {
    const [{ stdout: printerOutput }, defaultResult] = await Promise.all([
      execFileAsync("lpstat", ["-p"], { timeout: 10_000 }),
      execFileAsync("lpstat", ["-d"], { timeout: 10_000 }).catch(() => ({ stdout: "" }))
    ]);
    const defaultPrinter = defaultResult.stdout.match(/:\s*(.+)\s*$/)?.[1]?.trim() ?? "";
    return printerOutput
      .split(/\r?\n/)
      .map((line) => line.match(/^printer\s+(\S+)/)?.[1])
      .filter(Boolean)
      .map((name) => ({ name, isDefault: name === defaultPrinter, isVirtual: isVirtualPrinterName(name) }));
  } catch {
    return [];
  }
}

async function getSystemPrinters() {
  if (process.platform === "win32") {
    return getWindowsPrinters();
  }
  return getCupsPrinters();
}

async function resolvePrinterName(requestedPrinterName = "") {
  const printers = await getSystemPrinters();
  const settings = await getSettings();
  const configuredPrinter = String(requestedPrinterName || settings.selectedPrinter || "").trim();
  if (configuredPrinter) {
    if (printers.length && !printers.some((printer) => printer.name === configuredPrinter)) {
      throw new Error(`未找到打印机：${configuredPrinter}`);
    }
    return configuredPrinter;
  }
  const defaultPrinter = printers.find((printer) => printer.isDefault);
  if (defaultPrinter && !defaultPrinter.isVirtual) {
    return defaultPrinter.name;
  }
  const physicalPrinter = printers.find((printer) => !printer.isVirtual);
  if (physicalPrinter) {
    return physicalPrinter.name;
  }
  if (defaultPrinter?.isVirtual) {
    throw new Error(`系统默认打印机是虚拟打印机：${defaultPrinter.name}。请到后台配置实体打印机`);
  }
  throw new Error("未读取到可用实体打印机，请到后台刷新并配置打印机");
}

async function printTicketDirectWindows(order, requestedPrinterName = "") {
  const printerName = await resolvePrinterName(requestedPrinterName);
  const script = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$printerName = $env:LUGGAGE_TAG_PRINT_PRINTER
$orderNo = $env:LUGGAGE_TAG_PRINT_ORDER_NO
$customerText = $env:LUGGAGE_TAG_PRINT_CUSTOMER_TEXT
$generatedAt = $env:LUGGAGE_TAG_PRINT_GENERATED_AT
Add-Type -AssemblyName System.Drawing
$document = New-Object System.Drawing.Printing.PrintDocument
$document.DocumentName = "Luggage Tag Ticket " + $orderNo
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
if (-not [string]::IsNullOrWhiteSpace($printerName)) {
  $document.PrinterSettings.PrinterName = $printerName
}
if (-not $document.PrinterSettings.IsValid) {
  throw ("打印机不可用：" + $document.PrinterSettings.PrinterName)
}
$document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("LuggageTag70x110", 276, 433)
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$document.OriginAtMargins = $false
$document.add_PrintPage({
  param($sender, $event)
  $graphics = $event.Graphics
  $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  $graphics.Clear([System.Drawing.Color]::White)
  $centerFormat = New-Object System.Drawing.StringFormat
  $centerFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $nameFont = New-Object System.Drawing.Font("Arial", 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Point)
  $noFont = New-Object System.Drawing.Font("Arial", 10, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $timeFont = New-Object System.Drawing.Font("Arial", 7, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  try {
    $graphics.DrawString($customerText, $nameFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF(4, 42, 62, 14)), $centerFormat)
    $graphics.DrawString($orderNo, $noFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF(4, 61, 62, 8)), $centerFormat)
    $graphics.DrawString($generatedAt, $timeFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF(4, 73, 62, 8)), $centerFormat)
  } finally {
    $nameFont.Dispose()
    $noFont.Dispose()
    $timeFont.Dispose()
    $centerFormat.Dispose()
  }
  $event.HasMorePages = $false
})
try {
  $document.Print()
  Write-Output ("PRINTER_NAME=" + $document.PrinterSettings.PrinterName)
} finally {
  $document.Dispose()
}
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {
      ...process.env,
      LUGGAGE_TAG_PRINT_PRINTER: printerName,
      LUGGAGE_TAG_PRINT_ORDER_NO: order.order_no,
      LUGGAGE_TAG_PRINT_CUSTOMER_TEXT: order.customer_text,
      LUGGAGE_TAG_PRINT_GENERATED_AT: formatTicketDateTime(order.generated_at)
    },
    timeout: 60_000,
    windowsHide: true
  });
  const printedPrinterName = stdout.match(/PRINTER_NAME=(.+)/)?.[1]?.trim();
  return { printerName: printedPrinterName || printerName || "默认打印机" };
}

async function findPrintCommand() {
  for (const command of ["lp", "lpr"]) {
    try {
      await execFileAsync("sh", ["-c", `command -v ${command}`], { timeout: 5_000 });
      return command;
    } catch {
      // continue
    }
  }
  return "";
}

async function printTicketDirectCups(order, requestedPrinterName = "") {
  const printCommand = await findPrintCommand();
  if (!printCommand) {
    throw new Error("服务器未配置本地打印服务：当前系统未找到 lp/lpr。请在服务器配置 CUPS/网络打印机，或把服务部署到连接打印机的 Windows 主机");
  }
  const printerName = await resolvePrinterName(requestedPrinterName);
  let pdfPath = order.pdf_path ? resolveStoredFilePath(order.pdf_path) : "";
  let shouldRemovePdf = false;
  if (!pdfPath) {
    pdfPath = path.join(exportDir, `test-ticket-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`);
    await createTicketPdf(order, pdfPath);
    shouldRemovePdf = true;
  }
  try {
    const args = printCommand === "lp"
      ? [...(printerName ? ["-d", printerName] : []), pdfPath]
      : [...(printerName ? ["-P", printerName] : []), pdfPath];
    await execFileAsync(printCommand, args, { timeout: 30_000 });
    return { printerName: printerName || "默认打印机" };
  } finally {
    if (shouldRemovePdf) {
      await fs.unlink(pdfPath).catch(() => {});
    }
  }
}

async function printTicketDirect(order, requestedPrinterName = "") {
  if (process.platform === "win32") {
    return printTicketDirectWindows(order, requestedPrinterName);
  }
  return printTicketDirectCups(order, requestedPrinterName);
}

async function printOrderTicket(order, requestedPrinterName = "") {
  return printTicketDirect(order, requestedPrinterName);
}

function formatTicketDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function drawTicket(pdf, order, x, y, width, height) {
  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, width, height, "F");
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(Math.min(26, width * 0.24));
  pdf.text(order.customer_text, x + width / 2, y + height * 0.43, {
    align: "center",
    maxWidth: width * 0.84
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(Math.min(12, width * 0.12));
  pdf.text(order.order_no, x + width / 2, y + height * 0.57, { align: "center" });
  pdf.setFontSize(Math.min(8, width * 0.08));
  pdf.text(formatTicketDateTime(order.generated_at), x + width / 2, y + height * 0.66, { align: "center" });
}

async function createTicketPdf(order, outputPath) {
  const pdfBuffer = createTicketPdfBuffer(order);
  await fs.writeFile(outputPath, pdfBuffer);
}

function createTicketPdfBuffer(order) {
  const width = 70;
  const height = 110;
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [width, height],
    compress: true
  });
  drawTicket(pdf, order, 0, 0, width, height);
  pdf.setProperties({ title: `Luggage Tag Ticket ${order.order_no}` });
  return Buffer.from(pdf.output("arraybuffer"));
}

function drawCropMarks(pdf, x, y, width, height) {
  const markLength = 4;
  const corners = [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1]
  ];
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.1);
  corners.forEach(([cornerX, cornerY, directionX, directionY]) => {
    pdf.line(cornerX, cornerY, cornerX + directionX * markLength, cornerY);
    pdf.line(cornerX, cornerY, cornerX, cornerY + directionY * markLength);
  });
}

async function createImpositionPdf(orders, rawOptions = {}) {
  const layout = computeImpositionLayout(rawOptions);
  const pdf = new jsPDF({
    orientation: layout.pageWidth >= layout.pageHeight ? "landscape" : "portrait",
    unit: "mm",
    format: [layout.pageWidth, layout.pageHeight],
    compress: true
  });

  for (const [index, order] of orders.entries()) {
    if (index > 0 && index % layout.capacity === 0) {
      pdf.addPage();
    }
    const position = layout.positions[index % layout.capacity];
    const x = position.x;
    const y = position.y;
    drawTicket(pdf, order, x, y, layout.itemWidth, layout.itemHeight);
    if (layout.cropMarks) {
      drawCropMarks(pdf, x, y, layout.itemWidth, layout.itemHeight);
    }

    if (layout.showOrderNo) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(order.order_no, x + layout.itemWidth / 2, y + layout.itemHeight + 4.5, { align: "center" });
    }
  }

  pdf.setProperties({ title: "Luggage Tag Imposition Layout" });
  return Buffer.from(pdf.output("arraybuffer"));
}

app.get("/api/auth/status", async (req, res) => {
  res.json(await getAccessState(req));
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username ?? "").trim();
  const password = String(req.body.password ?? "");
  const { ip, failure } = getLoginFailure(req);
  if (failure.lockedUntil > Date.now()) {
    const retrySeconds = Math.ceil((failure.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ message: `登录失败次数过多，请 ${retrySeconds} 秒后再试` });
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || user.status !== "active" || !verifyPassword(password, user.password_hash)) {
    const nextFailure = recordLoginFailure(ip, failure);
    if (nextFailure.lockedUntil > Date.now()) {
      const retrySeconds = Math.ceil((nextFailure.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ message: `登录失败次数过多，请 ${retrySeconds} 秒后再试` });
    }
    return res.status(401).json({ message: user?.status === "disabled" ? "账号已禁用" : "账号或密码错误" });
  }
  clearLoginFailure(ip);
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(new Date().toISOString(), user.id);
  setSessionCookie(req, res, createToken("staff", sessionTtlMs, user.id));
  writeAuditLogEntry(req, user, "auth.login", "user", user.id, { username: user.username, role: user.role });
  const settings = await getSettings();
  res.json({
    authenticated: ["super_admin", "admin"].includes(user.role),
    sessionAuthenticated: true,
    invited: false,
    role: user.role,
    user: { id: user.id, username: user.username, role: user.role, status: user.status },
    customerAccess: settings.deploymentMode !== "maintenance",
    deploymentMode: settings.deploymentMode
  });
});

app.post("/api/auth/invite", async (req, res) => {
  const settings = await getSettings();
  const inviteCode = String(req.body.inviteCode ?? "").trim();
  if (settings.deploymentMode !== "invite" || !settings.inviteCode || inviteCode !== settings.inviteCode) {
    return res.status(401).json({ message: "邀请码无效" });
  }
  setInviteCookie(req, res, createToken("invite", inviteTtlMs));
  res.json({
    authenticated: false,
    invited: true,
    customerAccess: true,
    deploymentMode: settings.deploymentMode
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const cookies = parseCookies(req);
  writeAuditLog(req, "auth.logout", "user", getRequestUser(req)?.id ?? "", {});
  deleteToken("staff", cookies[sessionCookieName]);
  deleteToken("invite", cookies[inviteCookieName]);
  clearAuthCookies(req, res);
  res.json({ ok: true });
});

app.get("/api/users", requireRole(["super_admin"]), async (_req, res) => {
  const users = db.prepare(
    `SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at
     FROM users
     ORDER BY id ASC`
  ).all();
  res.json(users.map(toPublicUser));
});

app.post("/api/users", requireRole(["super_admin"]), async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const password = normalizePassword(req.body.password);
  const requestedRole = normalizeUserRole(req.body.role);
  const role = normalizeRequestedUserRole(username, requestedRole);
  const status = normalizeUserStatus(req.body.status);
  if (!username || username.length < 3) {
    return res.status(400).json({ message: "账号至少需要 3 个字符" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "密码至少需要 6 个字符" });
  }
  try {
    validateUserRoleRequest(username, requestedRole);
    const now = new Date().toISOString();
    const actor = getRequestUser(req);
    const result = db.prepare(
      `INSERT INTO users (username, password_hash, role, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(username, hashPassword(password), role, status, actor.id, now, now);
    const user = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(result.lastInsertRowid);
    writeAuditLog(req, "users.create", "user", user.id, { username: user.username, role: user.role, status: user.status });
    res.status(201).json(toPublicUser(user));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ message: "账号已存在" });
    }
    console.error(error);
    res.status(500).json({ message: "账号创建失败" });
  }
});

app.patch("/api/users/:id", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const username = normalizeUsername(req.body.username ?? targetUser?.username);
  const requestedRole = normalizeUserRole(req.body.role ?? targetUser?.role);
  const role = normalizeRequestedUserRole(username, requestedRole);
  const status = normalizeUserStatus(req.body.status ?? targetUser?.status);
  if (!username || username.length < 3) {
    return res.status(400).json({ message: "账号至少需要 3 个字符" });
  }
  try {
    validateUserRoleRequest(username, requestedRole);
    assertCanChangeUser(req, targetUser, role, status);
    db.prepare("UPDATE users SET username = ?, role = ?, status = ?, updated_at = ? WHERE id = ?").run(
      username,
      role,
      status,
      new Date().toISOString(),
      userId
    );
    const nextUser = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(userId);
    if (status === "disabled") {
      db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
    }
    writeAuditLog(req, "users.update", "user", userId, { username, role, status });
    res.json(toPublicUser(nextUser));
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      return res.status(409).json({ message: "账号已存在" });
    }
    res.status(400).json({ message: error.message || "账号更新失败" });
  }
});

app.post("/api/users/:id/reset-password", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const password = normalizePassword(req.body.password);
  if (!targetUser) {
    return res.status(404).json({ message: "账号不存在" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "密码至少需要 6 个字符" });
  }
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(password), new Date().toISOString(), userId);
  db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
  writeAuditLog(req, "users.reset_password", "user", userId, { username: targetUser.username });
  res.json({ ok: true });
});

app.delete("/api/users/:id", requireRole(["super_admin"]), async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);
  const actor = getRequestUser(req);
  const targetUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!targetUser) {
    return res.status(404).json({ message: "账号不存在" });
  }
  if (targetUser.id === actor.id) {
    return res.status(400).json({ message: "Super Admin 不能删除自己" });
  }
  try {
    assertCanChangeUser(req, targetUser, "deleted", "disabled");
    db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    writeAuditLog(req, "users.delete", "user", userId, { username: targetUser.username, role: targetUser.role });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ message: error.message || "账号删除失败" });
  }
});

app.get("/api/audit-logs", requireRole(["super_admin"]), async (_req, res) => {
  const logs = db.prepare(
    `SELECT id, user_id, username, role, action, target_type, target_id, detail, ip, created_at
     FROM audit_logs
     ORDER BY id DESC
     LIMIT 300`
  ).all();
  res.json(logs.map((log) => ({
    ...log,
    detail: (() => {
      try {
        return JSON.parse(log.detail || "{}");
      } catch {
        return {};
      }
    })()
  })));
});

app.get("/api/settings", requireSettingsAccess, async (req, res) => {
  const settings = await getSettings();
  res.json({
    ...toClientSettings(settings),
    ...(isStaffRequest(req) ? { selectedPrinter: settings.selectedPrinter, inviteCode: settings.inviteCode } : {})
  });
});

app.put("/api/settings", requireRole(["super_admin"]), async (req, res) => {
  const prefix = String(req.body.prefix ?? "No.").slice(0, 12);
  const currentNumber = Math.max(1, Number.parseInt(req.body.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(req.body.digits, 10) || 4));
  const watermarkEnabled = Boolean(req.body.watermarkEnabled);
  const creatorAutoPrint = Boolean(req.body.creatorAutoPrint);
  const creatorAutoReturn = Boolean(req.body.creatorAutoReturn);
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  const deploymentMode = deploymentModes.includes(req.body.deploymentMode) ? req.body.deploymentMode : "private";
  const inviteCode = String(req.body.inviteCode ?? "").slice(0, 64);

  db.prepare("UPDATE settings SET value = ? WHERE key = 'prefix'").run(prefix);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'currentNumber'").run(String(currentNumber));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'digits'").run(String(digits));
  db.prepare("UPDATE events SET prefix = ?, current_number = ?, digits = ? WHERE id = ?").run(
    prefix,
    currentNumber,
    digits,
    getActiveEvent().id
  );
  db.prepare("UPDATE settings SET value = ? WHERE key = 'watermarkEnabled'").run(String(watermarkEnabled));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'creatorAutoPrint'").run(String(creatorAutoPrint));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'creatorAutoReturn'").run(String(creatorAutoReturn));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'deploymentMode'").run(deploymentMode);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'inviteCode'").run(inviteCode);
  writeAuditLog(req, "settings.update", "settings", "system", { deploymentMode, creatorAutoPrint, creatorAutoReturn });
  res.json(await getSettings());
});

app.post("/api/events/reset", requireRole(["super_admin"]), async (req, res) => {
  try {
    const event = normalizeEventPayload(req.body);
    const now = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    db.prepare("UPDATE events SET is_active = 0").run();
    const result = db.prepare(
      `INSERT INTO events (name, prefix, event_date, current_number, digits, created_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).run(event.name, event.prefix, event.eventDate, event.startNumber, event.digits, now);
    const activeEvent = db.prepare("SELECT * FROM events WHERE id = ?").get(result.lastInsertRowid);
    syncLegacyNumberSettings(activeEvent);
    db.exec("COMMIT");
    writeAuditLog(req, "events.reset", "event", activeEvent.id, {
      name: activeEvent.name,
      prefix: activeEvent.prefix,
      currentNumber: activeEvent.current_number,
      digits: activeEvent.digits
    });
    res.json({ event: toPublicEvent(activeEvent), settings: await getSettings() });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    res.status(400).json({ message: error.message || "新活动重置失败" });
  }
});

app.get("/api/preview-number", requireCustomerAccess, async (_req, res) => {
  const settings = await getSettings();
  const activeEvent = getActiveEvent();
  res.json({ orderNo: formatEventOrderNo(activeEvent), settings: toClientSettings(settings) });
});

app.get("/api/orders", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const includeDeleted = req.query.deleted === "true";
  const user = getRequestUser(req);
  const ownershipClause = user.role === "client" ? "AND orders.created_by = ?" : "";
  const rows = db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date, users.username AS creator_username
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    LEFT JOIN users ON users.id = orders.created_by
    WHERE ${includeDeleted ? "orders.deleted_at IS NOT NULL" : "orders.deleted_at IS NULL"}
    ${ownershipClause}
    ORDER BY orders.id DESC
  `).all(...(user.role === "client" ? [user.id] : []));
  res.json(rows.map(toPublicOrder));
});

app.post("/api/layout/preview", requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const layout = computeImpositionLayout(req.body.layoutOptions ?? req.body);
    res.json({
      paperWidth: layout.pageWidth,
      paperHeight: layout.pageHeight,
      productWidth: layout.itemWidth,
      productHeight: layout.itemHeight,
      columns: layout.columns,
      rows: layout.rows,
      capacity: layout.capacity,
      autoRotated: layout.itemRotated,
      pageRotated: layout.pageRotated,
      gap: layout.gap,
      margin: layout.margin,
      showOrderNo: layout.showOrderNo,
      cropMarks: layout.cropMarks,
      labelHeight: layout.labelHeight,
      positions: layout.positions
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post("/api/orders/imposition", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) {
    return res.status(400).json({ message: "Select at least one order" });
  }
  try {
    const layoutOptions = req.body.layoutOptions ?? req.body;
    const layout = computeImpositionLayout(layoutOptions);
    const pdfBuffer = await createImpositionPdf(orders, layoutOptions);
    const filename = `imposition-${layout.paperPreset.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    writeAuditLog(req, "orders.imposition", "orders", orderIds.join(","), { count: orders.length, paperPreset: layout.paperPreset });
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Failed to create imposition PDF" });
  }
});

app.post("/api/orders/a4-layout", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) {
    return res.status(400).json({ message: "Select at least one order" });
  }
  try {
    const pdfBuffer = await createImpositionPdf(orders, {
      ...defaultLayoutOptions,
      ...(req.body.layoutOptions ?? {}),
      showOrderNo: req.body.showOrderNo !== false
    });
    const filename = `a4-layout-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create A4 layout PDF" });
  }
});

app.get("/api/orders/batch", requireRole(["super_admin", "admin"]), async (req, res) => {
  const orderIds = parseOrderIds(req.query.ids);
  const orders = getOrdersByIds(orderIds);
  res.json(orders.map(toPublicOrder));
});

app.get("/api/orders/:id", requireRole(["super_admin", "admin", "client"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true, user: getRequestUser(req) });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.get("/api/orders/:id/ticket", requireCustomerAccess, async (req, res) => {
  const user = getRequestUser(req);
  const order = getOrderById(req.params.id, { includeDeleted: false, user });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.post("/api/orders", requireCustomerAccess, async (req, res) => {
  try {
    const created = await createOrderFromPayload(req);
    res.status(201).json({ id: created.id, orderNo: created.orderNo, generatedAt: created.generatedAt });
  } catch (error) {
    console.error(error);
    res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Failed to create order" });
  }
});

app.post("/api/orders/direct-print", requireCustomerAccess, async (req, res) => {
  let created;
  try {
    created = await createOrderFromPayload(req);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Failed to create order" });
  }

  const order = getOrderById(created.id, { includeDeleted: false, user: getRequestUser(req) });
  try {
    const result = await printOrderTicket(order);
    db.prepare("UPDATE orders SET print_status = 'printed' WHERE id = ? AND deleted_at IS NULL").run(order.id);
    writeAuditLog(req, "orders.direct_print", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.status(201).json({
      id: order.id,
      orderNo: order.order_no,
      generatedAt: order.generated_at,
      printerName: result.printerName,
      message: `打印已发送：${result.printerName}`
    });
  } catch (error) {
    console.error(error);
    writeAuditLog(req, "orders.direct_print_failed", "order", order.id, { orderNo: order.order_no, error: error.message });
    res.status(500).json({
      message: `打印失败：${error.message}；订单 ${order.order_no} 已保存，请检查打印机后到后台重打`,
      id: order.id,
      orderNo: order.order_no,
      generatedAt: order.generated_at
    });
  }
});

app.patch("/api/orders/:id/print-status", requireRole(["super_admin", "admin"]), async (req, res) => {
  const status = req.body.printStatus === "printed" ? "printed" : "pending";
  db.prepare("UPDATE orders SET print_status = ? WHERE id = ? AND deleted_at IS NULL").run(status, req.params.id);
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  writeAuditLog(req, "orders.print_status", "order", order.id, { orderNo: order.order_no, printStatus: status });
  res.json(toPublicOrder(order));
});

app.delete("/api/orders/:id", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.prepare("UPDATE orders SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  writeAuditLog(req, "orders.delete", "order", order.id, { orderNo: order.order_no });
  res.json({ ok: true, order: toPublicOrder(order) });
});

app.patch("/api/orders/:id/restore", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.prepare("UPDATE orders SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  writeAuditLog(req, "orders.restore", "order", order.id, { orderNo: order.order_no });
  res.json(toPublicOrder(getOrderById(req.params.id)));
});

app.get("/api/printers", requireRole(["super_admin", "admin"]), async (_req, res) => {
  try {
    const printers = await getSystemPrinters();
    const settings = await getSettings();
    res.json({
      printers,
      defaultPrinter: printers.find((printer) => printer.isDefault)?.name ?? "",
      selectedPrinter: settings.selectedPrinter
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to read printers", printers: [] });
  }
});

app.put("/api/printers/selected", requireRole(["super_admin"]), async (req, res) => {
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  writeAuditLog(req, "printers.select", "printer", selectedPrinter, {});
  res.json({ selectedPrinter });
});

app.post("/api/printers/test", requireRole(["super_admin", "admin"]), async (req, res) => {
  try {
    const testOrder = {
      order_no: "TEST-PRINT",
      customer_text: "TEST",
      generated_at: new Date().toISOString()
    };
    const result = await printTicketDirect(testOrder, String(req.body?.printerName ?? ""));
    writeAuditLog(req, "printers.test", "printer", result.printerName, {});
    res.json({ ok: true, message: `测试打印已发送：${result.printerName}`, printerName: result.printerName });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `测试打印失败：${error.message}` });
  }
});

app.post("/api/orders/:id/print", requireRole(["super_admin", "admin"]), async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  try {
    const result = await printOrderTicket(order, String(req.body?.printerName ?? ""));
    writeAuditLog(req, "orders.print", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.json({ ok: true, message: `打印已发送：${result.printerName}`, printerName: result.printerName, order: toPublicOrder(order) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `打印失败：${error.message}`, order: toPublicOrder(order) });
  }
});

app.post("/api/orders/:id/print-ticket", requireCustomerAccess, async (req, res) => {
  const user = getRequestUser(req);
  const order = getOrderById(req.params.id, { includeDeleted: false, user });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  try {
    const result = await printOrderTicket(order, String(req.body?.printerName ?? ""));
    writeAuditLog(req, "orders.print_ticket", "order", order.id, { orderNo: order.order_no, printerName: result.printerName });
    res.json({ ok: true, message: `打印已发送：${result.printerName}`, printerName: result.printerName, order: toPublicOrder(order) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `打印失败：${error.message}`, order: toPublicOrder(order) });
  }
});

app.get("/api/orders/:id/download/:type", requireRole(["super_admin", "admin"]), async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) {
    return res.status(400).json({ message: "Unsupported download type" });
  }
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  if (type === "pdf") {
    const pdfBuffer = createTicketPdfBuffer(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${order.order_no}.pdf"`);
    return res.send(pdfBuffer);
  }
  res.download(resolveStoredFilePath(order.png_path), `${order.order_no}.png`);
});

app.get("/api/orders/:id/file/:type", requireRole(["super_admin", "admin"]), async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  if (type === "pdf") {
    res.type("pdf");
    return res.send(createTicketPdfBuffer(order));
  }
  const filePath = resolveStoredFilePath(order.png_path);
  res.type(type);
  res.sendFile(filePath);
});

if (process.env.NODE_ENV === "production") {
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(rootDir, "dist", "index.html"));
  });
}

app.listen(port, host, () => {
  console.log(`API server running at http://${host}:${port}`);
  if (host === "127.0.0.1" || host === "localhost") {
    console.log("Private deployment mode: API is bound to localhost only. Set LUGGAGE_TAG_HOST=0.0.0.0 to expose on LAN/public networks.");
  }
});
