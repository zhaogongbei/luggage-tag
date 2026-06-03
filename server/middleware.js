import { getSessionUser, getRequestUser, hasRole, isInviteRequest } from "./auth.js";
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

export { getAccessState, requireRole, requireCustomerAccess, requireSettingsAccess };