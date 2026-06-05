import fs from "node:fs/promises";
import { jsPDF } from "jspdf";
import { defaultLayoutOptions, paperPresets, ticketPrintLayout } from "./config.js";

function ptToMm(value) {
  return value * 25.4 / 72;
}

function getTicketDrawLayout(width, height, printLayout = ticketPrintLayout) {
  const scale = Math.max(0.1, Math.min(width / printLayout.widthMm, height / printLayout.heightMm));
  const nameFontSize = printLayout.nameFontSize * scale;
  const serialFontSize = printLayout.serialFontSize * scale;
  const timeFontSize = printLayout.timeFontSize * scale;
  const topOffset = Math.max(0, printLayout.paddingTopMm + printLayout.topOffsetMm) * scale;
  const nameY = topOffset;
  const serialY = nameY + ptToMm(nameFontSize) + printLayout.nameMarginBottomMm * scale;
  const timeY = serialY + ptToMm(serialFontSize) + printLayout.serialMarginBottomMm * scale;
  return { nameFontSize, serialFontSize, timeFontSize, nameY, serialY, timeY, timeMarginBottom: printLayout.timeMarginBottomMm }; 
}

function getTicketTextAnchor(x, width, printLayout = ticketPrintLayout) {
  const contentAlign = printLayout.contentAlign ?? "center";
  if (contentAlign === "left") {
    return { x: x + width * 0.03, align: "left" };
  }
  if (contentAlign === "right") {
    return { x: x + width * 0.97, align: "right" };
  }
  return { x: x + width / 2, align: "center" };
}

function formatTicketDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(new Date(value));
}

function drawTicket(pdf, order, x, y, width, height, printLayout = ticketPrintLayout) {
  const layout = getTicketDrawLayout(width, height, printLayout);
  const textAnchor = getTicketTextAnchor(x, width, printLayout);

  pdf.setFillColor(255, 255, 255);
  pdf.rect(x, y, width, height, "F");
  pdf.setTextColor(0, 0, 0);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(layout.nameFontSize);
  pdf.text(order.customer_text, textAnchor.x, y + layout.nameY, { align: textAnchor.align, baseline: "top", maxWidth: width * 0.94 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(layout.serialFontSize);
  pdf.text(order.order_no, textAnchor.x, y + layout.serialY, { align: textAnchor.align, baseline: "top", maxWidth: width * 0.94 });
  pdf.setFontSize(layout.timeFontSize);
  pdf.text(formatTicketDateTime(order.generated_at), textAnchor.x, y + layout.timeY, { align: textAnchor.align, baseline: "top", maxWidth: width * 0.94 });
}

async function createTicketPdf(order, outputPath, printLayout = ticketPrintLayout) {
  const pdfBuffer = createTicketPdfBuffer(order, printLayout);
  await fs.writeFile(outputPath, pdfBuffer);
}

function createTicketPdfBuffer(order, printLayout = ticketPrintLayout) {
  const width = printLayout.widthMm;
  const height = printLayout.heightMm;
  const pdf = new jsPDF({ orientation: width >= height ? "landscape" : "portrait", unit: "mm", format: [width, height], compress: true });
  drawTicket(pdf, order, 0, 0, width, height, printLayout);
  pdf.setProperties({ title: `Luggage Tag Ticket ${order.order_no}` });
  return Buffer.from(pdf.output("arraybuffer"));
}

function drawCropMarks(pdf, x, y, width, height) {
  const markLength = 4;
  const corners = [[x, y, 1, 1], [x + width, y, -1, 1], [x, y + height, 1, -1], [x + width, y + height, -1, -1]];
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.1);
  corners.forEach(([cx, cy, dx, dy]) => {
    pdf.line(cx, cy, cx + dx * markLength, cy);
    pdf.line(cx, cy, cx, cy + dy * markLength);
  });
}

function parseNumber(value, fallback, min = 0.1, max = 2000) {
  const number = Number(value);
  if (!Number.isFinite(number)) { return fallback; }
  return Math.min(max, Math.max(min, number));
}

function normalizeLayoutOptions(value = {}) {
  const preset = String(value.paperPreset ?? defaultLayoutOptions.paperPreset).toUpperCase();
  const presetSize = paperPresets[preset];
  const paperWidth = presetSize ? presetSize.width : parseNumber(value.paperWidth, defaultLayoutOptions.paperWidth, 20);
  const paperHeight = presetSize ? presetSize.height : parseNumber(value.paperHeight, defaultLayoutOptions.paperHeight, 20);
  return {
    paperPreset: presetSize ? preset : "CUSTOM",
    paperWidth, paperHeight,
    productWidth: parseNumber(value.productWidth, defaultLayoutOptions.productWidth, 5),
    productHeight: parseNumber(value.productHeight, defaultLayoutOptions.productHeight, 5),
    margin: parseNumber(value.margin, defaultLayoutOptions.margin, 0),
    gap: parseNumber(value.gap, defaultLayoutOptions.gap, 0),
    showOrderNo: value.showOrderNo !== false,
    cropMarks: value.cropMarks !== false,
    autoRotate: value.autoRotate !== false
  };
}

function scoreLayout(candidate) {
  const usedWidth = candidate.columns * candidate.itemWidth + (candidate.columns - 1) * candidate.gap;
  const usedHeight = candidate.rows * candidate.blockHeight + (candidate.rows - 1) * candidate.gap;
  return { capacity: candidate.capacity, usedArea: usedWidth * usedHeight, waste: candidate.pageWidth * candidate.pageHeight - usedWidth * usedHeight };
}

function computeImpositionLayout(rawOptions = {}) {
  const options = normalizeLayoutOptions(rawOptions);
  const labelHeight = options.showOrderNo ? 6 : 0;
  const pageOrientations = [
    { pageWidth: options.paperWidth, pageHeight: options.paperHeight, pageRotated: false },
    { pageWidth: options.paperHeight, pageHeight: options.paperWidth, pageRotated: true }
  ];
  const itemOrientations = [
    { itemWidth: options.productWidth, itemHeight: options.productHeight, itemRotated: false },
    { itemWidth: options.productHeight, itemHeight: options.productWidth, itemRotated: true }
  ].filter((item, index) => index === 0 || options.autoRotate);

  const candidates = [];
  for (const page of pageOrientations) {
    for (const item of itemOrientations) {
      const usableWidth = page.pageWidth - options.margin * 2;
      const usableHeight = page.pageHeight - options.margin * 2;
      const blockHeight = item.itemHeight + labelHeight;
      const columns = Math.floor((usableWidth + options.gap) / (item.itemWidth + options.gap));
      const rows = Math.floor((usableHeight + options.gap) / (blockHeight + options.gap));
      if (columns > 0 && rows > 0) {
        candidates.push({ ...options, ...page, ...item, blockHeight, columns, rows, capacity: columns * rows, labelHeight });
      }
    }
  }
  if (!candidates.length) { throw new Error("Product size does not fit on selected paper"); }

  candidates.sort((l, r) => {
    const ls = scoreLayout(l), rs = scoreLayout(r);
    if (rs.capacity !== ls.capacity) { return rs.capacity - ls.capacity; }
    return ls.waste - rs.waste;
  });

  const best = candidates[0];
  const totalWidth = best.columns * best.itemWidth + (best.columns - 1) * best.gap;
  const totalHeight = best.rows * best.blockHeight + (best.rows - 1) * best.gap;
  const startX = (best.pageWidth - totalWidth) / 2;
  const startY = (best.pageHeight - totalHeight) / 2;
  const positions = Array.from({ length: best.capacity }, (_, index) => {
    const column = index % best.columns;
    const row = Math.floor(index / best.columns);
    return { x: startX + column * (best.itemWidth + best.gap), y: startY + row * (best.blockHeight + best.gap), index, column, row };
  });
  return { ...best, positions };
}

async function createImpositionPdf(orders, rawOptions = {}, printLayout = ticketPrintLayout) {
  const layout = computeImpositionLayout(rawOptions);
  const pdf = new jsPDF({
    orientation: layout.pageWidth >= layout.pageHeight ? "landscape" : "portrait",
    unit: "mm", format: [layout.pageWidth, layout.pageHeight], compress: true
  });
  for (const [index, order] of orders.entries()) {
    if (index > 0 && index % layout.capacity === 0) { pdf.addPage(); }
    const position = layout.positions[index % layout.capacity];
    const x = position.x, y = position.y;
    drawTicket(pdf, order, x, y, layout.itemWidth, layout.itemHeight, printLayout);
    if (layout.cropMarks) { drawCropMarks(pdf, x, y, layout.itemWidth, layout.itemHeight); }
    if (layout.showOrderNo) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(order.order_no, x + layout.itemWidth / 2, y + layout.itemHeight + 4.5, { align: "center" });
    }
  }
  pdf.setProperties({ title: "Luggage Tag Imposition Layout" });
  return Buffer.from(pdf.output("arraybuffer"));
}

export { formatTicketDateTime, createTicketPdf, createTicketPdfBuffer, createImpositionPdf, computeImpositionLayout };
