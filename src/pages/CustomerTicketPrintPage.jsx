import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { apiFetch } from "../lib/api";
import { TicketPrint } from "../components/TicketPrint";

export function CustomerTicketPrintPage({ orderId, autoPrint, autoReturn }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const [printStatus, setPrintStatus] = useState("准备好后请点击打印");

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
    if (!order || !autoPrint) {
      return undefined;
    }
    setPrintStatus("正在打开打印窗口");
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
  }, [order, autoPrint, autoReturn]);

  function printNow() {
    setPrintStatus("正在打开打印窗口");
    window.print();
  }

  if (error) {
    return <main className="print-page"><p className="message">{error}</p></main>;
  }

  if (!order) {
    return <main className="print-page"><p>Loading...</p></main>;
  }

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <div>
          <strong>{order.order_no}</strong>
          <span>{printStatus}</span>
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
