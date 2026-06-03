import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  FileClock,
  Home,
  LogIn,
  LogOut,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Users,
  X
} from "lucide-react";
import "./styles.css";
import EscPos from "./plugins/escpos";

const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : window.location.origin);
const APP_VERSION = "V1.4.40";
const BRAND_LOGO_SRC = `${API_BASE}/brand-logo?v=${encodeURIComponent(APP_VERSION)}`;
const roleLabels = {
  super_admin: "Super Admin",
  admin: "Admin",
  client: "Client"
};
const statusLabels = {
  active: "Active",
  disabled: "Disabled"
};
const deploymentModes = [
  { value: "private", label: "Private", description: "仅员工登录后可使用定制页和后台" },
  { value: "invite", label: "Invite", description: "邀请码可访问定制页，后台仍需员工登录" },
  { value: "public", label: "Public", description: "定制页公开，后台仍需员工登录" },
  { value: "maintenance", label: "Maintenance", description: "维护中，仅员工可登录后台切换模式" }
];
const paperPresets = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  CUSTOM: { width: 210, height: 297 }
};
const defaultLayoutOptions = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  productWidth: 70,
  productHeight: 110,
  margin: 8,
  gap: 6,
  autoRotate: true,
  cropMarks: true,
  showOrderNo: true
};
const layoutPresets = [
  { name: "A4 标准", options: { paperPreset: "A4", paperWidth: 210, paperHeight: 297, productWidth: 70, productHeight: 110, margin: 8, gap: 6 } },
  { name: "A3 批量", options: { paperPreset: "A3", paperWidth: 297, paperHeight: 420, productWidth: 70, productHeight: 110, margin: 10, gap: 6 } },
  { name: "A5 小版", options: { paperPreset: "A5", paperWidth: 148, paperHeight: 210, productWidth: 70, productHeight: 110, margin: 6, gap: 4 } }
];

function createEventFormFromSettings(settings) {
  return {
    name: settings.activeEvent?.name ?? "",
    prefix: settings.activeEvent?.prefix ?? settings.prefix ?? "No.",
    eventDate: settings.activeEvent?.eventDate ?? new Date().toISOString().slice(0, 10),
    startNumber: settings.activeEvent?.currentNumber ?? settings.currentNumber ?? 1,
    digits: settings.activeEvent?.digits ?? settings.digits ?? 4
  };
}

const templates = [
  {
    id: "template_01",
    name: "Deep Grey",
    displayName: "深灰色",
    preview: "/templates/template_01.png",
    color: "#6B625C",
    textColor: "#F7F1E8"
  },
  {
    id: "template_02",
    name: "Beige",
    displayName: "米灰色",
    preview: "/templates/template_02.png",
    color: "#B9B39D",
    textColor: "#111111"
  },
  {
    id: "template_03",
    name: "Cathay Green",
    displayName: "国泰绿",
    preview: "/templates/template_03.png",
    color: "#0E4F45",
    textColor: "#F7F1E8"
  }
];
const templateImageCache = new Map();

function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {})
    }
  });
}

function BrandLogo({ className = "" }) {
  return <img alt="China Southern Airlines" className={`brand-logo-img ${className}`.trim()} src={BRAND_LOGO_SRC} />;
}

const legacyTemplateNames = {
  classic: "Classic",
  bold: "Bold",
  fresh: "Fresh"
};

function formatDateTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}

function normalizeCustomerName(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, "")
    .replace(/^ +/g, "")
    .replace(/ {2,}/g, " ")
    .slice(0, 12);
}

function finalizeCustomerName(value) {
  return normalizeCustomerName(value).trim();
}

function isValidCustomerName(value) {
  return /^[A-Z]+(?: [A-Z]+)*$/.test(value) && value.length <= 12;
}

function parseBooleanParam(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function drawCenteredText(ctx, text, x, y, font, color) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawTag(canvas, { template, customerText, orderNo, watermarkEnabled, timestamp, image, showMeta = true }) {
  const ctx = canvas.getContext("2d");
  const width = image?.naturalWidth || 900;
  const height = image?.naturalHeight || 560;
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.fillStyle = template.color;
    ctx.fillRect(0, 0, width, height);
  }

  const name = normalizeCustomerName(customerText) || "MARISSA";
  const centerX = width / 2;
  const ink = template.textColor;
  if (showMeta) {
    drawCenteredText(ctx, orderNo, centerX, height * 0.62, "600 14pt Montserrat, Helvetica, Arial, sans-serif", ink);
  }
  drawCenteredText(ctx, name, centerX, showMeta ? height * 0.69 : height * 0.69, "700 28pt Helvetica, Arial, sans-serif", ink);

  if (showMeta && watermarkEnabled) {
    drawCenteredText(
      ctx,
      formatDateTime(timestamp),
      centerX,
      height * 0.76,
      "500 10pt Helvetica, Arial, sans-serif",
      ink
    );
  }
}

function getTemplateImage(template) {
  const cachedImage = templateImageCache.get(template.preview);
  if (cachedImage) {
    return cachedImage;
  }
  const image = new Image();
  image.src = template.preview;
  templateImageCache.set(template.preview, image);
  return image;
}

function CanvasPreview({ template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef, showMeta = true }) {
  useEffect(() => {
    let cancelled = false;
    const image = getTemplateImage(template);
    function redraw() {
      if (!cancelled && canvasRef.current) {
        drawTag(canvasRef.current, { template, customerText, orderNo, watermarkEnabled, timestamp, image, showMeta });
      }
    }
    if (image.complete && image.naturalWidth) {
      redraw();
    } else {
      image.addEventListener("load", redraw, { once: true });
    }
    return () => {
      cancelled = true;
      image.removeEventListener("load", redraw);
    };
  }, [template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef, showMeta]);

  return <canvas className="tag-canvas" ref={canvasRef} />;
}

function TicketPrint({ order }) {
  return (
    <div className="ticket-print">
      <strong className="ticket-name">{order.customer_text}</strong>
      <span className="ticket-no">{order.order_no}</span>
      <time className="ticket-time">{formatDateTime(order.generated_at)}</time>
    </div>
  );
}

function PrintPage({ orderId }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@page { size: 7cm 11cm; margin: 0; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    async function loadOrder() {
      try {
        const response = await apiFetch(`/api/orders/${orderId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "订单不存在");
        }
        setOrder(data);
      } catch (loadError) {
        setError(loadError.message);
      }
    }
    loadOrder();
  }, [orderId]);

  useEffect(() => {
    if (order) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [order]);

  function printNow() {
    window.print();
  }

  if (error) {
    return (
      <main className="print-page">
        <p className="message">{error}</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="print-page">
        <p>Loading...</p>
      </main>
    );
  }

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <div>
          <strong>{order.order_no}</strong>
          <span>{order.customer_text}</span>
        </div>
        <button className="primary-btn compact" onClick={printNow} type="button">
          <Printer size={18} />
          打印
        </button>
      </div>
      <section className="print-sheet">
        <TicketPrint order={order} />
      </section>
    </main>
  );
}

function CustomerTicketPrintPage({ orderId, autoReturn }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = "@page { size: 7cm 11cm; margin: 0; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    async function loadOrder() {
      try {
        const response = await apiFetch(`/api/orders/${orderId}/ticket`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.message || "订单不存在");
        }
        setOrder(data);
      } catch (loadError) {
        setError(loadError.message);
      }
    }
    loadOrder();
  }, [orderId]);

  useEffect(() => {
    if (!order) {
      return undefined;
    }
    const printTimer = window.setTimeout(() => window.print(), 350);
    let returnTimer;
    if (autoReturn) {
      returnTimer = window.setTimeout(() => window.location.replace("/creator"), 1800);
    }
    return () => {
      window.clearTimeout(printTimer);
      if (returnTimer) {
        window.clearTimeout(returnTimer);
      }
    };
  }, [order, autoReturn]);

  if (error) {
    return <main className="print-page"><p className="message">{error}</p></main>;
  }

  if (!order) {
    return <main className="print-page"><p>Loading...</p></main>;
  }

  return (
    <main className="print-page">
      <section className="print-sheet">
        <TicketPrint order={order} />
      </section>
    </main>
  );
}

function chunkOrders(orders, capacity) {
  const pages = [];
  for (let index = 0; index < orders.length; index += capacity) {
    pages.push(orders.slice(index, index + capacity));
  }
  return pages;
}

function normalizeLayoutOptions(options) {
  const presetSize = paperPresets[options.paperPreset] ?? paperPresets.A4;
  return {
    ...options,
    paperWidth: options.paperPreset === "CUSTOM" ? Number(options.paperWidth) : presetSize.width,
    paperHeight: options.paperPreset === "CUSTOM" ? Number(options.paperHeight) : presetSize.height,
    productWidth: Number(options.productWidth),
    productHeight: Number(options.productHeight),
    margin: Number(options.margin),
    gap: Number(options.gap)
  };
}

function ImpositionPrintPage({ orderIds, layoutOptions }) {
  const [orders, setOrders] = useState([]);
  const [layout, setLayout] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadPrintData() {
      try {
        const [ordersResponse, layoutResponse] = await Promise.all([
          apiFetch(`/api/orders/batch?ids=${orderIds.join(",")}`),
          apiFetch(`/api/layout/preview`, {
            method: "POST",
            body: JSON.stringify({ layoutOptions: normalizeLayoutOptions(layoutOptions) })
          })
        ]);
        const ordersData = await ordersResponse.json();
        const layoutData = await layoutResponse.json();
        if (!ordersResponse.ok) {
          throw new Error(ordersData.message || "无法加载拼版订单");
        }
        if (!layoutResponse.ok) {
          throw new Error(layoutData.message || "无法计算拼版");
        }
        setOrders(ordersData);
        setLayout(layoutData);
      } catch (loadError) {
        setError(loadError.message);
      }
    }
    loadPrintData();
  }, [orderIds, layoutOptions]);

  useEffect(() => {
    const style = document.createElement("style");
    const options = layout ?? normalizeLayoutOptions(layoutOptions);
    style.textContent = `@page { size: ${options.paperWidth}mm ${options.paperHeight}mm; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [layout, layoutOptions]);

  useEffect(() => {
    if (orders.length && layout) {
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [orders, layout]);

  if (error) {
    return (
      <main className="imposition-print-shell">
        <p className="message">{error}</p>
      </main>
    );
  }

  return (
    <main className="imposition-print-shell">
      <div className="print-toolbar imposition-toolbar">
        <div>
          <strong>智能拼版打印</strong>
          <span>{layout ? `${orders.length} 个订单 / 每页 ${layout.capacity} 个 / ${layout.columns}列 × ${layout.rows}行` : "Loading..."}</span>
        </div>
        <button className="primary-btn compact" onClick={() => window.print()} type="button">
          <Printer size={18} />
          打印
        </button>
      </div>
      {layout && chunkOrders(orders, layout.capacity).map((pageOrders, pageIndex) => (
        <section
          className="imposition-page"
          key={pageIndex}
          style={{
            height: `${layout.paperHeight}mm`,
            width: `${layout.paperWidth}mm`
          }}
        >
          {pageOrders.map((order, orderIndex) => {
            const position = layout.positions[orderIndex];
            return (
              <figure
                className={`imposition-tag ${layout.autoRotated ? "rotated" : ""} ${layout.cropMarks ? "" : "no-crop"}`}
                key={order.id}
                style={{
                  left: `${position.x}mm`,
                  top: `${position.y}mm`,
                  width: `${layout.productWidth}mm`
                }}
              >
                <div
                  className="imposition-frame"
                  style={{
                    height: `${layout.productHeight}mm`,
                    width: `${layout.productWidth}mm`
                  }}
                >
                  <TicketPrint order={order} />
                </div>
                {layout.showOrderNo && <figcaption>{order.order_no}</figcaption>}
              </figure>
            );
          })}
        </section>
      ))}
    </main>
  );
}

function CustomerPage({ settings, previewNumber, onCreated, autoPrint = false, autoReturn = false }) {
  const [templateId, setTemplateId] = useState("template_01");
  const [customerText, setCustomerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("neutral");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isComposingName, setIsComposingName] = useState(false);
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const actionPanelRef = useRef(null);
  const template = templates.find((item) => item.id === templateId);
  const timestamp = useMemo(() => new Date(), [customerText, templateId, previewNumber]);
  const normalizedName = normalizeCustomerName(customerText);
  const finalName = finalizeCustomerName(customerText);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return undefined;
    }
    const initialHeight = viewport.height;
    function updateKeyboardState() {
      const keyboardHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      const isInputActive = document.activeElement === inputRef.current;
      const actionPanelBottom = actionPanelRef.current?.getBoundingClientRect().bottom ?? 0;
      const visualBottom = viewport.offsetTop + viewport.height - 18;
      const overflow = isInputActive ? Math.max(0, actionPanelBottom - visualBottom) : 0;
      const keyboardShift = isInputActive && keyboardHeight > 80
        ? Math.round(Math.min(window.innerHeight * 0.48, overflow + keyboardHeight * 0.32 + 24))
        : 0;
      document.documentElement.style.setProperty("--keyboard-height", `${Math.round(keyboardHeight)}px`);
      document.documentElement.style.setProperty("--keyboard-shift", `${keyboardShift}px`);
      setKeyboardOpen(isInputActive && keyboardHeight > 80);
    }
    viewport.addEventListener("resize", updateKeyboardState);
    viewport.addEventListener("scroll", updateKeyboardState);
    document.documentElement.style.setProperty("--initial-viewport-height", `${Math.round(initialHeight)}px`);
    updateKeyboardState();
    return () => {
      viewport.removeEventListener("resize", updateKeyboardState);
      viewport.removeEventListener("scroll", updateKeyboardState);
      document.documentElement.style.removeProperty("--keyboard-height");
      document.documentElement.style.removeProperty("--keyboard-shift");
      document.documentElement.style.removeProperty("--initial-viewport-height");
    };
  }, []);

  function focusNameInput() {
    setKeyboardOpen(true);
    window.setTimeout(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    }, 80);
  }

  function blurNameInput() {
    window.setTimeout(() => {
      if (document.activeElement !== inputRef.current) {
        setKeyboardOpen(false);
      }
    }, 120);
  }

  async function printOrder() {
    if (!isValidCustomerName(finalName)) {
      setMessage("请输入 1-12 位英文大写字母，可包含空格");
      setMessageType("error");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const pngDataUrl = canvasRef.current.toDataURL("image/png");

      // 1. 创建订单（不打印，只取号和存记录）
      const response = await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({ templateId, customerText: finalName, pngDataUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "订单创建失败");
      }

      // 2. 打印（按环境选择路径）
      const isCapacitorNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() !== 'electron';
      if (isCapacitorNative) {
        // App 内 → 原生 USB ESC/POS
        try {
          await EscPos.print({
            customerText: finalName,
            orderNo: data.orderNo,
            timestamp: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
          });
        } catch (usbError) {
          // USB 失败 → 回退到当前窗口打印页（避免 window.open 被弹窗拦截）
          window.location.href = `/ticket/${data.id}?autoPrint=1`;
          return;
        }
      } else if (autoPrint) {
        // Kiosk 模式 → 使用已创建的订单 ID 进行打印（不再重复创建订单）
        const printResponse = await apiFetch(`/api/orders/${data.id}/print`, {
          method: "POST"
        });
        if (!printResponse.ok) {
          const printData = await printResponse.json();
          throw new Error(printData.message || "打印失败");
        }
      } else {
        // 普通浏览器 → 浏览器打印窗
        window.open(`/ticket/${data.id}?autoPrint=1`, '_blank');
      }

      setMessage(`✓ 打印成功\n编号：${data.orderNo}`);
      setMessageType("success");
      onCreated();
      window.setTimeout(() => {
        setCustomerText("");
        setTemplateId("template_01");
        setMessage("");
        inputRef.current?.focus();
      }, 2000);
    } catch (error) {
      setMessage(error.message);
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`creator-kiosk ${keyboardOpen ? "keyboard-open" : ""}`}>
      <section className="creator-preview-stage">
        <CanvasPreview
          canvasRef={canvasRef}
          customerText={normalizedName}
          orderNo={previewNumber}
          template={template}
          timestamp={timestamp}
          watermarkEnabled={settings.watermarkEnabled}
          showMeta={false}
        />
      </section>

      <form
        className="creator-action-panel"
        ref={actionPanelRef}
        onSubmit={(event) => {
          event.preventDefault();
          printOrder();
        }}
      >
        <fieldset className="creator-color-choice">
          <legend>选择颜色</legend>
          <div>
            {templates.map((item) => (
              <button
                aria-pressed={templateId === item.id}
                className={templateId === item.id ? "active" : ""}
                key={item.id}
                onClick={() => setTemplateId(item.id)}
                type="button"
              >
                <span style={{ backgroundColor: item.color }} />
                {item.displayName}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="creator-name-field">
          <span>请输入姓名</span>
          <input
            autoComplete="off"
            autoFocus
            autoCapitalize="characters"
            enterKeyHint="done"
            inputMode="text"
            lang="en"
            maxLength={12}
            pattern="[A-Za-z ]*"
            ref={inputRef}
            spellCheck="false"
            value={customerText}
            onBlur={blurNameInput}
            onCompositionEnd={(event) => {
              setIsComposingName(false);
              setCustomerText(normalizeCustomerName(event.currentTarget.value));
            }}
            onCompositionStart={() => setIsComposingName(true)}
            onFocus={focusNameInput}
            onChange={(event) => setCustomerText(event.nativeEvent.isComposing || isComposingName ? event.target.value : normalizeCustomerName(event.target.value))}
            placeholder="MARISSA"
          />
        </label>
        <button className="creator-submit-btn" disabled={busy} type="submit">
          <Printer size={42} />
          {busy ? "打印中" : "打印"}
        </button>
        {message && <p className={`message ${messageType}`}>{message.split("\n").map((line) => <span key={line}>{line}</span>)}</p>}
      </form>
    </main>
  );
}

function AccessGate({ access, onAuthenticated }) {
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const isMaintenance = access?.deploymentMode === "maintenance";

  async function login(event) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm)
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.message || "登录失败");
        return;
      }
      onAuthenticated(data);
    } catch (error) {
      setMessage("网络异常，请检查网络连接后重试");
    }
  }

  async function enterInvite(event) {
    event.preventDefault();
    setMessage("");
    try {
      const response = await apiFetch("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({ inviteCode })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.message || "邀请码无效");
        return;
      }
      onAuthenticated(data);
    } catch (error) {
      setMessage("网络异常，请检查网络连接后重试");
    }
  }

  return (
    <main className="access-page">
      <section className="panel access-panel">
        <div className="section-title">
          <LogIn size={20} />
          <span>{isMaintenance ? "系统维护中" : "工作人员登录"}</span>
        </div>
        <p className="access-copy">
          当前模式：{deploymentModes.find((mode) => mode.value === access?.deploymentMode)?.label ?? "Private"}。
          未登录用户无法访问业务页面。
        </p>
        <form className="access-form" onSubmit={login}>
          <label className="field">
            <span>账号</span>
            <input
              autoComplete="username"
              value={loginForm.username}
              onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
            />
          </label>
          <label className="field">
            <span>密码</span>
            <input
              autoComplete="current-password"
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            />
          </label>
          <button className="primary-btn" type="submit">
            <LogIn size={18} />
            登录后台
          </button>
        </form>
        {access?.deploymentMode === "invite" && (
          <form className="access-form invite-form" onSubmit={enterInvite}>
            <label className="field">
              <span>客户邀请码</span>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
            </label>
            <button className="secondary-btn" type="submit">进入定制页</button>
          </form>
        )}
        {message && <p className="message">{message}</p>}
      </section>
    </main>
  );
}

function StaffOnlyPage({ children }) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccess() {
      try {
        const response = await apiFetch("/api/auth/status");
        setAccess(await response.json());
      } catch {
        setAccess(null);
      } finally {
        setLoading(false);
      }
    }
    loadAccess();
  }, []);

  if (loading) {
    return <main className="access-page"><p className="message neutral">Loading...</p></main>;
  }

  if (!access?.authenticated) {
    return <AccessGate access={access} onAuthenticated={setAccess} />;
  }

  return children;
}

function AdminPage({ settings, onSettingsSaved, access, onGoCustomer, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(settings);
  const [eventForm, setEventForm] = useState(createEventFormFromSettings(settings));
  const [printerState, setPrinterState] = useState({ printers: [], defaultPrinter: "", selectedPrinter: "" });
  const [printerMessage, setPrinterMessage] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [layoutOptions, setLayoutOptions] = useState(defaultLayoutOptions);
  const [layoutPreview, setLayoutPreview] = useState(null);
  const [showDeletedOrders, setShowDeletedOrders] = useState(false);
  const [showAdvancedLayout, setShowAdvancedLayout] = useState(false);
  const [openOrderMenuId, setOpenOrderMenuId] = useState(null);
  const initialAdminTab = window.location.pathname === "/admin/dashboard" || window.location.pathname === "/admin"
    ? "dashboard"
    : window.location.pathname === "/admin/users"
    ? "users"
    : window.location.pathname === "/admin/settings"
      ? "settings"
      : window.location.pathname === "/admin/print-layout"
        ? "layout"
        : window.location.pathname === "/admin/logs"
          ? "logs"
          : window.location.pathname === "/admin/orders"
            ? "orders"
            : "orders";
  const [adminTab, setAdminTab] = useState(initialAdminTab);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [userForm, setUserForm] = useState({ username: "", password: "", role: "client", status: "active" });
  const [editingUserId, setEditingUserId] = useState(null);
  const [userMessage, setUserMessage] = useState("");
  const [userDrawerOpen, setUserDrawerOpen] = useState(false);
  const [openUserMenu, setOpenUserMenu] = useState(false);
  const [openUserActionMenuId, setOpenUserActionMenuId] = useState(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderTemplateFilter, setOrderTemplateFilter] = useState("all");
  const isSuperAdmin = access?.role === "super_admin";
  const canUseAdminTools = ["super_admin", "admin"].includes(access?.role);
  const orderStats = {
    total: orders.filter((order) => !order.deleted_at).length,
    printed: orders.filter((order) => !order.deleted_at && order.print_status === "printed").length,
    pending: orders.filter((order) => !order.deleted_at && order.print_status !== "printed").length,
    deleted: orders.filter((order) => order.deleted_at).length
  };
  const todayOrderCount = orders.filter((order) => (
    !order.deleted_at && new Date(order.generated_at).toDateString() === new Date().toDateString()
  )).length;
  const filteredOrders = orders.filter((order) => {
    const keyword = orderSearch.trim().toUpperCase();
    const matchesKeyword = !keyword ||
      String(order.order_no).toUpperCase().includes(keyword) ||
      String(order.customer_text).toUpperCase().includes(keyword);
    const matchesStatus = orderStatusFilter === "all" || order.print_status === orderStatusFilter;
    const matchesTemplate = orderTemplateFilter === "all" || order.template_id === orderTemplateFilter;
    return matchesKeyword && matchesStatus && matchesTemplate;
  });
  const adminNavItems = [
    { tab: "dashboard", label: "控制台", icon: Home, visible: true },
    { tab: "orders", label: "订单管理", icon: ClipboardList, visible: true },
    { tab: "layout", label: "拼版打印", icon: Printer, visible: true },
    { tab: "users", label: "账号权限", icon: Users, visible: isSuperAdmin },
    { tab: "settings", label: "系统设置", icon: Settings, visible: isSuperAdmin },
    { tab: "logs", label: "操作日志", icon: FileClock, visible: isSuperAdmin }
  ].filter((item) => item.visible);

  useEffect(() => {
    setForm(settings);
    setEventForm(createEventFormFromSettings(settings));
  }, [settings]);

  async function loadOrders() {
    try {
      const response = await apiFetch(`/api/orders${showDeletedOrders ? "?deleted=true" : ""}`);
      const data = await response.json();
      if (!response.ok) {
        setPrinterMessage(data.message || "订单加载失败");
        return;
      }
      const nextOrders = Array.isArray(data) ? data : (data.orders ?? []);
      setOrders(nextOrders);
      setSelectedOrderIds((ids) => ids.filter((id) => nextOrders.some((order) => order.id === id)));
    } catch (error) {
      setPrinterMessage("订单加载失败，请检查网络连接");
    }
  }

  async function loadPrinters() {
    try {
      const response = await apiFetch("/api/printers");
      const data = await response.json();
      setPrinterState({
        printers: data.printers ?? [],
        defaultPrinter: data.defaultPrinter ?? "",
        selectedPrinter: data.selectedPrinter ?? ""
      });
    } catch (error) {
      setPrinterState({ printers: [], defaultPrinter: "", selectedPrinter: "" });
    }
  }

  async function loadUsers() {
    if (!isSuperAdmin) {
      return;
    }
    const response = await apiFetch("/api/users");
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "账号列表加载失败");
      return;
    }
    setUsers(data);
  }

  async function loadLogs() {
    if (!isSuperAdmin) {
      return;
    }
    const response = await apiFetch("/api/audit-logs");
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "操作日志加载失败");
      return;
    }
    setLogs(data);
  }

  useEffect(() => {
    loadOrders();
    if (canUseAdminTools) {
      loadPrinters();
    }
  }, []);

  useEffect(() => {
    // Skip initial mount — already loaded by the first useEffect
    if (!orders.length && !showDeletedOrders) return;
    loadOrders();
  }, [showDeletedOrders]);

  useEffect(() => {
    if (!canUseAdminTools) {
      return;
    }
    async function loadLayoutPreview() {
      try {
        const response = await apiFetch("/api/layout/preview", {
          method: "POST",
          body: JSON.stringify({ layoutOptions: normalizeLayoutOptions(layoutOptions) })
        });
        const data = await response.json();
        setLayoutPreview(response.ok ? data : { error: data.message || "拼版参数无效" });
      } catch (error) {
        setLayoutPreview({ error: error.message });
      }
    }
    loadLayoutPreview();
  }, [layoutOptions, canUseAdminTools]);

  useEffect(() => {
    if (adminTab === "users") {
      loadUsers();
    }
    if (adminTab === "logs") {
      loadLogs();
    }
  }, [adminTab, isSuperAdmin]);

  useEffect(() => {
    if (!isSuperAdmin && ["settings", "users", "logs"].includes(adminTab)) {
      openAdminTab("orders");
    }
  }, [adminTab, isSuperAdmin]);

  useEffect(() => {
    function closeMenus(event) {
      if (event.type === "keydown" && event.key !== "Escape") {
        return;
      }
      if (event.type === "mousedown" && event.target.closest(".more-menu, .admin-user-menu")) {
        return;
      }
      setOpenOrderMenuId(null);
      setOpenUserActionMenuId(null);
      setOpenUserMenu(false);
    }
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeMenus);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeMenus);
    };
  }, []);

  async function saveSettings() {
    if (!isSuperAdmin) {
      setPrinterMessage("只有 Super Admin 可以修改系统设置");
      return;
    }
    if (
      Number(form.currentNumber) < Number(settings.currentNumber) &&
      !window.confirm(`当前编号将从 ${settings.currentNumber} 调低到 ${form.currentNumber}，可能造成编号重复。确认继续？`)
    ) {
      return;
    }
    try {
      const response = await apiFetch("/api/settings", {
        method: "PUT",
        body: JSON.stringify(form)
      });
      onSettingsSaved(await response.json());
    } catch (error) {
      setPrinterMessage("设置保存失败，请检查网络连接");
    }
  }

  async function resetEvent() {
    if (!isSuperAdmin) {
      setPrinterMessage("只有 Super Admin 可以重置活动编号");
      return;
    }
    if (!window.confirm("确认开启新活动并重置编号？历史订单编号不会改变。")) {
      return;
    }
    try {
      const response = await apiFetch("/api/events/reset", {
        method: "POST",
        body: JSON.stringify(eventForm)
      });
      const data = await response.json();
      if (!response.ok) {
        setPrinterMessage(data.message || "新活动重置失败");
        return;
      }
      onSettingsSaved(data.settings);
      setPrinterMessage("新活动已启用，后续订单将使用新编号");
      loadOrders();
    } catch (error) {
      setPrinterMessage("新活动重置失败，请检查网络连接");
    }
  }

  async function togglePrinted(order) {
    try {
      await apiFetch(`/api/orders/${order.id}/print-status`, {
        method: "PATCH",
        body: JSON.stringify({
          printStatus: order.print_status === "printed" ? "pending" : "printed"
        })
      });
      loadOrders();
    } catch (error) {
      setPrinterMessage("打印状态更新失败");
    }
  }

  async function deleteOrder(order) {
    if (!window.confirm(`确认将订单 ${order.order_no} 移入回收站？文件会保留，删除不会影响当前编号。`)) {
      return;
    }
    const response = await apiFetch(`/api/orders/${order.id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setPrinterMessage(data.message || "订单删除失败");
      return;
    }
    setSelectedOrderIds((ids) => ids.filter((id) => id !== order.id));
    loadOrders();
  }

  async function restoreOrder(order) {
    const response = await apiFetch(`/api/orders/${order.id}/restore`, { method: "PATCH" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setPrinterMessage(data.message || "订单恢复失败");
      return;
    }
    setPrinterMessage(`订单 ${order.order_no} 已恢复`);
    loadOrders();
  }

  async function printOrderDirect(order) {
    setPrinterMessage("");
    const response = await apiFetch(`/api/orders/${order.id}/print`, { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setPrinterMessage(data.message || "打印失败，请检查打印机");
      return;
    }
    setPrinterMessage(data.message || `订单 ${order.order_no} 已发送到打印机`);
  }

  function toggleOrderSelection(orderId) {
    setSelectedOrderIds((ids) => (
      ids.includes(orderId) ? ids.filter((id) => id !== orderId) : [...ids, orderId]
    ));
  }

  function toggleAllPendingOrders() {
    const pendingIds = orders.filter((order) => order.print_status !== "printed").map((order) => order.id);
    const allSelected = pendingIds.length > 0 && pendingIds.every((id) => selectedOrderIds.includes(id));
    setSelectedOrderIds(allSelected ? [] : pendingIds);
  }

  function updateLayoutOption(key, value) {
    setLayoutOptions((options) => {
      const nextOptions = { ...options, [key]: value };
      if (key === "paperPreset" && value !== "CUSTOM") {
        nextOptions.paperWidth = paperPresets[value].width;
        nextOptions.paperHeight = paperPresets[value].height;
      }
      return nextOptions;
    });
  }

  function applyLayoutPreset(preset) {
    setLayoutOptions((options) => ({
      ...options,
      ...preset.options,
      autoRotate: true,
      cropMarks: true,
      showOrderNo: true
    }));
    setShowAdvancedLayout(false);
  }

  async function downloadImpositionPdf() {
    if (!selectedOrderIds.length) {
      setPrinterMessage("请先选择订单");
      return;
    }
    const response = await apiFetch("/api/orders/imposition", {
      method: "POST",
      body: JSON.stringify({
        orderIds: selectedOrderIds,
        layoutOptions: normalizeLayoutOptions(layoutOptions)
      })
    });
    if (!response.ok) {
      const data = await response.json();
      setPrinterMessage(data.message || "拼版 PDF 生成失败");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `imposition-layout-${Date.now()}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setPrinterMessage("拼版 PDF 已生成");
  }

  function openImpositionPrintPage() {
    if (!selectedOrderIds.length) {
      setPrinterMessage("请先选择订单");
      return;
    }
    const params = new URLSearchParams({
      ids: selectedOrderIds.join(","),
      layout: JSON.stringify(normalizeLayoutOptions(layoutOptions))
    });
    window.open(`/print-layout?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  async function saveSelectedPrinter(selectedPrinter) {
    setPrinterState({ ...printerState, selectedPrinter });
    await apiFetch("/api/printers/selected", {
      method: "PUT",
      body: JSON.stringify({ selectedPrinter })
    });
    setPrinterMessage("打印机选择已保存");
  }

  async function testPrinter() {
    const response = await apiFetch("/api/printers/test", { method: "POST" });
    const data = await response.json();
    setPrinterMessage(data.message || (response.ok ? "测试打印已发送" : "测试打印暂不可用"));
  }

  function openAdminTab(tab) {
    setAdminTab(tab);
    const pathMap = {
      dashboard: "/admin/dashboard",
      orders: "/admin/orders",
      settings: "/admin/settings",
      users: "/admin/users",
      layout: "/admin/print-layout",
      logs: "/admin/logs"
    };
    window.history.replaceState(null, "", pathMap[tab] ?? "/admin/dashboard");
  }

  function editUser(user) {
    setEditingUserId(user.id);
    setUserForm({ username: user.username, password: "", role: user.role, status: user.status });
    setUserMessage("");
    setUserDrawerOpen(true);
    setOpenUserActionMenuId(null);
  }

  function resetUserForm() {
    setEditingUserId(null);
    setUserForm({ username: "", password: "", role: "client", status: "active" });
    setUserMessage("");
  }

  function openCreateUserDrawer() {
    resetUserForm();
    setUserDrawerOpen(true);
  }

  async function saveUser() {
    setUserMessage("");
    const response = await apiFetch(editingUserId ? `/api/users/${editingUserId}` : "/api/users", {
      method: editingUserId ? "PATCH" : "POST",
      body: JSON.stringify(userForm)
    });
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "账号保存失败");
      return;
    }
    setUserMessage(editingUserId ? "账号已更新" : "账号已创建");
    resetUserForm();
    setUserDrawerOpen(false);
    loadUsers();
  }

  async function disableUser(user) {
    const nextStatus = user.status === "active" ? "disabled" : "active";
    const response = await apiFetch(`/api/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify({ username: user.username, role: user.role, status: nextStatus })
    });
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "状态修改失败");
      return;
    }
    setUserMessage(`账号已${nextStatus === "active" ? "启用" : "禁用"}`);
    loadUsers();
  }

  async function resetPassword(user) {
    const password = window.prompt(`请输入 ${user.username} 的新密码（至少 6 位）`);
    if (!password) {
      return;
    }
    const response = await apiFetch(`/api/users/${user.id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password })
    });
    const data = await response.json();
    if (!response.ok) {
      setUserMessage(data.message || "密码重置失败");
      return;
    }
    setUserMessage("密码已重置，该账号需重新登录");
  }

  async function deleteUser(user) {
    if (!window.confirm(`确认删除账号 ${user.username}？该操作不会删除历史订单。`)) {
      return;
    }
    const response = await apiFetch(`/api/users/${user.id}`, { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setUserMessage(data.message || "账号删除失败");
      return;
    }
    setUserMessage("账号已删除");
    loadUsers();
  }

  return (
    <main className="admin-console">
      <header className="admin-header">
        <div className="admin-brand">
          <BrandLogo className="admin-logo" />
        </div>
        <nav className="admin-top-nav">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={adminTab === item.tab ? "active" : ""}
                key={item.tab}
                onClick={() => openAdminTab(item.tab)}
                type="button"
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <label className="admin-search">
          <Search size={16} />
          <input
            placeholder="搜索订单编号 / 姓名..."
            value={orderSearch}
            onChange={(event) => {
              setOrderSearch(event.target.value);
              if (adminTab !== "orders") {
                openAdminTab("orders");
              }
            }}
          />
        </label>
        <div className="admin-header-actions">
          <div className="admin-user-menu">
            <button className="admin-user-chip" onClick={() => setOpenUserMenu((value) => !value)} type="button">
              <span>{String(access?.user?.username ?? "A").slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{access?.user?.username}</strong>
                <small>{roleLabels[access?.role] ?? "Staff"}</small>
              </div>
              <ChevronDown size={15} />
            </button>
            {openUserMenu && (
              <div className="admin-user-popover">
                <button onClick={onLogout} type="button">退出登录</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <BrandLogo className="admin-logo" />
        </div>
        <nav className="admin-sidebar-nav">
          {adminNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={adminTab === item.tab ? "active" : ""}
                key={item.tab}
                onClick={() => openAdminTab(item.tab)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-footer">
          <button onClick={onGoCustomer} type="button">
            <Home size={18} />
            <span>返回定制页</span>
          </button>
          <button onClick={onLogout} type="button">
            <LogOut size={18} />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      <section className="admin-main">
        <div className="admin-page-card">
      {adminTab === "dashboard" && <section className="dashboard-panel">
        <div className="dashboard-hero">
          <div>
            <span>Overview</span>
            <h2>控制台</h2>
            <p>查看今日订单、打印状态和系统运行概览。</p>
          </div>
          <button className="secondary-btn inline" onClick={() => openAdminTab("orders")} type="button">
            查看订单
          </button>
        </div>
        <div className="metric-grid">
          <article className="metric-card">
            <span>今日订单</span>
            <strong>{todayOrderCount}</strong>
            <small>当天生成订单数量</small>
          </article>
          <article className="metric-card">
            <span>总订单</span>
            <strong>{orderStats.total}</strong>
            <small>不含回收站订单</small>
          </article>
          <article className="metric-card">
            <span>待打印</span>
            <strong>{orderStats.pending}</strong>
            <small>需要处理的订单</small>
          </article>
          <article className="metric-card">
            <span>已打印</span>
            <strong>{orderStats.printed}</strong>
            <small>已完成打印订单</small>
          </article>
        </div>
      </section>}

      {adminTab === "settings" && isSuperAdmin && <section className="panel settings-panel">
        <div className="section-title">
          <Settings size={20} />
          <span>编号设置</span>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>编号前缀</span>
            <input value={form.prefix ?? ""} onChange={(event) => setForm({ ...form, prefix: event.target.value })} />
          </label>
          <label className="field">
            <span>当前编号</span>
            <input
              min="1"
              type="number"
              value={form.currentNumber ?? 1}
              onChange={(event) => setForm({ ...form, currentNumber: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>编号位数</span>
            <input
              min="1"
              max="8"
              type="number"
              value={form.digits ?? 4}
              onChange={(event) => setForm({ ...form, digits: Number(event.target.value) })}
            />
          </label>
          <label className="toggle">
            <input
              checked={Boolean(form.watermarkEnabled)}
              onChange={(event) => setForm({ ...form, watermarkEnabled: event.target.checked })}
              type="checkbox"
            />
            <span>开启时间水印</span>
          </label>
          <label className="toggle">
            <input
              checked={Boolean(form.creatorAutoPrint)}
              onChange={(event) => setForm({ ...form, creatorAutoPrint: event.target.checked })}
              type="checkbox"
            />
            <span>/creator 自动打印</span>
          </label>
          <label className="toggle">
            <input
              checked={Boolean(form.creatorAutoReturn)}
              onChange={(event) => setForm({ ...form, creatorAutoReturn: event.target.checked })}
              type="checkbox"
            />
            <span>/creator 自动返回</span>
          </label>
          <label className="field">
            <span>系统版本</span>
            <input readOnly value={APP_VERSION} />
          </label>
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button">
          <CheckCircle2 size={18} />
          保存设置
        </button>
      </section>}

      {adminTab === "settings" && isSuperAdmin && <section className="panel event-reset-panel">
        <div className="section-title">
          <RefreshCw size={20} />
          <span>新活动重置编号</span>
        </div>
        <div className="settings-grid">
          <label className="field">
            <span>活动名称</span>
            <input
              value={eventForm.name}
              onChange={(event) => setEventForm({ ...eventForm, name: event.target.value })}
              placeholder="例如：上海快闪店"
            />
          </label>
          <label className="field">
            <span>编号前缀</span>
            <input value={eventForm.prefix} onChange={(event) => setEventForm({ ...eventForm, prefix: event.target.value })} />
          </label>
          <label className="field">
            <span>活动日期</span>
            <input type="date" value={eventForm.eventDate} onChange={(event) => setEventForm({ ...eventForm, eventDate: event.target.value })} />
          </label>
          <label className="field">
            <span>起始编号</span>
            <input
              min="1"
              type="number"
              value={eventForm.startNumber}
              onChange={(event) => setEventForm({ ...eventForm, startNumber: Number(event.target.value) })}
            />
          </label>
          <label className="field">
            <span>编号位数</span>
            <input
              min="1"
              max="8"
              type="number"
              value={eventForm.digits}
              onChange={(event) => setEventForm({ ...eventForm, digits: Number(event.target.value) })}
            />
          </label>
          <div className="mode-help">
            重置只影响后续新订单；历史订单编号、打印和删除均保持独立。
          </div>
        </div>
        <button className="secondary-btn" onClick={resetEvent} type="button">
          <RefreshCw size={18} />
          重置为新活动
        </button>
      </section>}

      {adminTab === "settings" && isSuperAdmin && <section className="panel access-settings-panel">
        <div className="section-title">
          <LogIn size={20} />
          <span>访问模式</span>
        </div>
        <div className="settings-grid access-settings-grid">
          <label className="field">
            <span>部署模式</span>
            <select
              value={form.deploymentMode ?? "private"}
              onChange={(event) => setForm({ ...form, deploymentMode: event.target.value })}
            >
              {deploymentModes.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>邀请码</span>
            <input
              disabled={(form.deploymentMode ?? "private") !== "invite"}
              value={form.inviteCode ?? ""}
              onChange={(event) => setForm({ ...form, inviteCode: event.target.value })}
              placeholder="Invite 模式下填写"
            />
          </label>
          <div className="mode-help">
            {deploymentModes.find((mode) => mode.value === (form.deploymentMode ?? "private"))?.description}
          </div>
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button">
          <CheckCircle2 size={18} />
          保存访问模式
        </button>
      </section>}

      {(adminTab === "settings" || adminTab === "layout") && <section className="panel printer-panel">
        <div className="section-title">
          <Printer size={20} />
          <span>打印设置</span>
        </div>
        <div className="printer-grid">
          <label className="field">
            <span>本机默认打印机</span>
            <input readOnly value={printerState.defaultPrinter || "未读取到默认打印机"} />
          </label>
          <label className="field">
            <span>后台配置打印机名称</span>
            <select
              value={printerState.selectedPrinter}
              disabled={!isSuperAdmin}
              onChange={(event) => saveSelectedPrinter(event.target.value)}
            >
              <option value="">使用本机默认打印机</option>
              {printerState.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.name}{printer.isDefault ? "（默认）" : ""}{printer.isVirtual ? "（虚拟/不出纸）" : ""}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-btn inline" onClick={loadPrinters} type="button">
            <RefreshCw size={18} />
            刷新
          </button>
          <button className="secondary-btn inline" onClick={testPrinter} type="button">
            <Printer size={18} />
            测试打印
          </button>
        </div>
        {printerMessage && <p className="message neutral">{printerMessage}</p>}
      </section>}

      {adminTab === "layout" && <section className="panel layout-panel">
        <div className="section-title split">
          <span>智能拼版设置</span>
          <strong className="layout-summary">
            {layoutPreview?.error
              ? layoutPreview.error
              : layoutPreview
                ? `${layoutPreview.paperWidth}×${layoutPreview.paperHeight}mm / ${layoutPreview.columns}列×${layoutPreview.rows}行 / 每页${layoutPreview.capacity}个${layoutPreview.autoRotated ? " / 已旋转优化" : ""}`
                : "计算中"}
          </strong>
        </div>
        <div className="layout-presets">
          {layoutPresets.map((preset) => (
            <button className="secondary-btn inline" key={preset.name} onClick={() => applyLayoutPreset(preset)} type="button">
              {preset.name}
            </button>
          ))}
          <button className="secondary-btn inline" onClick={() => setShowAdvancedLayout((value) => !value)} type="button">
            {showAdvancedLayout ? "收起高级项" : "高级参数"}
          </button>
        </div>
        <div className={`layout-grid ${showAdvancedLayout ? "" : "compact"}`}>
          <label className="field">
            <span>纸张</span>
            <select value={layoutOptions.paperPreset} onChange={(event) => updateLayoutOption("paperPreset", event.target.value)}>
              <option value="A4">A4 210×297mm</option>
              <option value="A3">A3 297×420mm</option>
              <option value="A5">A5 148×210mm</option>
              <option value="CUSTOM">自定义尺寸</option>
            </select>
          </label>
          <label className="field">
            <span>纸张宽 mm</span>
            <input
              disabled={layoutOptions.paperPreset !== "CUSTOM"}
              min="20"
              type="number"
              value={layoutOptions.paperWidth}
              onChange={(event) => updateLayoutOption("paperWidth", event.target.value)}
            />
          </label>
          <label className="field">
            <span>纸张高 mm</span>
            <input
              disabled={layoutOptions.paperPreset !== "CUSTOM"}
              min="20"
              type="number"
              value={layoutOptions.paperHeight}
              onChange={(event) => updateLayoutOption("paperHeight", event.target.value)}
            />
          </label>
          {showAdvancedLayout && <label className="field">
            <span>成品宽 mm</span>
            <input min="5" type="number" value={layoutOptions.productWidth} onChange={(event) => updateLayoutOption("productWidth", event.target.value)} />
          </label>}
          {showAdvancedLayout && <label className="field">
            <span>成品高 mm</span>
            <input min="5" type="number" value={layoutOptions.productHeight} onChange={(event) => updateLayoutOption("productHeight", event.target.value)} />
          </label>}
          {showAdvancedLayout && <label className="field">
            <span>最小边距 mm</span>
            <input min="0" type="number" value={layoutOptions.margin} onChange={(event) => updateLayoutOption("margin", event.target.value)} />
          </label>}
          {showAdvancedLayout && <label className="field">
            <span>间距 mm</span>
            <input min="0" type="number" value={layoutOptions.gap} onChange={(event) => updateLayoutOption("gap", event.target.value)} />
          </label>}
          {showAdvancedLayout && <label className="toggle">
            <input checked={layoutOptions.autoRotate} onChange={(event) => updateLayoutOption("autoRotate", event.target.checked)} type="checkbox" />
            <span>自动旋转优化</span>
          </label>}
          {showAdvancedLayout && <label className="toggle">
            <input checked={layoutOptions.cropMarks} onChange={(event) => updateLayoutOption("cropMarks", event.target.checked)} type="checkbox" />
            <span>生成裁切线</span>
          </label>}
          {showAdvancedLayout && <label className="toggle">
            <input checked={layoutOptions.showOrderNo} onChange={(event) => updateLayoutOption("showOrderNo", event.target.checked)} type="checkbox" />
            <span>下方显示编号</span>
          </label>}
        </div>
      </section>}

      {adminTab === "users" && isSuperAdmin && <section className="panel users-panel">
        <div className="section-title split">
          <span>账号权限</span>
          <button className="secondary-btn inline" onClick={openCreateUserDrawer} type="button">+ 新建账号</button>
        </div>
        {userMessage && <p className="message neutral">{userMessage}</p>}
        <div className="table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>账号</th>
                <th>角色</th>
                <th>状态</th>
                <th>最后登录</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.id}</td>
                  <td>{user.username}</td>
                  <td><span className={`role-tag ${user.role}`}>{roleLabels[user.role] ?? user.role}</span></td>
                  <td><span className={`status ${user.status}`}>{statusLabels[user.status] ?? user.status}</span></td>
                  <td>{user.last_login_at ? formatDateTime(user.last_login_at) : "-"}</td>
                  <td>{formatDateTime(user.created_at)}</td>
                  <td className="actions">
                    <div className="more-menu">
                      <button className="icon-btn" onClick={() => setOpenUserActionMenuId(openUserActionMenuId === user.id ? null : user.id)} title="更多操作" type="button">
                        <MoreHorizontal size={17} />
                      </button>
                      {openUserActionMenuId === user.id && (
                        <div className="more-menu-popover">
                          <button onClick={() => editUser(user)} type="button">编辑</button>
                          <button onClick={() => resetPassword(user)} type="button">重置密码</button>
                          <button onClick={() => disableUser(user)} type="button">{user.status === "active" ? "禁用" : "启用"}</button>
                          <button onClick={() => deleteUser(user)} type="button">删除</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!users.length && <tr><td colSpan="7" className="empty">暂无账号</td></tr>}
            </tbody>
          </table>
        </div>
        {userDrawerOpen && (
          <div className="admin-drawer-backdrop" onClick={() => setUserDrawerOpen(false)}>
            <aside className="admin-drawer" onClick={(event) => event.stopPropagation()}>
              <div className="admin-drawer-header">
                <div>
                  <span>Account</span>
                  <h3>{editingUserId ? "编辑账号" : "新建账号"}</h3>
                </div>
                <button className="icon-btn" onClick={() => setUserDrawerOpen(false)} type="button">
                  <X size={18} />
                </button>
              </div>
              <div className="admin-drawer-body">
                <label className="field">
                  <span>用户名</span>
                  <input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} />
                </label>
                <label className="field">
                  <span>{editingUserId ? "密码由重置按钮修改" : "密码"}</span>
                  <input
                    disabled={Boolean(editingUserId)}
                    type="password"
                    value={userForm.password}
                    onChange={(event) => setUserForm({ ...userForm, password: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>角色</span>
                  <select
                    disabled={userForm.username === "gongbei"}
                    value={userForm.role}
                    onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}
                  >
                    {(userForm.username === "gongbei" || userForm.role === "super_admin") && <option value="super_admin">Super Admin</option>}
                    <option value="admin">Admin</option>
                    <option value="client">Client</option>
                  </select>
                </label>
                <label className="field">
                  <span>状态</span>
                  <select value={userForm.status} onChange={(event) => setUserForm({ ...userForm, status: event.target.value })}>
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </label>
              </div>
              <div className="admin-drawer-footer">
                <button className="secondary-btn inline" onClick={() => setUserDrawerOpen(false)} type="button">取消</button>
                <button className="primary-btn compact" onClick={saveUser} type="button">
                  <CheckCircle2 size={18} />
                  {editingUserId ? "保存账号" : "创建账号"}
                </button>
              </div>
            </aside>
          </div>
        )}
      </section>}

      {adminTab === "logs" && isSuperAdmin && <section className="panel logs-panel">
        <div className="section-title split">
          <span>操作日志</span>
          <button className="icon-btn" onClick={loadLogs} title="刷新" type="button"><RefreshCw size={18} /></button>
        </div>
        <div className="table-wrap">
          <table className="logs-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>账号</th>
                <th>角色</th>
                <th>动作</th>
                <th>对象</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{log.username || "-"}</td>
                  <td>{roleLabels[log.role] ?? log.role}</td>
                  <td>{log.action}</td>
                  <td>{log.target_type}{log.target_id ? ` #${log.target_id}` : ""}</td>
                  <td>{log.ip}</td>
                </tr>
              ))}
              {!logs.length && <tr><td colSpan="6" className="empty">暂无日志</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {adminTab === "orders" && <section className="panel orders-panel">
        <div className="section-title split">
          <span>{showDeletedOrders ? "订单回收站" : "订单列表"}</span>
          <div className="order-toolbar">
            {!showDeletedOrders && <strong>{selectedOrderIds.length} 已选</strong>}
            <button className="secondary-btn inline" onClick={() => setShowDeletedOrders((value) => !value)} type="button">
              <Trash2 size={18} />
              {showDeletedOrders ? "返回订单" : "回收站"}
            </button>
            {!showDeletedOrders && (
              <>
                <button className="secondary-btn inline" onClick={downloadImpositionPdf} type="button">
                  <Download size={18} />
                  生成拼版PDF
                </button>
                <button className="secondary-btn inline" onClick={openImpositionPrintPage} type="button">
                  <Printer size={18} />
                  拼版打印
                </button>
              </>
            )}
            <button className="icon-btn" onClick={loadOrders} title="刷新" type="button">
              <RefreshCw size={18} />
            </button>
          </div>
        </div>
        <div className="order-filter-bar">
          <label>
            <span>搜索</span>
            <input
              placeholder="姓名 / 编号"
              value={orderSearch}
              onChange={(event) => setOrderSearch(event.target.value)}
            />
          </label>
          <label>
            <span>模板</span>
            <select value={orderTemplateFilter} onChange={(event) => setOrderTemplateFilter(event.target.value)}>
              <option value="all">全部模板</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.displayName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>状态</span>
            <select value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value)}>
              <option value="all">全部状态</option>
              <option value="pending">待打印</option>
              <option value="printed">已打印</option>
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="orders-table">
            <thead>
              <tr>
                <th>
                  {!showDeletedOrders && (
                    <input
                      aria-label="选择所有待打印订单"
                      checked={
                        orders.some((order) => order.print_status !== "printed") &&
                        orders.filter((order) => order.print_status !== "printed").every((order) => selectedOrderIds.includes(order.id))
                      }
                      onChange={toggleAllPendingOrders}
                      type="checkbox"
                    />
                  )}
                </th>
                <th>编号</th>
                <th>活动</th>
                <th>客户文字</th>
                <th>模板</th>
                <th>生成时间</th>
                <th>打印状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    {!showDeletedOrders && (
                      <input
                        aria-label={`选择 ${order.order_no}`}
                        checked={selectedOrderIds.includes(order.id)}
                        onChange={() => toggleOrderSelection(order.id)}
                        type="checkbox"
                      />
                    )}
                  </td>
                  <td>{order.order_no}</td>
                  <td>{order.event_name ? `${order.event_name}${order.event_date ? ` / ${order.event_date}` : ""}` : "-"}</td>
                  <td>{order.customer_text}</td>
                  <td>{templates.find((item) => item.id === order.template_id)?.displayName ?? legacyTemplateNames[order.template_id] ?? order.template_id}</td>
                  <td>{formatDateTime(order.generated_at)}</td>
                  <td>
                    <span className={`status ${order.print_status}`}>{order.print_status === "printed" ? "已打印" : "待打印"}</span>
                  </td>
                  <td className="actions">
                    {showDeletedOrders ? (
                      <button onClick={() => restoreOrder(order)} title="恢复订单" type="button">
                        <RefreshCw size={17} />
                        恢复
                      </button>
                    ) : (
                      <>
                        <button onClick={() => printOrderDirect(order)} title="发送到默认或已配置打印机" type="button">
                          <Printer size={17} />
                          打印
                        </button>
                        <button onClick={() => togglePrinted(order)} title="重新打印不增加编号" type="button">
                          <CheckCircle2 size={17} />
                          {order.print_status === "printed" ? "标记待打" : "标记已打"}
                        </button>
                        <div className="more-menu">
                          <button onClick={() => setOpenOrderMenuId(openOrderMenuId === order.id ? null : order.id)} title="更多操作" type="button">
                            <MoreHorizontal size={17} />
                            更多
                          </button>
                          {openOrderMenuId === order.id && (
                            <div className="more-menu-popover">
                              <a href={`${API_BASE}/api/orders/${order.id}/download/png`} title="下载 PNG">
                                <Download size={17} /> 下载 PNG
                              </a>
                              <a href={`${API_BASE}/api/orders/${order.id}/download/pdf`} title="下载 PDF">
                                <Download size={17} /> 下载 PDF
                              </a>
                            </div>
                          )}
                        </div>
                        <button onClick={() => deleteOrder(order)} title="删除订单不影响编号" type="button">
                          <Trash2 size={17} />
                          删除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!filteredOrders.length && (
                <tr>
                  <td colSpan="8" className="empty">
                    暂无订单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>}
        </div>
      </section>
    </main>
  );
}

function App() {
  const pathname = window.location.pathname;
  const printMatch = pathname.match(/^\/print\/(\d+)$/);
  const ticketMatch = window.location.pathname.match(/^\/ticket\/(\d+)$/);
  const impositionPrintMatch = pathname === "/print-layout" || pathname === "/print-a4";
  const creatorMode = pathname === "/creator";
  const adminMode = pathname.startsWith("/admin");
  const creatorParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState(adminMode ? "admin" : "customer");
  const [access, setAccess] = useState(null);
  const [settings, setSettings] = useState({
    prefix: "No.",
    currentNumber: 1,
    digits: 4,
    watermarkEnabled: true,
    creatorAutoPrint: false,
    creatorAutoReturn: false,
    deploymentMode: "private"
  });
  const [previewNumber, setPreviewNumber] = useState("No.0001");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  async function loadState() {
    setLoadError("");
    const [settingsResponse, numberResponse] = await Promise.all([
      apiFetch("/api/settings"),
      apiFetch("/api/preview-number")
    ]);
    if (!settingsResponse.ok || !numberResponse.ok) {
      const data = await settingsResponse.json().catch(() => ({}));
      throw new Error(data.message || "当前模式下无法访问定制页");
    }
    setSettings(await settingsResponse.json());
    const numberData = await numberResponse.json();
    setPreviewNumber(numberData.orderNo);
  }

  async function loadAccessAndState() {
    setLoading(true);
    try {
      const response = await apiFetch("/api/auth/status");
      const nextAccess = await response.json();
      setAccess(nextAccess);
      if (nextAccess.customerAccess) {
        await loadState();
      } else if (nextAccess.authenticated) {
        const settingsResponse = await apiFetch("/api/settings");
        if (settingsResponse.ok) {
          setSettings(await settingsResponse.json());
        }
        setPage("admin");
      }
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAccessAndState();
  }, []);

  function handleSettingsSaved(nextSettings) {
    setSettings(nextSettings);
    loadAccessAndState();
  }

  async function logout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Ignore logout errors — proceed with local state reset
    }
    setPage("customer");
    setAccess(null);
    loadAccessAndState();
  }

  if (printMatch) {
    return (
      <StaffOnlyPage>
        <PrintPage orderId={printMatch[1]} />
      </StaffOnlyPage>
    );
  }

  if (ticketMatch) {
    return <CustomerTicketPrintPage autoReturn={parseBooleanParam(new URLSearchParams(window.location.search).get("autoReturn"))} orderId={ticketMatch[1]} />;
  }

  if (impositionPrintMatch) {
    const params = new URLSearchParams(window.location.search);
    const orderIds = params.get("ids")?.split(",").map(Number).filter(Boolean) ?? [];
    const layoutParam = params.get("layout");
    let layoutOptions = defaultLayoutOptions;
    if (layoutParam) {
      try {
        layoutOptions = { ...defaultLayoutOptions, ...JSON.parse(layoutParam) };
      } catch {
        layoutOptions = defaultLayoutOptions;
      }
    }
    return (
      <StaffOnlyPage>
        <ImpositionPrintPage orderIds={orderIds} layoutOptions={layoutOptions} />
      </StaffOnlyPage>
    );
  }

  if (loading) {
    return <main className="access-page"><p className="message neutral">Loading...</p></main>;
  }

  if (!access?.customerAccess && !access?.authenticated) {
    return <AccessGate access={access} onAuthenticated={(nextAccess) => {
      setAccess(nextAccess);
      loadAccessAndState();
    }} />;
  }

  const customerDisabled = !access?.customerAccess;
  const activePage = customerDisabled && page === "customer" ? "admin" : page;
  const showStaffNavigation = Boolean(access?.authenticated);
  const showLogout = Boolean(access?.sessionAuthenticated || access?.authenticated || access?.invited);
  const autoPrint = creatorParams.has("autoPrint")
    ? parseBooleanParam(creatorParams.get("autoPrint"))
    : Boolean(settings.creatorAutoPrint) || parseBooleanParam(import.meta.env.VITE_CREATOR_AUTO_PRINT);
  const autoReturn = creatorParams.has("autoReturn")
    ? parseBooleanParam(creatorParams.get("autoReturn"))
    : Boolean(settings.creatorAutoReturn) || parseBooleanParam(import.meta.env.VITE_CREATOR_AUTO_RETURN);

  if (creatorMode) {
    return (
      <div className="app-shell creator-shell">
        <header className="creator-topbar">
          <div className="creator-brand">
            <BrandLogo className="brand-mark" />
          </div>
          {showLogout && (
            <button className="creator-logout" onClick={logout} type="button">
              <LogOut size={24} />
              退出
            </button>
          )}
        </header>
        {loadError && <p className="message app-message">{loadError}</p>}
        <CustomerPage
          autoPrint={autoPrint}
          autoReturn={autoReturn}
          onCreated={loadState}
          previewNumber={previewNumber}
          settings={settings}
        />
      </div>
    );
  }

  if (activePage === "admin" && !access?.authenticated) {
    if (access?.customerAccess) {
      return (
        <div className="app-shell creator-shell">
          <header className="creator-topbar">
            <div className="creator-brand">
              <BrandLogo className="brand-mark" />
            </div>
            <button className="creator-logout" onClick={logout} type="button">
              <LogOut size={24} />
              退出
            </button>
          </header>
          <CustomerPage
            autoPrint={autoPrint}
            autoReturn={autoReturn}
            onCreated={loadState}
            previewNumber={previewNumber}
            settings={settings}
          />
        </div>
      );
    }
    return <AccessGate access={access} onAuthenticated={(nextAccess) => {
      setAccess(nextAccess);
      loadAccessAndState();
    }} />;
  }

  if (activePage === "admin") {
    return (
      <AdminPage
        access={access}
        onGoCustomer={() => setPage("customer")}
        onLogout={logout}
        onSettingsSaved={handleSettingsSaved}
        settings={settings}
      />
    );
  }

  const customerKiosk = activePage === "customer";

  return (
    <div className={`app-shell ${customerKiosk ? "creator-shell" : ""}`}>
      <header className={customerKiosk ? "creator-topbar" : "topbar"}>
        <div className={customerKiosk ? "creator-brand" : "brand"}>
          <BrandLogo className="brand-mark" />
        </div>
        <nav>
          {!customerKiosk && (
            <button
              className={activePage === "customer" ? "active" : ""}
              disabled={customerDisabled}
              onClick={() => setPage("customer")}
              type="button"
            >
              <Home size={18} />
              定制页
            </button>
          )}
          {showStaffNavigation && (
            <button className={activePage === "admin" ? "active" : ""} onClick={() => setPage("admin")} type="button">
              <Settings size={18} />
              后台
            </button>
          )}
          {showLogout && (
            <button onClick={logout} type="button">
              <LogOut size={18} />
              退出
            </button>
          )}
        </nav>
      </header>
      {loadError && <p className="message app-message">{loadError}</p>}
      <CustomerPage
        autoPrint={autoPrint}
        autoReturn={autoReturn}
        onCreated={loadState}
        previewNumber={previewNumber}
        settings={settings}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
