import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { apiFetch } from "../lib/api";
import { templates } from "../lib/constants";
import { normalizeCustomerName, finalizeCustomerName, isValidCustomerName } from "../lib/validate";
import { CanvasPreview } from "../components/CanvasPreview";

function isLocalPrintEnvironment() {
  const hostname = window.location.hostname;
  const userAgent = window.navigator.userAgent.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || userAgent.includes("electron");
}

function getTicketPrintUrl(orderId, { autoReturn = false } = {}) {
  const params = new URLSearchParams({ autoPrint: "1" });
  if (autoReturn) {
    params.set("autoReturn", "1");
  }
  return `/ticket/${orderId}?${params.toString()}`;
}

export function CustomerPage({ settings, previewNumber, onCreated }) {
  const [templateId, setTemplateId] = useState("template_01");
  const [customerText, setCustomerText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("neutral");
  const [fallbackOrder, setFallbackOrder] = useState(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isComposingName, setIsComposingName] = useState(false);
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const actionPanelRef = useRef(null);
  const template = templates.find((item) => item.id === templateId);
  const timestamp = useMemo(() => new Date(), []);
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
    if (busy) {
      return;
    }
    if (!isValidCustomerName(finalName)) {
      setMessage("请输入 1-12 位英文大写字母，可包含空格");
      setMessageType("error");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    setFallbackOrder(null);
    try {
      const pngDataUrl = canvasRef.current.toDataURL("image/png");
      const localPrint = isLocalPrintEnvironment();
      const response = await apiFetch(localPrint ? "/api/orders/direct-print" : "/api/orders", {
        method: "POST",
        body: JSON.stringify({ templateId, customerText: finalName, pngDataUrl })
      });
      const data = await response.json();
      if (!response.ok) {
        if (localPrint && data.id) {
          setFallbackOrder({ id: data.id, orderNo: data.orderNo || data.order_no || "" });
          Promise.resolve(onCreated?.()).catch(() => {});
        }
        throw new Error(data.message || "打印失败，订单已保存后可在后台重打");
      }

      if (!localPrint) {
        window.location.assign(getTicketPrintUrl(data.id, { autoReturn: true }));
        return;
      }

      setMessage(`打印成功\n编号：${data.orderNo}`);
      setMessageType("success");
      Promise.resolve(onCreated?.()).catch(() => {});
      window.setTimeout(() => {
        setCustomerText("");
        setTemplateId("template_01");
        setMessage("");
        inputRef.current?.focus();
      }, 1200);
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
        {fallbackOrder && (
          <a className="secondary-btn creator-fallback-print" href={getTicketPrintUrl(fallbackOrder.id)}>
            打开浏览器打印页{fallbackOrder.orderNo ? `：${fallbackOrder.orderNo}` : ""}
          </a>
        )}
      </form>
    </main>
  );
}
