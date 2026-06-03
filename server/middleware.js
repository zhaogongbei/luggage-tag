import { getSessionUser, getRequestUser, getRequestIp, hasRole, isInviteRequest } from "./auth.js";
import { getSettings } from "./db.js";

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

const requestLimits = new Map();

function getRateLimitKey(req, resource = "") {
  const ip = getRequestIp(req);
  const userId = getRequestUser(req)?.id ?? "";
  return `${ip}:${userId}:${resource}`;
}

function checkRateLimit(key, maxRequests = 100, windowMs = 1000) {
  const now = Date.now();
  const entry = requestLimits.get(key);
  if (!entry || now - entry.resetTime >= windowMs) {
    requestLimits.set(key, { count: 1, resetTime: now });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetTime + windowMs - now) / 1000) };
  }
  return { allowed: true, remaining: maxRequests - entry.count };
}

function rateLimitMiddleware(resource, maxRequests = 100, windowMs = 1000) {
  return (req, res, next) => {
    const key = getRateLimitKey(req, resource);
    const limit = checkRateLimit(key, maxRequests, windowMs);
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, limit.remaining));
    if (!limit.allowed) {
      res.setHeader("Retry-After", limit.retryAfter);
      return res.status(429).json({ message: `\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7${limit.retryAfter}\u79D2\u540E\u91CD\u8BD5` });
    }
    next();
  };
}

function cleanupRateLimitMap() {
  const now = Date.now();
  for (const [key, entry] of requestLimits.entries()) {
    if (now - entry.resetTime > 60_000) requestLimits.delete(key);
  }
}
setInterval(cleanupRateLimitMap, 30_000).unref();

export { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess, rateLimitMiddleware };