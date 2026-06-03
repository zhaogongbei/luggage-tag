import crypto from "node:crypto";
import { db } from "./db.js";
import {
  sessionCookieName, inviteCookieName, sessionTtlMs, inviteTtlMs,
  superAdminUsername, defaultAdminUsername,
  loginMaxFailures, loginLockMs, forceSecureCookie, trustProxy,
  userRoles, userStatuses
} from "./config.js";

function getRequestIp(req) {
  if (trustProxy && req.headers["x-forwarded-for"]) {
    return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  }
  return String(req.socket.remoteAddress ?? "unknown").split(",")[0].trim();
}

const loginFailures = new Map();
const inviteFailures = new Map();
const orderAccessPrefix = "luggage_tag_order_";
const orderAccessTtlMs = 1000 * 60 * 60 * 2;

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
  const nextFailure = { count: failure.count + 1, lockedUntil: 0 };
  if (nextFailure.count >= loginMaxFailures) {
    nextFailure.lockedUntil = Date.now() + loginLockMs;
  }
  loginFailures.set(ip, nextFailure);
  return nextFailure;
}

function clearLoginFailure(ip) { loginFailures.delete(ip); }

function parseCookies(req) {
  const result = {};
  try {
    const raw = String(req.headers.cookie ?? "");
    for (const cookie of raw.split(";")) {
      const trimmed = cookie.trim();
      if (!trimmed) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        result[trimmed] = "";
      } else {
        try {
          result[decodeURIComponent(trimmed.slice(0, separatorIndex))] = decodeURIComponent(trimmed.slice(separatorIndex + 1));
        } catch { /* skip malformed */ }
      }
    }
  } catch { /* empty */ }
  return result;
}

function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

function createToken(type, ttlMs, userId = null) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR REPLACE INTO auth_tokens (token_hash, type, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
    hashToken(token), type, userId, Date.now() + ttlMs, new Date().toISOString()
  );
  return token;
}

function getTokenRecord(type, token) {
  if (!token) { return null; }
  const tokenHash = hashToken(token);
  const row = db.prepare("SELECT token_hash, user_id, expires_at FROM auth_tokens WHERE token_hash = ? AND type = ?").get(tokenHash, type);
  if (!row) { return null; }
  if (Number(row.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  return row;
}

function isValidToken(type, token) { return Boolean(getTokenRecord(type, token)); }

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[sessionCookieName];
  const tokenRecord = getTokenRecord("staff", token);
  if (!tokenRecord?.user_id) { return null; }
  const user = db.prepare("SELECT id, username, role, status, created_by, created_at, updated_at, last_login_at FROM users WHERE id = ?").get(tokenRecord.user_id);
  if (!user || user.status !== "active") { deleteToken("staff", token); return null; }
  return user;
}

function getRequestUser(req) {
  if (!req.currentUser) { req.currentUser = getSessionUser(req); }
  return req.currentUser;
}

function deleteToken(type, token) {
  if (token) { db.prepare("DELETE FROM auth_tokens WHERE token_hash = ? AND type = ?").run(hashToken(token), type); }
}

function shouldUseSecureCookie(req) {
  return forceSecureCookie || req.secure || req.headers["x-forwarded-proto"] === "https";
}

function setSessionCookie(req, res, token) {
  res.cookie(sessionCookieName, token, { httpOnly: true, maxAge: sessionTtlMs, sameSite: "strict", secure: shouldUseSecureCookie(req), path: "/" });
}

function setInviteCookie(req, res, token) {
  res.cookie(inviteCookieName, token, { httpOnly: true, maxAge: inviteTtlMs, sameSite: "strict", secure: shouldUseSecureCookie(req), path: "/" });
}

function createOrderAccessToken(orderId) {
  return createToken("order", orderAccessTtlMs, orderId);
}

function setOrderAccessCookie(req, res, orderId, token) {
  res.cookie(`${orderAccessPrefix}${orderId}`, token, { httpOnly: true, maxAge: orderAccessTtlMs, sameSite: "strict", secure: shouldUseSecureCookie(req), path: "/" });
}

function hasOrderAccess(req, orderId) {
  const cookies = parseCookies(req);
  const token = cookies[`${orderAccessPrefix}${orderId}`];
  const tokenRecord = getTokenRecord("order", token);
  return Number(tokenRecord?.user_id) === Number(orderId);
}

function clearAuthCookies(req, res) {
  const options = { sameSite: "strict", secure: shouldUseSecureCookie(req), path: "/" };
  res.clearCookie(sessionCookieName, options);
  res.clearCookie(inviteCookieName, options);
}

function toPublicUser(user) {
  if (!user) { return null; }
  return { id: user.id, username: user.username, role: user.role, status: user.status, created_by: user.created_by, created_at: user.created_at, updated_at: user.updated_at, last_login_at: user.last_login_at ?? "" };
}

function hasRole(user, roles) { return Boolean(user && roles.includes(user.role)); }

function isStaffRequest(req) {
  const user = getSessionUser(req);
  return Boolean(user && ["super_admin", "admin"].includes(user.role));
}

function isInviteRequest(req) {
  const cookies = parseCookies(req);
  return isValidToken("invite", cookies[inviteCookieName]);
}

function normalizeUsername(value) { return String(value ?? "").trim().slice(0, 64); }
function normalizePassword(value) { return String(value ?? ""); }
function normalizeUserRole(value) { return userRoles.includes(value) ? value : "client"; }
function normalizeRequestedUserRole(username, role) {
  if (username === superAdminUsername) { return "super_admin"; }
  if (username === defaultAdminUsername) { return "admin"; }
  return role === "super_admin" ? "admin" : role;
}
function validateUserRoleRequest(username, requestedRole) {
  if (requestedRole === "super_admin" && username !== superAdminUsername) {
    throw new Error("Super Admin \u8D26\u53F7\u552F\u4E00\uFF0C\u53EA\u80FD\u662F gongbei");
  }
}
function normalizeUserStatus(value) { return userStatuses.includes(value) ? value : "active"; }

function countActiveSuperAdmins(excludeUserId = null) {
  const row = excludeUserId
    ? db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active' AND id != ?").get(excludeUserId)
    : db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin' AND status = 'active'").get();
  return Number(row?.count ?? 0);
}

function assertCanChangeUser(req, targetUser, nextRole = targetUser?.role, nextStatus = targetUser?.status) {
  const actor = getRequestUser(req);
  if (!targetUser) { throw new Error("\u8D26\u53F7\u4E0D\u5B58\u5728"); }
  if (actor?.role !== "super_admin") { throw new Error("\u65E0\u6743\u7BA1\u7406\u8D26\u53F7"); }
  if (targetUser.id === actor.id && (nextRole !== "super_admin" || nextStatus !== "active")) {
    throw new Error("\u8D85\u7EA7\u7BA1\u7406\u5458\u4E0D\u80FD\u7981\u7528\u6216\u964D\u7EA7\u81EA\u5DF1");
  }
  if (targetUser.username === superAdminUsername && (nextRole !== "super_admin" || nextStatus !== "active")) {
    throw new Error("gongbei \u662F\u552F\u4E00 Super Admin\uFF0C\u4E0D\u80FD\u7981\u7528\u6216\u964D\u7EA7");
  }
  if (targetUser.username !== superAdminUsername && nextRole === "super_admin") {
    throw new Error("Super Admin \u8D26\u53F7\u552F\u4E00\uFF0C\u53EA\u80FD\u662F gongbei");
  }
  if (targetUser.role === "super_admin" && (nextRole !== "super_admin" || nextStatus !== "active") && countActiveSuperAdmins(targetUser.id) < 1) {
    throw new Error("\u81F3\u5C11\u9700\u8981\u4FDD\u7559 gongbei \u4F5C\u4E3A\u542F\u7528\u7684 Super Admin");
  }
}

function getAuditActor(req) {
  const user = getSessionUser(req);
  return user ? { id: user.id, username: user.username, role: user.role } : null;
}

function writeAuditLogEntry(req, actor, action, targetType = "", targetId = "", detail = {}) {
  const ip = getRequestIp(req);
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, role, action, target_type, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(actor?.id ?? null, actor?.username ?? "", actor?.role ?? "", action, targetType, String(targetId ?? ""), JSON.stringify(detail ?? {}), ip, new Date().toISOString());
}

function writeAuditLog(req, action, targetType = "", targetId = "", detail = {}) {
  const actor = getAuditActor(req);
  writeAuditLogEntry(req, actor, action, targetType, targetId, detail);
}

export {
  getRequestIp, loginFailures, inviteFailures,
  getLoginFailure, recordLoginFailure, clearLoginFailure,
  parseCookies, createToken, getTokenRecord, isValidToken,
  getSessionUser, getRequestUser, deleteToken,
  shouldUseSecureCookie, setSessionCookie, setInviteCookie,
  createOrderAccessToken, setOrderAccessCookie, hasOrderAccess,
  clearAuthCookies,
  toPublicUser, hasRole, isStaffRequest, isInviteRequest,
  normalizeUsername, normalizePassword, normalizeUserRole,
  normalizeRequestedUserRole, validateUserRoleRequest, normalizeUserStatus,
  assertCanChangeUser, writeAuditLog, writeAuditLogEntry
};
