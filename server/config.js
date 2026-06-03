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
  tokenCleanupIntervalMs, auditLogRetention,
  forceSecureCookie, trustProxy, allowDefaultPasswordOnPublicHost,
  brandLogoCandidates, allowedOrigins,
  defaultSettings, deploymentModes, userRoles, userStatuses,
  templateIds, paperPresets, defaultLayoutOptions,
  normalizePathForCompare, toRelativeExportPath,
  resolveStoredFilePath, getExportRelativePath
};
