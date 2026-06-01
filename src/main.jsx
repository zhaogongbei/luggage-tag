import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Download,
  Home,
  LogIn,
  LogOut,
  MoreHorizontal,
  Printer,
  RefreshCw,
  Settings,
  Trash2
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : "";
const APP_VERSION = "V1.4.16";
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

  async function submitOrder() {
    if (!isValidCustomerName(finalName)) {
      setMessage("请输入 1-12 位英文大写字母，可包含空格");
      setMessageType("error");
      return;
    }
    const printWindow = autoPrint ? window.open("about:blank", "_blank") : null;
    setBusy(true);
    setMessage("");
    try {
      const pngDataUrl = canvasRef.current.toDataURL("image/png");
      const response = await apiFetch("/api/orders", {
        method: "POST",
        body: JSON.stringify({ templateId, customerText: finalName, pngDataUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "生成失败");
      }
      setCustomerText("");
      setMessage("生成成功");
      setMessageType("success");
      onCreated();
      if (autoPrint && data.id) {
        const params = new URLSearchParams({ autoReturn: autoReturn ? "1" : "0" });
        const printUrl = `/ticket/${data.id}?${params.toString()}`;
        if (printWindow) {
          printWindow.location.href = printUrl;
        } else {
          window.open(printUrl, "_blank", "noopener,noreferrer");
        }
      }
      if (autoReturn) {
        window.setTimeout(() => {
          setMessage("");
          setTemplateId("template_01");
        }, 2200);
      }
    } catch (error) {
      if (printWindow && !printWindow.closed) {
        printWindow.close();
      }
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
          submitOrder();
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
          <CheckCircle2 size={42} />
          {busy ? "生成中" : "提交生成"}
        </button>
        {message && <p className={`message ${messageType}`}>{message}</p>}
      </form>
    </main>
  );
}

function AccessGate({ access, onAuthenticated }) {
  const [loginForm, setLoginForm] = useState({ username: "admin", password: "" });
  const [inviteCode, setInviteCode] = useState("");
  const [message, setMessage] = useState("");
  const isMaintenance = access?.deploymentMode === "maintenance";

  async function login(event) {
    event.preventDefault();
    setMessage("");
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
  }

  async function enterInvite(event) {
    event.preventDefault();
    setMessage("");
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
      const response = await apiFetch("/api/auth/status");
      setAccess(await response.json());
      setLoading(false);
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

function AdminPage({ settings, onSettingsSaved }) {
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

  useEffect(() => {
    setForm(settings);
    setEventForm(createEventFormFromSettings(settings));
  }, [settings]);

  async function loadOrders() {
    const response = await apiFetch(`/api/orders${showDeletedOrders ? "?deleted=true" : ""}`);
    const nextOrders = await response.json();
    setOrders(nextOrders);
    setSelectedOrderIds((ids) => ids.filter((id) => nextOrders.some((order) => order.id === id)));
  }

  async function loadPrinters() {
    const response = await apiFetch("/api/printers");
    const data = await response.json();
    setPrinterState({
      printers: data.printers ?? [],
      defaultPrinter: data.defaultPrinter ?? "",
      selectedPrinter: data.selectedPrinter ?? ""
    });
  }

  useEffect(() => {
    loadOrders();
    loadPrinters();
  }, []);

  useEffect(() => {
    loadOrders();
  }, [showDeletedOrders]);

  useEffect(() => {
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
  }, [layoutOptions]);

  async function saveSettings() {
    if (
      Number(form.currentNumber) < Number(settings.currentNumber) &&
      !window.confirm(`当前编号将从 ${settings.currentNumber} 调低到 ${form.currentNumber}，可能造成编号重复。确认继续？`)
    ) {
      return;
    }
    const response = await apiFetch("/api/settings", {
      method: "PUT",
      body: JSON.stringify(form)
    });
    onSettingsSaved(await response.json());
  }

  async function resetEvent() {
    if (!window.confirm("确认开启新活动并重置编号？历史订单编号不会改变。")) {
      return;
    }
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
  }

  async function togglePrinted(order) {
    await apiFetch(`/api/orders/${order.id}/print-status`, {
      method: "PATCH",
      body: JSON.stringify({
        printStatus: order.print_status === "printed" ? "pending" : "printed"
      })
    });
    loadOrders();
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

  function openPrintPreview(order) {
    window.open(`/print/${order.id}`, "_blank", "noopener,noreferrer");
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

  return (
    <main className="admin-layout">
      <section className="panel settings-panel">
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
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button">
          <CheckCircle2 size={18} />
          保存设置
        </button>
      </section>

      <section className="panel event-reset-panel">
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
      </section>

      <section className="panel access-settings-panel">
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
      </section>

      <section className="panel printer-panel">
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
            <span>选择打印机（V2 预留）</span>
            <select
              value={printerState.selectedPrinter}
              onChange={(event) => saveSelectedPrinter(event.target.value)}
            >
              <option value="">使用浏览器打印对话框</option>
              {printerState.printers.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.name}{printer.isDefault ? "（默认）" : ""}
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
      </section>

      <section className="panel layout-panel">
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
      </section>

      <section className="panel orders-panel">
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
        <div className="table-wrap">
          <table>
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
              {orders.map((order) => (
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
                        <button onClick={() => openPrintPreview(order)} title="打开浏览器打印预览" type="button">
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
              {!orders.length && (
                <tr>
                  <td colSpan="8" className="empty">
                    暂无订单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function App() {
  const printMatch = window.location.pathname.match(/^\/print\/(\d+)$/);
  const ticketMatch = window.location.pathname.match(/^\/ticket\/(\d+)$/);
  const impositionPrintMatch = window.location.pathname === "/print-layout" || window.location.pathname === "/print-a4";
  const creatorMode = window.location.pathname === "/creator";
  const creatorParams = new URLSearchParams(window.location.search);
  const [page, setPage] = useState("customer");
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
    await apiFetch("/api/auth/logout", { method: "POST" });
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
  const showLogout = Boolean(access?.authenticated || access?.invited);
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
            <span className="brand-mark">K</span>
            <div>
              <h1>DIY 行李牌自助定制</h1>
              <p>{APP_VERSION}</p>
            </div>
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
    return <AccessGate access={access} onAuthenticated={(nextAccess) => {
      setAccess(nextAccess);
      loadAccessAndState();
    }} />;
  }

  const customerKiosk = activePage === "customer";

  return (
    <div className={`app-shell ${customerKiosk ? "creator-shell" : ""}`}>
      <header className={customerKiosk ? "creator-topbar" : "topbar"}>
        <div className={customerKiosk ? "creator-brand" : "brand"}>
          <span className="brand-mark">K</span>
          <div>
            <h1>DIY 行李牌现场定制</h1>
            <p>{customerKiosk ? APP_VERSION : `客户定制 / 订单后台 / 文件导出 / ${APP_VERSION}`}</p>
          </div>
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
      {activePage === "customer" ? (
        <CustomerPage
          onCreated={loadState}
          previewNumber={previewNumber}
          settings={settings}
        />
      ) : (
        <AdminPage onSettingsSaved={handleSettingsSaved} settings={settings} />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
