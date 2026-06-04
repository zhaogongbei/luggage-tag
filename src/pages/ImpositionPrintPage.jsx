import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import { apiFetch } from "../lib/api";
import { normalizeLayoutOptions, chunkOrders } from "../lib/layout";
import { TicketPrint } from "../components/TicketPrint";

export function ImpositionPrintPage({ orderIds, layoutOptions, autoPrint }) {
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
    if (orders.length && layout && autoPrint) {
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [orders, layout, autoPrint]);

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
