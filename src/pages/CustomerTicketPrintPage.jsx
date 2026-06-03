import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { TicketPrint } from "../components/TicketPrint";

export function CustomerTicketPrintPage({ orderId, autoReturn }) {
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
