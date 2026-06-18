export const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

export const ORDER_PAGE_SIZE = 50;
export const APP_VERSION = "V1.4.46";
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

export const ticketPrintLayout = {
  widthMm: 80,
  heightMm: 60,
  topOffsetMm: 0,
  paddingTopMm: 6,
  nameFontSize: 27.2,
  serialFontSize: 16,
  timeFontSize: 9.6,
  nameMarginBottomMm: 5,
  serialMarginBottomMm: 4,
  footerText: "",
  footerFontSizePt: 6,
  footerOpacity: 20,
  footerBottomMm: 2,
  contentAlign: "center",
};

export const defaultLayoutOptions = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  productWidth: ticketPrintLayout.widthMm,
  productHeight: ticketPrintLayout.heightMm,
  margin: 8,
  gap: 6,
  autoRotate: true,
  cropMarks: true,
  showOrderNo: true,
};

export const layoutPresets = [
  {
    name: "A4 标准",
    options: { paperPreset: "A4", paperWidth: 210, paperHeight: 297, productWidth: ticketPrintLayout.widthMm, productHeight: ticketPrintLayout.heightMm, margin: 8, gap: 6 },
  },
  {
    name: "A3 批量",
    options: { paperPreset: "A3", paperWidth: 297, paperHeight: 420, productWidth: ticketPrintLayout.widthMm, productHeight: ticketPrintLayout.heightMm, margin: 10, gap: 6 },
  },
  {
    name: "A5 小版",
    options: { paperPreset: "A5", paperWidth: 148, paperHeight: 210, productWidth: ticketPrintLayout.widthMm, productHeight: ticketPrintLayout.heightMm, margin: 6, gap: 4 },
  },
];

export const templates = [
  { id: "template_03", name: "Azure Blue", displayName: "蔚蓝色", preview: "/templates/template_03.png", color: "#4A90E2", textColor: "#FFFFFF" },
  { id: "template_02", name: "Light Grey", displayName: "浅灰色", preview: "/templates/template_02.png", color: "#C8CCBE", textColor: "#FFFFFF" },
  { id: "template_01", name: "Light Pink", displayName: "淡粉色", preview: "/templates/template_01.png", color: "#D4A5A5", textColor: "#FFFFFF" },
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
