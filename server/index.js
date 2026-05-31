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
const sessions = new Map();
const invites = new Map();

await fs.mkdir(exportDir, { recursive: true });

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
    pdf_path TEXT NOT NULL
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

function hasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function migrateOrdersTable() {
  const orderTable = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get();
  const needsEventColumn = !hasColumn("orders", "event_id");
  const hasGlobalUniqueOrderNo = /\border_no\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(orderTable?.sql ?? "");

  if (!needsEventColumn && !hasGlobalUniqueOrderNo) {
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
        pdf_path TEXT NOT NULL
      );
    `);
    const eventColumn = needsEventColumn ? "NULL AS event_id" : "event_id";
    db.exec(`
      INSERT INTO orders_next (id, event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path)
      SELECT id, ${eventColumn}, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path
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

migrateOrdersTable();
ensureActiveEvent();

const app = express();
app.use(cors({ origin: true, credentials: true }));
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

function createToken(store, ttlMs) {
  const token = crypto.randomBytes(32).toString("hex");
  store.set(token, Date.now() + ttlMs);
  return token;
}

function isValidToken(store, token) {
  const expiresAt = store.get(token);
  if (!expiresAt) {
    return false;
  }
  if (expiresAt <= Date.now()) {
    store.delete(token);
    return false;
  }
  return true;
}

function setSessionCookie(res, token) {
  res.cookie(sessionCookieName, token, {
    httpOnly: true,
    maxAge: sessionTtlMs,
    sameSite: "lax"
  });
}

function setInviteCookie(res, token) {
  res.cookie(inviteCookieName, token, {
    httpOnly: true,
    maxAge: inviteTtlMs,
    sameSite: "lax"
  });
}

function clearAuthCookies(res) {
  res.clearCookie(sessionCookieName, { sameSite: "lax" });
  res.clearCookie(inviteCookieName, { sameSite: "lax" });
}

function isStaffRequest(req) {
  const cookies = parseCookies(req);
  return isValidToken(sessions, cookies[sessionCookieName]);
}

function isInviteRequest(req) {
  const cookies = parseCookies(req);
  return isValidToken(invites, cookies[inviteCookieName]);
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
  const upperValue = value.trim().toUpperCase();
  const hasChinese = /[\u3400-\u9fff]/.test(upperValue);
  return Array.from(upperValue).slice(0, hasChinese ? 6 : 12).join("");
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
    print_status: order.print_status
  };
}

function getOrderById(orderId) {
  return db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
    WHERE orders.id = ?
  `).get(orderId);
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
  if (username !== staffUsername || password !== staffPassword) {
    return res.status(401).json({ message: "账号或密码错误" });
  }
  setSessionCookie(res, createToken(sessions, sessionTtlMs));
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
  setInviteCookie(res, createToken(invites, inviteTtlMs));
  res.json({
    authenticated: false,
    invited: true,
    customerAccess: true,
    deploymentMode: settings.deploymentMode
  });
});

app.post("/api/auth/logout", async (req, res) => {
  const cookies = parseCookies(req);
  sessions.delete(cookies[sessionCookieName]);
  invites.delete(cookies[inviteCookieName]);
  clearAuthCookies(res);
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

app.get("/api/orders", requireStaff, async (_req, res) => {
  const rows = db.prepare(`
    SELECT orders.*, events.name AS event_name, events.event_date AS event_date
    FROM orders
    LEFT JOIN events ON events.id = orders.event_id
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
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.get("/api/orders/:id/ticket", requireCustomerAccess, async (req, res) => {
  const order = getOrderById(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.post("/api/orders", requireCustomerAccess, async (req, res) => {
  const templateId = String(req.body.templateId ?? "");
  const customerText = normalizeCustomerName(String(req.body.customerText ?? ""));
  const pngDataUrl = String(req.body.pngDataUrl ?? "");

  if (!templateIds.includes(templateId)) {
    return res.status(400).json({ message: "Invalid template" });
  }
  if (!customerText) {
    return res.status(400).json({ message: "Customer text is required" });
  }

  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    const activeEvent = getActiveEvent();
    const orderNo = formatEventOrderNo(activeEvent);
    const generatedAt = new Date().toISOString();
    const safeName = `${orderNo}-${generatedAt}-${crypto.randomBytes(4).toString("hex")}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const pngPath = path.join(exportDir, `${safeName}.png`);
    const pdfPath = path.join(exportDir, `${safeName}.pdf`);

    await fs.writeFile(pngPath, imageDataToBuffer(pngDataUrl));
    await createTicketPdf({ order_no: orderNo, customer_text: customerText, generated_at: generatedAt }, pdfPath);
    db.prepare(
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
    const order = db.prepare("SELECT id FROM orders WHERE event_id = ? AND order_no = ? ORDER BY id DESC LIMIT 1").get(activeEvent.id, orderNo);
    res.status(201).json({ id: order.id, orderNo, generatedAt });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    console.error(error);
    res.status(500).json({ message: "Failed to create order" });
  }
});

app.patch("/api/orders/:id/print-status", requireStaff, async (req, res) => {
  const status = req.body.printStatus === "printed" ? "printed" : "pending";
  db.prepare("UPDATE orders SET print_status = ? WHERE id = ?").run(status, req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  res.json(toPublicOrder(order));
});

app.delete("/api/orders/:id", requireStaff, async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  db.prepare("DELETE FROM orders WHERE id = ?").run(req.params.id);
  await Promise.allSettled([
    fs.unlink(order.png_path),
    fs.unlink(order.pdf_path)
  ]);
  res.json({ ok: true, order: toPublicOrder(order) });
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
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
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
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  if (type === "pdf") {
    const pdfBuffer = createTicketPdfBuffer(order);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${order.order_no}.pdf"`);
    return res.send(pdfBuffer);
  }
  res.download(order.png_path, `${order.order_no}.png`);
});

app.get("/api/orders/:id/file/:type", requireStaff, async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  if (type === "pdf") {
    res.type("pdf");
    return res.send(createTicketPdfBuffer(order));
  }
  const filePath = order.png_path;
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
