import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const sessionCookieName = "luggage_tag_session";
const inviteCookieName = "luggage_tag_invite";
const sessionTtlMs = 1000 * 60 * 60 * 12;
const inviteTtlMs = 1000 * 60 * 60 * 24;

const superAdminUsername = "gongbei";
const defaultAdminUsername = "admin";
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || process.env.LUGGAGE_TAG_STAFF_PASSWORD || "admin123";

const loginMaxFailures = Math.max(3, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_MAX_FAILURES ?? "5", 10) || 5);
const loginLockMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_LOGIN_LOCK_MS ?? "300000", 10) || 300_000);
const backupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_INTERVAL_MS ?? "21600000", 10) || 21_600_000);
const backupRetention = Math.max(1, Number.parseInt(process.env.LUGGAGE_TAG_BACKUP_RETENTION ?? "24", 10) || 24);
const exportCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_INTERVAL_MS ?? "86400000", 10) || 86_400_000);
const exportCleanupMinAgeMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_EXPORT_CLEANUP_MIN_AGE_MS ?? "604800000", 10) || 604_800_000);
const tokenCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_TOKEN_CLEANUP_INTERVAL_MS ?? "3600000", 10) || 3_600_000);
const auditCleanupIntervalMs = Math.max(60_000, Number.parseInt(process.env.LUGGAGE_TAG_AUDIT_CLEANUP_INTERVAL_MS ?? String(tokenCleanupIntervalMs), 10) || tokenCleanupIntervalMs);
const auditLogRetention = Math.max(1000, Number.parseInt(process.env.LUGGAGE_TAG_AUDIT_RETENTION ?? "5000", 10) || 5000);
const forceSecureCookie = process.env.LUGGAGE_TAG_COOKIE_SECURE === "true";
const trustProxy = process.env.LUGGAGE_TAG_TRUST_PROXY === "true";
const allowDefaultPasswordOnPublicHost = process.env.LUGGAGE_TAG_ALLOW_DEFAULT_PASSWORD_ON_PUBLIC_HOST === "true";

const brandLogoCandidates = [
  process.env.LUGGAGE_TAG_BRAND_LOGO_PATH,
  path.join(rootDir, "public", "brand-logo.png"),
  path.join(rootDir, "public", "brand-logo.svg")
].filter(Boolean);

const allowedOrigins = String(process.env.LUGGAGE_TAG_ALLOW_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function parseLayoutNumber(value, fallback, min, max) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) { return fallback; }
  return Math.min(max, Math.max(min, number));
}

function readLayoutNumber(envName, fallback, min, max) {
  const snakeName = envName.replace(/^LUGGAGE_TAG_/, "").toLowerCase();
  return parseLayoutNumber(process.env[envName] ?? process.env[snakeName], fallback, min, max);
}

function normalizeTicketContentAlign(value, fallback = "center") {
  const align = String(value ?? fallback).toLowerCase();
  return ["left", "center", "right"].includes(align) ? align : "center";
}

const ticketPrintLayout = {
  widthMm: readLayoutNumber("LUGGAGE_TAG_TICKET_WIDTH_MM", 80, 20, 300),
  heightMm: readLayoutNumber("LUGGAGE_TAG_TICKET_HEIGHT_MM", 60, 20, 300),
  topOffsetMm: readLayoutNumber("LUGGAGE_TAG_TICKET_TOP_OFFSET_MM", 0, -50, 50),
  paddingTopMm: readLayoutNumber("LUGGAGE_TAG_TICKET_PADDING_TOP_MM", 6, 0, 100),
  nameFontSize: readLayoutNumber("LUGGAGE_TAG_TICKET_NAME_FONT_SIZE", 27.2, 6, 120),
  serialFontSize: readLayoutNumber("LUGGAGE_TAG_TICKET_SERIAL_FONT_SIZE", 16, 6, 80),
  timeFontSize: readLayoutNumber("LUGGAGE_TAG_TICKET_TIME_FONT_SIZE", 9.6, 4, 48),
  nameMarginBottomMm: 5,
  serialMarginBottomMm: 4,
  footerText: String(process.env.LUGGAGE_TAG_TICKET_FOOTER_TEXT ?? process.env.ticket_footer_text ?? "").slice(0, 200),
  footerFontSizePt: readLayoutNumber("LUGGAGE_TAG_TICKET_FOOTER_FONT_SIZE_PT", 6, 2, 20),
  footerOpacity: readLayoutNumber("LUGGAGE_TAG_TICKET_FOOTER_OPACITY", 20, 0, 100),
  footerBottomMm: readLayoutNumber("LUGGAGE_TAG_TICKET_FOOTER_BOTTOM_MM", 2, 0, 30),
  contentAlign: normalizeTicketContentAlign(process.env.LUGGAGE_TAG_TICKET_CONTENT_ALIGN ?? process.env.ticket_content_align, "center")
};

function normalizeTicketPrintLayout(value = {}, fallback = ticketPrintLayout) {
  return {
    widthMm: parseLayoutNumber(value.widthMm ?? value.ticketWidthMm, fallback.widthMm, 20, 300),
    heightMm: parseLayoutNumber(value.heightMm ?? value.ticketHeightMm, fallback.heightMm, 20, 300),
    topOffsetMm: parseLayoutNumber(value.topOffsetMm ?? value.ticketTopOffsetMm, fallback.topOffsetMm, -50, 50),
    paddingTopMm: parseLayoutNumber(value.paddingTopMm ?? value.ticketPaddingTopMm, fallback.paddingTopMm, 0, 100),
    nameFontSize: parseLayoutNumber(value.nameFontSize ?? value.ticketNameFontSize, fallback.nameFontSize, 6, 120),
    serialFontSize: parseLayoutNumber(value.serialFontSize ?? value.ticketSerialFontSize, fallback.serialFontSize, 6, 80),
    timeFontSize: parseLayoutNumber(value.timeFontSize ?? value.ticketTimeFontSize, fallback.timeFontSize, 4, 48),
    nameMarginBottomMm: parseLayoutNumber(value.nameMarginBottomMm ?? value.ticketNameMarginBottomMm, fallback.nameMarginBottomMm, 0, 50),
    serialMarginBottomMm: parseLayoutNumber(value.serialMarginBottomMm ?? value.ticketSerialMarginBottomMm, fallback.serialMarginBottomMm, 0, 50),
    footerText: String(value.footerText ?? value.ticketFooterText ?? fallback.footerText ?? "").slice(0, 200),
    footerFontSizePt: parseLayoutNumber(value.footerFontSizePt ?? value.ticketFooterFontSizePt, fallback.footerFontSizePt, 2, 20),
    footerOpacity: parseLayoutNumber(value.footerOpacity ?? value.ticketFooterOpacity, fallback.footerOpacity, 0, 100),
    footerBottomMm: parseLayoutNumber(value.footerBottomMm ?? value.ticketFooterBottomMm, fallback.footerBottomMm, 0, 30),
    contentAlign: normalizeTicketContentAlign(value.contentAlign ?? value.ticketContentAlign ?? value.textAlign ?? value.ticketTextAlign, fallback.contentAlign)
  };
}

const defaultSettings = {
  prefix: "No.",
  currentNumber: "1",
  digits: "4",
  watermarkEnabled: "true",
  creatorAutoPrint: "false",
  creatorAutoReturn: "false",
  selectedPrinter: "",
  deploymentMode: "private",
  inviteCode: "",
  ticketWidthMm: String(ticketPrintLayout.widthMm),
  ticketHeightMm: String(ticketPrintLayout.heightMm),
  ticketTopOffsetMm: String(ticketPrintLayout.topOffsetMm),
  ticketPaddingTopMm: String(ticketPrintLayout.paddingTopMm),
  ticketNameFontSize: String(ticketPrintLayout.nameFontSize),
  ticketSerialFontSize: String(ticketPrintLayout.serialFontSize),
  ticketTimeFontSize: String(ticketPrintLayout.timeFontSize),
  ticketNameMarginBottomMm: String(ticketPrintLayout.nameMarginBottomMm),
  ticketSerialMarginBottomMm: String(ticketPrintLayout.serialMarginBottomMm),
  ticketFooterText: ticketPrintLayout.footerText,
  ticketFooterFontSizePt: String(ticketPrintLayout.footerFontSizePt),
  ticketFooterOpacity: String(ticketPrintLayout.footerOpacity),
  ticketFooterBottomMm: String(ticketPrintLayout.footerBottomMm),
  ticketContentAlign: ticketPrintLayout.contentAlign
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
  productWidth: ticketPrintLayout.widthMm,
  productHeight: ticketPrintLayout.heightMm,
  margin: 8,
  gap: 6,
  showOrderNo: true,
  cropMarks: true,
  autoRotate: true
};

await fs.mkdir(exportDir, { recursive: true });
await fs.mkdir(backupDir, { recursive: true });

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

export {
  rootDir, dataDir, exportDir, backupDir, dbPath, port, host,
  sessionCookieName, inviteCookieName, sessionTtlMs, inviteTtlMs,
  superAdminUsername, defaultAdminUsername, superAdminPassword,
  loginMaxFailures, loginLockMs,
  backupIntervalMs, backupRetention,
  exportCleanupIntervalMs, exportCleanupMinAgeMs,
  tokenCleanupIntervalMs, auditCleanupIntervalMs, auditLogRetention,
  forceSecureCookie, trustProxy, allowDefaultPasswordOnPublicHost,
  brandLogoCandidates, allowedOrigins,
  defaultSettings, deploymentModes, userRoles, userStatuses,
  templateIds, paperPresets, defaultLayoutOptions, ticketPrintLayout, normalizeTicketPrintLayout,
  normalizePathForCompare, toRelativeExportPath,
  resolveStoredFilePath, getExportRelativePath
};
