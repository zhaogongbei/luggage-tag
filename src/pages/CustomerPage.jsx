import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { apiFetch } from "../lib/api";
import { templates } from "../lib/constants";
import { normalizeCustomerName, finalizeCustomerName, isValidCustomerName } from "../lib/validate";
import { CanvasPreview } from "../components/CanvasPreview";
import EscPos from "../plugins/escpos";

export function CustomerPage({ settings, previewNumber, onCreated, autoPrint = false }) {
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
        } catch {
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
        // 普通浏览器 → 避免 window.open 被弹窗拦截，改用 location.href
        window.location.href = `/ticket/${data.id}?autoPrint=1`;
        return;
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
