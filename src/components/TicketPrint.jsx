import { formatDateTime } from "../lib/format";

export function TicketPrint({ order }) {
  return (
    <div className="ticket-print">
      <strong className="ticket-name">{order.customer_text}</strong>
      <span className="ticket-no">{order.order_no}</span>
      <time className="ticket-time">{formatDateTime(order.generated_at)}</time>
    </div>
  );
}
