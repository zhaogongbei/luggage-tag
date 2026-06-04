export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

export const ORDER_PAGE_SIZE = 50;
export const APP_VERSION = "V1.4.44";
export const BRAND_LOGO_SRC = `${API_BASE}/brand-logo?v=${encodeURIComponent(APP_VERSION)}`;

export const roleLabels = {
  super_admin: "Super Admin",
  admin: "Admin",
  client: "Client",
};

export const statusLabels = {
  active: "Active",
  disabled: "Disabled",
};

export const deploymentModes = [
  { value: "private", label: "Private", description: "仅员工登录后可使用定制页和后台" },
  { value: "invite", label: "Invite", description: "邀请码可访问定制页，后台仍需员工登录" },
  { value: "public", label: "Public", description: "定制页公开，后台仍需员工登录" },
  { value: "maintenance", label: "Maintenance", description: "维护中，仅员工可登录后台切换模式" },
];

export const paperPresets = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  CUSTOM: { width: 210, height: 297 },
};

export const defaultLayoutOptions = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  productWidth: 70,
  productHeight: 110,
  margin: 8,
  gap: 6,
  autoRotate: true,
  cropMarks: true,
  showOrderNo: true,
};

export const layoutPresets = [
  {
    name: "A4 标准",
    options: { paperPreset: "A4", paperWidth: 210, paperHeight: 297, productWidth: 70, productHeight: 110, margin: 8, gap: 6 },
  },
  {
    name: "A3 批量",
    options: { paperPreset: "A3", paperWidth: 297, paperHeight: 420, productWidth: 70, productHeight: 110, margin: 10, gap: 6 },
  },
  {
    name: "A5 小版",
    options: { paperPreset: "A5", paperWidth: 148, paperHeight: 210, productWidth: 70, productHeight: 110, margin: 6, gap: 4 },
  },
];

export const templates = [
  { id: "template_01", name: "Deep Grey", displayName: "深灰色", preview: "/templates/template_01.png", color: "#6B625C", textColor: "#F7F1E8" },
  { id: "template_02", name: "Beige", displayName: "米灰色", preview: "/templates/template_02.png", color: "#B9B39D", textColor: "#111111" },
  { id: "template_03", name: "Cathay Green", displayName: "国泰绿", preview: "/templates/template_03.png", color: "#0E4F45", textColor: "#F7F1E8" },
];

export const legacyTemplateNames = {
  classic: "Classic",
  bold: "Bold",
  fresh: "Fresh",
};

export const templateImageCache = new Map();

export function createEventFormFromSettings(settings) {
  return {
    name: settings.activeEvent?.name ?? "",
    prefix: settings.activeEvent?.prefix ?? settings.prefix ?? "No.",
    eventDate: settings.activeEvent?.eventDate ?? new Date().toISOString().slice(0, 10),
    startNumber: settings.activeEvent?.currentNumber ?? settings.currentNumber ?? 1,
    digits: settings.activeEvent?.digits ?? settings.digits ?? 4,
  };
}
