import { formatDateTime } from "../lib/format";
import { ticketPrintLayout } from "../lib/constants";

export function TicketPrint({ order, layout }) {
  const printLayout = layout ?? order.ticketPrintLayout ?? ticketPrintLayout;
  const contentAlign = ["left", "center", "right"].includes(printLayout.contentAlign) ? printLayout.contentAlign : "center";
  const ticketStyle = {
    "--ticket-width": `${printLayout.widthMm}mm`,
    "--ticket-height": `${printLayout.heightMm}mm`,
    "--ticket-top-offset": `${printLayout.topOffsetMm}mm`,
    "--ticket-padding-top": `${printLayout.paddingTopMm}mm`,
    "--ticket-name-font-size": `${printLayout.nameFontSize}pt`,
    "--ticket-serial-font-size": `${printLayout.serialFontSize}pt`,
    "--ticket-time-font-size": `${printLayout.timeFontSize}pt`,
    "--ticket-name-margin-bottom": `${printLayout.nameMarginBottomMm}mm`,
    "--ticket-serial-margin-bottom": `${printLayout.serialMarginBottomMm}mm`,
    "--ticket-footer-font-size": `${printLayout.footerFontSizePt}pt`,
    "--ticket-footer-opacity": `${Math.max(0, Math.min(100, Number(printLayout.footerOpacity) || 0)) / 100}`,
    "--ticket-footer-bottom": `${printLayout.footerBottomMm}mm`,
    "--ticket-content-align": contentAlign,
  };
  const footerOpacity = Math.max(0, Math.min(100, Number(printLayout.footerOpacity) || 0));
  const footerText = String(printLayout.footerText ?? "").trim();

  return (
    <div className={`ticket-print align-${contentAlign}`} style={ticketStyle}>
      <strong className="ticket-name">{order.customer_text}</strong>
      <span className="ticket-no">{order.order_no}</span>
      <time className="ticket-time">{formatDateTime(order.generated_at)}</time>
      {footerText && footerOpacity > 0 && <span className="ticket-footer">{footerText}</span>}
    </div>
  );
}
