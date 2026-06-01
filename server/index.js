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
const host = process.env.LUGGAGE_TAG_HOST || process.env.HOST || "127.0.0.1";
const execFileAsync = promisify(execFile);
const sessionCookieName = "luggage_tag_session";
const inviteCookieName = "luggage_tag_invite";
const sessionTtlMs = 1000 * 60 * 60 * 12;
const inviteTtlMs = 1000 * 60 * 60 * 24;
const staffUsername = process.env.LUGGAGE_TAG_STAFF_USER || "admin";
const staffPassword = process.env.LUGGAGE_TAG_STAFF_PASSWORD || "admin123";
const loginFailures = new Map();
const loginMaxFailures = Math.max(3, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_MAX_FAILURES ?? "5", 10) || 5);
const loginLockMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_LOCK_MS ?? "300000", 10) || 300_000);
const backupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_INTERVAL_MS ?? "21600000", 10) || 21_600_000);
const backupRetention = Math.max(1, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_RETENTION ?? "24", 10) || 24);
const exportCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_INTERVAL_MS ?? "86400000", 10) || 86_400_000);
const exportCleanupMinAgeMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_MIN_AGE_MS ?? "604800000", 10) || 604_800_000);
const tokenCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_TOKEN_CLEANUP_INTERVAL_MS ?? "3600000", 10) || 3_600_000);
const forceSecureCookie = process.env.LUGGAGE_TAG_COOKIE_SECURE === "true";
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
    deleted_at TEXT
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
    expires_at INTEGER NOT NULL,
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

if (!process.env.LUGGAGE_TAG_STAFF_PASSWORD || staffPassword === "admin123") {
  console.warn("SECURITY WARNING: LUGGAGE_TAG_STAFF_PASSWORD is not set. Default password admin123 is unsafe for public deployment.");
}

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function migrateOrdersTable() {
  const orderTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
  const needsEventColumn = !hasColumn("orders", "event_id");
  const needsDeletedAtColumn = !hasColumn("orders", "deleted_at");
  const hasGlobalUniqueOrderNo = /\border_no\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(orderTable?.sql ?? "");

  if (!needsEventColumn && !needsDeletedAtColumn && !hasGlobalUniqueOrderNo) {
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
        deleted_at TEXT
      );
    `);
    const eventColumn = needsEventColumn ? "NULL AS event_id" : "event_id";
    const deletedAtColumn = needsDeletedAtColumn ? "NULL AS deleted_at" : "deleted_at";
    db.exec(`
      INSERT INTO orders_next (id, event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, deleted_at)
      SELECT id, ${eventColumn}, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, ${deletedAtColumn}
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

function migrateOrderFilePaths() {
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

migrateOrdersTable();
ensureActiveEvent();
migrateOrderFilePaths();
backupDatabase();
setInterval(backupDatabase, backupIntervalMs).unref();
cleanupExpiredTokens();
setInterval(cleanupExpiredTokens, tokenCleanupIntervalMs).unref();
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

function createToken(type, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR REPLACE INTO auth_tokens (token_hash, type, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    type,
    Date.now() + ttlMs,
    new Date().toISOString()
  );
  return token;
}

function isValidToken(type, token) {
  if (!token) {
    return false;
  }
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT expires_at FROM auth_tokens WHERE token_hash = ? AND type = ?").get(tokenHash, type);
  if (!row) {
    return false;
  }
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(tokenHash);
    return false;
  }
  return true;
}

function deleteToken(type, token) {
  if (token) {
    db.prepare("DELETE FROM auth_tokens WHERE token_hash = ? AND type = ?").run(hashToken(token), type);
  }
}

function cleanupExpiredTokens() {
  db.prepare("DELETE FROM auth_tokens WHERE expires_at <= ?").run(Date.now());
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
  const cookies = parseCookies(req);
  return isValidToken("staff", cookies[sessionCookieName]);
}

function isInviteRequest(req) {
  const cookies = parseCookies(req);
  return isValidToken("invite", cookies[inviteCookieName]);
}

async function getAccessState(req) {
  const settings = await getSettings();
  const authenticated = isStaffRequest(req);
  const invited = isInviteRequest(req);
  const customerAccess = authenticated ||
    settings.deploymentMode === "public" ||
    (settings.deploymentMode === "invite" && invited);
  return {
    authenticated,
    invited,
    customerAccess: settings.deploymentMode === "maintenance" ? false : customerAccess,
    deploymentMode: settings.deploymentMode
  };
}

async function requireStaff(req, res, next) {
  const access = await getAccessState(req);
  if (!access.authenticated) {
    return res.status(401).json({ message: "Staff login required", access });
  }
  next();
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

function getPngSize(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return { width: 900, height: 560 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
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
    deleted_at: order.deleted_at ?? ""
  };
}

function getOrderById(orderId, options = {}) {
  const includeDeleted = Boolean(options.includeDeleted);
  const sql = `
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    WHERE orders.id = ?
    ${includeDeleted ? "" : "AND orders.deleted_at IS NULL"}
  `;
  return db.prepare(sql).get(orderId);
}

function parseOrderIds(value) {
  const rawIds = Array.isArray(value) ? value : String(value ?? "").split(",");
  return rawIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index);
}

function getOrdersByIds(orderIds) {
  if (!orderIds.length) {
    return [];
  }
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    WHERE orders.id IN (${placeholders})
      AND orders.deleted_at IS NULL
  `).all(...orderIds);
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
  if (process.platform !== "win32") {
    return [];
  }
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
    isDefault: Boolean(printer.Default)
  }));
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
  const username = String(req.body.username ?? "");
  const password = String(req.body.password ?? "");
  const { ip, failure } = getLoginFailure(req);
  if (failure.lockedUntil > Date.now()) {
    const retrySeconds = Math.ceil((failure.lockedUntil - Date.now()) / 1000);
    return res.status(429).json({ message: `登录失败次数过多，请 ${retrySeconds} 秒后再试` });
  }
  if (username !== staffUsername || password !== staffPassword) {
    const nextFailure = recordLoginFailure(ip, failure);
    if (nextFailure.lockedUntil > Date.now()) {
      const retrySeconds = Math.ceil((nextFailure.lockedUntil - Date.now()) / 1000);
      return res.status(429).json({ message: `登录失败次数过多，请 ${retrySeconds} 秒后再试` });
    }
    return res.status(401).json({ message: "账号或密码错误" });
  }
  clearLoginFailure(ip);
  setSessionCookie(req, res, createToken("staff", sessionTtlMs));
  const settings = await getSettings();
  res.json({
    authenticated: true,
    invited: false,
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
  deleteToken("staff", cookies[sessionCookieName]);
  deleteToken("invite", cookies[inviteCookieName]);
  clearAuthCookies(req, res);
  res.json({ ok: true });
});

app.get("/api/settings", requireSettingsAccess, async (req, res) => {
  const settings = await getSettings();
  res.json({
    ...toClientSettings(settings),
    ...(isStaffRequest(req) ? { selectedPrinter: settings.selectedPrinter, inviteCode: settings.inviteCode } : {})
  });
});

app.put("/api/settings", requireStaff, async (req, res) => {
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
  res.json(await getSettings());
});

app.post("/api/events/reset", requireStaff, async (req, res) => {
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

app.get("/api/orders", requireStaff, async (req, res) => {
  const includeDeleted = req.query.deleted === "true";
  const rows = db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    WHERE ${includeDeleted ? "orders.deleted_at IS NOT NULL" : "orders.deleted_at IS NULL"}
    ORDER BY orders.id DESC
  `).all();
  res.json(rows.map(toPublicOrder));
});

app.post("/api/layout/preview", requireStaff, async (req, res) => {
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

app.post("/api/orders/imposition", requireStaff, async (req, res) => {
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
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Failed to create imposition PDF" });
  }
});

app.post("/api/orders/a4-layout", requireStaff, async (req, res) => {
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

app.get("/api/orders/batch", requireStaff, async (req, res) => {
  const orderIds = parseOrderIds(req.query.ids);
  const orders = getOrdersByIds(orderIds);
  res.json(orders.map(toPublicOrder));
});

app.get("/api/orders/:id", requireStaff, async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.get("/api/orders/:id/ticket", requireCustomerAccess, async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.post("/api/orders", requireCustomerAccess, async (req, res) => {
  const templateId = String(req.body.templateId ?? "");
  const rawCustomerText = String(req.body.customerText ?? "");
  const customerText = normalizeCustomerName(rawCustomerText);
  const pngDataUrl = String(req.body.pngDataUrl ?? "");

  if (!templateIds.includes(templateId)) {
    return res.status(400).json({ message: "Invalid template" });
  }
  if (!isValidRawCustomerName(rawCustomerText) || !isValidCustomerName(customerText)) {
    return res.status(400).json({ message: "Customer name must contain 1-12 English letters only" });
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
      `INSERT INTO orders (event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      activeEvent.id,
      orderNo,
      templateId,
      customerText,
      generatedAt,
      pngPath,
      pdfPath
    );
    const nextNumber = Number(activeEvent.current_number) + 1;
    db.prepare("UPDATE events SET current_number = ? WHERE id = ?").run(nextNumber, activeEvent.id);
    syncLegacyNumberSettings({ ...activeEvent, current_number: nextNumber });
    db.exec("COMMIT");
    created = { id: result.lastInsertRowid, orderNo, generatedAt, pngPath, pdfPath };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    console.error(error);
    return res.status(500).json({ message: "Failed to create order" });
  }

  try {
    await fs.writeFile(resolveStoredFilePath(created.pngPath), imageDataToBuffer(pngDataUrl));
    await createTicketPdf(
      { order_no: created.orderNo, customer_text: customerText, generated_at: created.generatedAt },
      resolveStoredFilePath(created.pdfPath)
    );
  } catch (error) {
    db.prepare("DELETE FROM orders WHERE id = ?").run(created.id);
    console.error(error);
    return res.status(500).json({ message: "Failed to save order files" });
  }
  res.status(201).json({ id: created.id, orderNo: created.orderNo, generatedAt: created.generatedAt });
});

app.patch("/api/orders/:id/print-status", requireStaff, async (req, res) => {
  const status = req.body.printStatus === "printed" ? "printed" : "pending";
  db.prepare("UPDATE orders SET print_status = ? WHERE id = ? AND deleted_at IS NULL").run(status, req.params.id);
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.delete("/api/orders/:id", requireStaff, async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.prepare("UPDATE orders SET deleted_at = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
  res.json({ ok: true, order: toPublicOrder(order) });
});

app.patch("/api/orders/:id/restore", requireStaff, async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.prepare("UPDATE orders SET deleted_at = NULL WHERE id = ?").run(req.params.id);
  res.json(toPublicOrder(getOrderById(req.params.id)));
});

app.get("/api/printers", requireStaff, async (_req, res) => {
  try {
    const printers = await getWindowsPrinters();
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

app.put("/api/printers/selected", requireStaff, async (req, res) => {
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  res.json({ selectedPrinter });
});

app.post("/api/printers/test", requireStaff, async (_req, res) => {
  res.status(501).json({
    message: "Local print service is reserved for V2 and is not enabled in browser-print mode."
  });
});

app.post("/api/orders/:id/print", requireStaff, async (req, res) => {
  const order = getOrderById(req.params.id, { includeDeleted: true });
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.status(501).json({
    message: "Local direct printing is reserved for V2. Use the browser print preview page in V1.",
    order: toPublicOrder(order)
  });
});

app.get("/api/orders/:id/download/:type", requireStaff, async (req, res) => {
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

app.get("/api/orders/:id/file/:type", requireStaff, async (req, res) => {
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
