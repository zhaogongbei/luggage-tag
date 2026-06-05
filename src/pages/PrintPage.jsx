import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { apiFetch } from "../lib/api";
import { ticketPrintLayout } from "../lib/constants";
import { TicketPrint } from "../components/TicketPrint";

export function PrintPage({ orderId, autoPrint }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState("");
  const printLayout = order?.ticketPrintLayout ?? ticketPrintLayout;

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@page { size: ${printLayout.widthMm}mm ${printLayout.heightMm}mm; margin: 0; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [printLayout.widthMm, printLayout.heightMm]);

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
    if (order && autoPrint) {
      const timer = window.setTimeout(() => window.print(), 350);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [order, autoPrint]);

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
