import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CheckCircle2,
  Download,
  Home,
  Printer,
  RefreshCw,
  Settings,
  Tag
} from "lucide-react";
import "./styles.css";

const API_BASE = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:3001` : "";

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
  const upperValue = value.trim().toUpperCase();
  const chars = Array.from(upperValue);
  const hasChinese = /[\u3400-\u9fff]/.test(upperValue);
  return chars.slice(0, hasChinese ? 6 : 12).join("");
}

function drawCenteredText(ctx, text, x, y, font, color) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

function drawTag(canvas, { template, customerText, orderNo, watermarkEnabled, timestamp, image }) {
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
  drawCenteredText(ctx, orderNo, centerX, height * 0.62, "600 14pt Montserrat, Helvetica, Arial, sans-serif", ink);
  drawCenteredText(ctx, name, centerX, height * 0.69, "700 28pt Helvetica, Arial, sans-serif", ink);

  if (watermarkEnabled) {
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

function CanvasPreview({ template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef }) {
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled && canvasRef.current) {
        drawTag(canvasRef.current, { template, customerText, orderNo, watermarkEnabled, timestamp, image });
      }
    };
    image.src = template.preview;
    return () => {
      cancelled = true;
    };
  }, [template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef]);

  return <canvas className="tag-canvas" ref={canvasRef} />;
}

function PrintPage({ orderId }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadOrder() {
      try {
        const response = await fetch(`${API_BASE}/api/orders/${orderId}`);
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
        <img
          alt={order.order_no}
          onLoad={() => window.setTimeout(() => window.print(), 350)}
          src={`${API_BASE}/api/orders/${order.id}/file/png`}
        />
      </section>
    </main>
  );
}

function CustomerPage({ settings, previewNumber, onCreated }) {
  const [templateId, setTemplateId] = useState("template_01");
  const [customerText, setCustomerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const canvasRef = useRef(null);
  const template = templates.find((item) => item.id === templateId);
  const timestamp = useMemo(() => new Date(), [customerText, templateId, previewNumber]);
  const normalizedName = normalizeCustomerName(customerText);

  async function submitOrder() {
    if (!normalizedName) {
      setMessage("请输入姓名");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const pngDataUrl = canvasRef.current.toDataURL("image/png");
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, customerText: normalizedName, pngDataUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "生成失败");
      }
      setCustomerText("");
      setMessage(`生成成功：${data.orderNo}`);
      onCreated();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace">
      <section className="panel composer">
        <div className="section-title">
          <Tag size={20} />
          <span>现场定制</span>
        </div>
        <div className="template-grid">
          {templates.map((item) => (
            <button
              className={`template-card ${templateId === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setTemplateId(item.id)}
              type="button"
            >
              <img alt={item.displayName} src={item.preview} />
              <span className="template-meta">
                <strong>{item.displayName}</strong>
                <small>{item.name}</small>
              </span>
            </button>
          ))}
        </div>
        <label className="field">
          <span>姓名</span>
          <input
            maxLength={12}
            value={customerText}
            onChange={(event) => setCustomerText(normalizeCustomerName(event.target.value))}
            placeholder="MARISSA"
          />
          <small className="field-hint">英文最多 12 字符，中文最多 6 字符，自动大写</small>
        </label>
        <div className="number-strip">
          <span>预览编号</span>
          <strong>{previewNumber}</strong>
        </div>
        <button className="primary-btn" disabled={busy} onClick={submitOrder} type="button">
          <CheckCircle2 size={18} />
          {busy ? "生成中" : "确认生成"}
        </button>
        {message && <p className="message">{message}</p>}
      </section>

      <section className="preview-stage">
        <CanvasPreview
          canvasRef={canvasRef}
          customerText={normalizedName}
          orderNo={previewNumber}
          template={template}
          timestamp={timestamp}
          watermarkEnabled={settings.watermarkEnabled}
        />
      </section>
    </main>
  );
}

function AdminPage({ settings, onSettingsSaved }) {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(settings);
  const [printerState, setPrinterState] = useState({ printers: [], defaultPrinter: "", selectedPrinter: "" });
  const [printerMessage, setPrinterMessage] = useState("");

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  async function loadOrders() {
    const response = await fetch(`${API_BASE}/api/orders`);
    setOrders(await response.json());
  }

  async function loadPrinters() {
    const response = await fetch(`${API_BASE}/api/printers`);
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

  async function saveSettings() {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });
    onSettingsSaved(await response.json());
  }

  async function togglePrinted(order) {
    await fetch(`${API_BASE}/api/orders/${order.id}/print-status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        printStatus: order.print_status === "printed" ? "pending" : "printed"
      })
    });
    loadOrders();
  }

  function openPrintPreview(order) {
    window.open(`/print/${order.id}`, "_blank", "noopener,noreferrer");
  }

  async function saveSelectedPrinter(selectedPrinter) {
    setPrinterState({ ...printerState, selectedPrinter });
    await fetch(`${API_BASE}/api/printers/selected`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedPrinter })
    });
    setPrinterMessage("打印机选择已保存");
  }

  async function testPrinter() {
    const response = await fetch(`${API_BASE}/api/printers/test`, { method: "POST" });
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
        </div>
        <button className="secondary-btn" onClick={saveSettings} type="button">
          <CheckCircle2 size={18} />
          保存设置
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

      <section className="panel orders-panel">
        <div className="section-title split">
          <span>订单列表</span>
          <button className="icon-btn" onClick={loadOrders} title="刷新" type="button">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th>
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
                  <td>{order.order_no}</td>
                  <td>{order.customer_text}</td>
                  <td>{templates.find((item) => item.id === order.template_id)?.displayName ?? legacyTemplateNames[order.template_id] ?? order.template_id}</td>
                  <td>{formatDateTime(order.generated_at)}</td>
                  <td>
                    <span className={`status ${order.print_status}`}>{order.print_status === "printed" ? "已打印" : "待打印"}</span>
                  </td>
                  <td className="actions">
                    <button onClick={() => openPrintPreview(order)} title="打开浏览器打印预览" type="button">
                      <Printer size={17} />
                      打印
                    </button>
                    <a href={`${API_BASE}/api/orders/${order.id}/download/png`} title="下载 PNG">
                      <Download size={17} /> PNG
                    </a>
                    <a href={`${API_BASE}/api/orders/${order.id}/download/pdf`} title="下载 PDF">
                      <Download size={17} /> PDF
                    </a>
                    <button onClick={() => togglePrinted(order)} title="重新打印不增加编号" type="button">
                      <CheckCircle2 size={17} />
                      {order.print_status === "printed" ? "标记待打" : "标记已打"}
                    </button>
                  </td>
                </tr>
              ))}
              {!orders.length && (
                <tr>
                  <td colSpan="6" className="empty">
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
  const [page, setPage] = useState("customer");
  const [settings, setSettings] = useState({ prefix: "No.", currentNumber: 1, digits: 4, watermarkEnabled: true });
  const [previewNumber, setPreviewNumber] = useState("No.0001");

  async function loadState() {
    const [settingsResponse, numberResponse] = await Promise.all([
      fetch(`${API_BASE}/api/settings`),
      fetch(`${API_BASE}/api/preview-number`)
    ]);
    setSettings(await settingsResponse.json());
    const numberData = await numberResponse.json();
    setPreviewNumber(numberData.orderNo);
  }

  useEffect(() => {
    loadState();
  }, []);

  function handleSettingsSaved(nextSettings) {
    setSettings(nextSettings);
    loadState();
  }

  if (printMatch) {
    return <PrintPage orderId={printMatch[1]} />;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">K</span>
          <div>
            <h1>DIY 行李牌现场定制</h1>
            <p>客户定制 / 订单后台 / 文件导出</p>
          </div>
        </div>
        <nav>
          <button className={page === "customer" ? "active" : ""} onClick={() => setPage("customer")} type="button">
            <Home size={18} />
            定制页
          </button>
          <button className={page === "admin" ? "active" : ""} onClick={() => setPage("admin")} type="button">
            <Settings size={18} />
            后台
          </button>
        </nav>
      </header>
      {page === "customer" ? (
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
