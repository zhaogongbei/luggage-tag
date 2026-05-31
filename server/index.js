import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { jsPDF } from "jspdf";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.LUGGAGE_TAG_DATA_DIR
  ? path.resolve(process.env.LUGGAGE_TAG_DATA_DIR)
  : path.join(rootDir, "data");
const exportDir = path.join(dataDir, "exports");
const dbPath = path.join(dataDir, "luggage-tag.sqlite");
const port = Number(process.env.PORT || 3001);
const execFileAsync = promisify(execFile);

await fs.mkdir(exportDir, { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    template_id TEXT NOT NULL,
    customer_text TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    print_status TEXT NOT NULL DEFAULT 'pending',
    png_path TEXT NOT NULL,
    pdf_path TEXT NOT NULL
  );
`);

const defaultSettings = {
  prefix: "No.",
  currentNumber: "1",
  digits: "4",
  watermarkEnabled: "true",
  selectedPrinter: ""
};
const templateIds = ["template_01", "template_02", "template_03"];
const paperPresets = {
  A5: { width: 148, height: 210 },
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 }
};
const defaultLayoutOptions = {
  paperPreset: "A4",
  paperWidth: 210,
  paperHeight: 297,
  productWidth: 70,
  productHeight: 110,
  margin: 8,
  gap: 6,
  showOrderNo: true,
  cropMarks: true,
  autoRotate: true
};

for (const [key, value] of Object.entries(defaultSettings)) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run(key, value);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "12mb" }));

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(rootDir, "dist")));
}

async function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  return {
    prefix: settings.prefix ?? defaultSettings.prefix,
    currentNumber: Number(settings.currentNumber ?? defaultSettings.currentNumber),
    digits: Number(settings.digits ?? defaultSettings.digits),
    watermarkEnabled: (settings.watermarkEnabled ?? defaultSettings.watermarkEnabled) === "true",
    selectedPrinter: settings.selectedPrinter ?? defaultSettings.selectedPrinter
  };
}

function formatOrderNo(settings) {
  return `${settings.prefix}${String(settings.currentNumber).padStart(settings.digits, "0")}`;
}

function imageDataToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid PNG data URL");
  }
  return Buffer.from(match[1], "base64");
}

function getPngSize(buffer) {
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return { width: 900, height: 560 };
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function normalizeCustomerName(value) {
  const upperValue = value.trim().toUpperCase();
  const hasChinese = /[\u3400-\u9fff]/.test(upperValue);
  return Array.from(upperValue).slice(0, hasChinese ? 6 : 12).join("");
}

function toPublicOrder(order) {
  if (!order) {
    return null;
  }
  return {
    id: order.id,
    order_no: order.order_no,
    template_id: order.template_id,
    customer_text: order.customer_text,
    generated_at: order.generated_at,
    print_status: order.print_status
  };
}

function parseOrderIds(value) {
  const rawIds = Array.isArray(value) ? value : String(value ?? "").split(",");
  return rawIds
    .map((id) => Number.parseInt(id, 10))
    .filter((id, index, ids) => Number.isInteger(id) && id > 0 && ids.indexOf(id) === index);
}

function getOrdersByIds(orderIds) {
  if (!orderIds.length) {
    return [];
  }
  const placeholders = orderIds.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM orders WHERE id IN (${placeholders})`).all(...orderIds);
  const byId = new Map(rows.map((order) => [order.id, order]));
  return orderIds.map((id) => byId.get(id)).filter(Boolean);
}

function parseNumber(value, fallback, min = 0.1, max = 2000) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function normalizeLayoutOptions(value = {}) {
  const preset = String(value.paperPreset ?? defaultLayoutOptions.paperPreset).toUpperCase();
  const presetSize = paperPresets[preset];
  const paperWidth = presetSize
    ? presetSize.width
    : parseNumber(value.paperWidth, defaultLayoutOptions.paperWidth, 20);
  const paperHeight = presetSize
    ? presetSize.height
    : parseNumber(value.paperHeight, defaultLayoutOptions.paperHeight, 20);

  return {
    paperPreset: presetSize ? preset : "CUSTOM",
    paperWidth,
    paperHeight,
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
  return {
    capacity: candidate.capacity,
    usedArea: usedWidth * usedHeight,
    waste: candidate.pageWidth * candidate.pageHeight - usedWidth * usedHeight
  };
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
        candidates.push({
          ...options,
          ...page,
          ...item,
          blockHeight,
          columns,
          rows,
          capacity: columns * rows,
          labelHeight
        });
      }
    }
  }

  if (!candidates.length) {
    throw new Error("Product size does not fit on selected paper");
  }

  candidates.sort((left, right) => {
    const leftScore = scoreLayout(left);
    const rightScore = scoreLayout(right);
    if (rightScore.capacity !== leftScore.capacity) {
      return rightScore.capacity - leftScore.capacity;
    }
    return leftScore.waste - rightScore.waste;
  });

  const best = candidates[0];
  const totalWidth = best.columns * best.itemWidth + (best.columns - 1) * best.gap;
  const totalHeight = best.rows * best.blockHeight + (best.rows - 1) * best.gap;
  const startX = (best.pageWidth - totalWidth) / 2;
  const startY = (best.pageHeight - totalHeight) / 2;
  const positions = Array.from({ length: best.capacity }, (_, index) => {
    const column = index % best.columns;
    const row = Math.floor(index / best.columns);
    return {
      x: startX + column * (best.itemWidth + best.gap),
      y: startY + row * (best.blockHeight + best.gap),
      index,
      column,
      row
    };
  });

  return { ...best, positions };
}

async function getWindowsPrinters() {
  if (process.platform !== "win32") {
    return [];
  }
  const command = [
    "-NoProfile",
    "-Command",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress"
  ];
  const { stdout } = await execFileAsync("powershell.exe", command, { windowsHide: true });
  if (!stdout.trim()) {
    return [];
  }
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((printer) => ({
    name: printer.Name,
    isDefault: Boolean(printer.Default)
  }));
}

async function createPdfFromPng(orderNo, pngDataUrl, outputPath) {
  const { width, height } = getPngSize(imageDataToBuffer(pngDataUrl));
  const pdf = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    compress: true
  });
  pdf.addImage(pngDataUrl, "PNG", 0, 0, width, height);
  pdf.setProperties({ title: `Luggage Tag ${orderNo}` });
  await fs.writeFile(outputPath, Buffer.from(pdf.output("arraybuffer")));
}

function drawCropMarks(pdf, x, y, width, height) {
  const markLength = 4;
  const corners = [
    [x, y, 1, 1],
    [x + width, y, -1, 1],
    [x, y + height, 1, -1],
    [x + width, y + height, -1, -1]
  ];
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.1);
  corners.forEach(([cornerX, cornerY, directionX, directionY]) => {
    pdf.line(cornerX, cornerY, cornerX + directionX * markLength, cornerY);
    pdf.line(cornerX, cornerY, cornerX, cornerY + directionY * markLength);
  });
}

async function createImpositionPdf(orders, rawOptions = {}) {
  const layout = computeImpositionLayout(rawOptions);
  const pdf = new jsPDF({
    orientation: layout.pageWidth >= layout.pageHeight ? "landscape" : "portrait",
    unit: "mm",
    format: [layout.pageWidth, layout.pageHeight],
    compress: true
  });

  for (const [index, order] of orders.entries()) {
    if (index > 0 && index % layout.capacity === 0) {
      pdf.addPage();
    }
    const position = layout.positions[index % layout.capacity];
    const x = position.x;
    const y = position.y;
    const imageBuffer = await fs.readFile(order.png_path);
    const imageData = `data:image/png;base64,${imageBuffer.toString("base64")}`;

    if (layout.itemRotated) {
      pdf.addImage(imageData, "PNG", x, y + layout.itemHeight, layout.itemHeight, layout.itemWidth, undefined, "FAST", 90);
    } else {
      pdf.addImage(imageData, "PNG", x, y, layout.itemWidth, layout.itemHeight);
    }
    if (layout.cropMarks) {
      drawCropMarks(pdf, x, y, layout.itemWidth, layout.itemHeight);
    }

    if (layout.showOrderNo) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(order.order_no, x + layout.itemWidth / 2, y + layout.itemHeight + 4.5, { align: "center" });
    }
  }

  pdf.setProperties({ title: "Luggage Tag Imposition Layout" });
  return Buffer.from(pdf.output("arraybuffer"));
}

app.get("/api/settings", async (_req, res) => {
  res.json(await getSettings());
});

app.put("/api/settings", async (req, res) => {
  const prefix = String(req.body.prefix ?? "No.").slice(0, 12);
  const currentNumber = Math.max(1, Number.parseInt(req.body.currentNumber, 10) || 1);
  const digits = Math.min(8, Math.max(1, Number.parseInt(req.body.digits, 10) || 4));
  const watermarkEnabled = Boolean(req.body.watermarkEnabled);
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);

  db.prepare("UPDATE settings SET value = ? WHERE key = 'prefix'").run(prefix);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'currentNumber'").run(String(currentNumber));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'digits'").run(String(digits));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'watermarkEnabled'").run(String(watermarkEnabled));
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  res.json(await getSettings());
});

app.get("/api/preview-number", async (_req, res) => {
  const settings = await getSettings();
  res.json({ orderNo: formatOrderNo(settings), settings });
});

app.get("/api/orders", async (_req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
  res.json(rows.map(toPublicOrder));
});

app.post("/api/layout/preview", async (req, res) => {
  try {
    const layout = computeImpositionLayout(req.body.layoutOptions ?? req.body);
    res.json({
      paperWidth: layout.pageWidth,
      paperHeight: layout.pageHeight,
      productWidth: layout.itemWidth,
      productHeight: layout.itemHeight,
      columns: layout.columns,
      rows: layout.rows,
      capacity: layout.capacity,
      autoRotated: layout.itemRotated,
      pageRotated: layout.pageRotated,
      gap: layout.gap,
      margin: layout.margin,
      showOrderNo: layout.showOrderNo,
      cropMarks: layout.cropMarks,
      labelHeight: layout.labelHeight,
      positions: layout.positions
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

app.post("/api/orders/imposition", async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) {
    return res.status(400).json({ message: "Select at least one order" });
  }
  try {
    const layoutOptions = req.body.layoutOptions ?? req.body;
    const layout = computeImpositionLayout(layoutOptions);
    const pdfBuffer = await createImpositionPdf(orders, layoutOptions);
    const filename = `imposition-${layout.paperPreset.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Failed to create imposition PDF" });
  }
});

app.post("/api/orders/a4-layout", async (req, res) => {
  const orderIds = parseOrderIds(req.body.orderIds);
  const orders = getOrdersByIds(orderIds);
  if (!orders.length) {
    return res.status(400).json({ message: "Select at least one order" });
  }
  try {
    const pdfBuffer = await createImpositionPdf(orders, {
      ...defaultLayoutOptions,
      ...(req.body.layoutOptions ?? {}),
      showOrderNo: req.body.showOrderNo !== false
    });
    const filename = `a4-layout-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create A4 layout PDF" });
  }
});

app.get("/api/orders/batch", async (req, res) => {
  const orderIds = parseOrderIds(req.query.ids);
  const orders = getOrdersByIds(orderIds);
  res.json(orders.map(toPublicOrder));
});

app.get("/api/orders/:id", async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.json(toPublicOrder(order));
});

app.post("/api/orders", async (req, res) => {
  const templateId = String(req.body.templateId ?? "");
  const customerText = normalizeCustomerName(String(req.body.customerText ?? ""));
  const pngDataUrl = String(req.body.pngDataUrl ?? "");

  if (!templateIds.includes(templateId)) {
    return res.status(400).json({ message: "Invalid template" });
  }
  if (!customerText) {
    return res.status(400).json({ message: "Customer text is required" });
  }

  try {
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    const settings = await getSettings();
    const orderNo = formatOrderNo(settings);
    const generatedAt = new Date().toISOString();
    const safeName = orderNo.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const pngPath = path.join(exportDir, `${safeName}.png`);
    const pdfPath = path.join(exportDir, `${safeName}.pdf`);

    await fs.writeFile(pngPath, imageDataToBuffer(pngDataUrl));
    await createPdfFromPng(orderNo, pngDataUrl, pdfPath);
    db.prepare(
      `INSERT INTO orders (order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      orderNo,
      templateId,
      customerText,
      generatedAt,
      pngPath,
      pdfPath
    );
    db.prepare("UPDATE settings SET value = ? WHERE key = 'currentNumber'").run(String(settings.currentNumber + 1));
    db.exec("COMMIT");
    res.status(201).json({ orderNo, generatedAt });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no active transaction
    }
    console.error(error);
    res.status(500).json({ message: "Failed to create order" });
  }
});

app.patch("/api/orders/:id/print-status", async (req, res) => {
  const status = req.body.printStatus === "printed" ? "printed" : "pending";
  db.prepare("UPDATE orders SET print_status = ? WHERE id = ?").run(status, req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  res.json(toPublicOrder(order));
});

app.get("/api/printers", async (_req, res) => {
  try {
    const printers = await getWindowsPrinters();
    const settings = await getSettings();
    res.json({
      printers,
      defaultPrinter: printers.find((printer) => printer.isDefault)?.name ?? "",
      selectedPrinter: settings.selectedPrinter
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to read printers", printers: [] });
  }
});

app.put("/api/printers/selected", async (req, res) => {
  const selectedPrinter = String(req.body.selectedPrinter ?? "").slice(0, 160);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'selectedPrinter'").run(selectedPrinter);
  res.json({ selectedPrinter });
});

app.post("/api/printers/test", async (_req, res) => {
  res.status(501).json({
    message: "Local print service is reserved for V2 and is not enabled in browser-print mode."
  });
});

app.post("/api/orders/:id/print", async (req, res) => {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  res.status(501).json({
    message: "Local direct printing is reserved for V2. Use the browser print preview page in V1.",
    order: toPublicOrder(order)
  });
});

app.get("/api/orders/:id/download/:type", async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) {
    return res.status(400).json({ message: "Unsupported download type" });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  const filePath = type === "png" ? order.png_path : order.pdf_path;
  res.download(filePath, `${order.order_no}.${type}`);
});

app.get("/api/orders/:id/file/:type", async (req, res) => {
  const type = req.params.type;
  if (!["png", "pdf"].includes(type)) {
    return res.status(400).json({ message: "Unsupported file type" });
  }
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
  if (!order) {
    return res.status(404).json({ message: "Order not found" });
  }
  const filePath = type === "png" ? order.png_path : order.pdf_path;
  res.type(type);
  res.sendFile(filePath);
});

if (process.env.NODE_ENV === "production") {
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(rootDir, "dist", "index.html"));
  });
}

app.listen(port, () => {
  console.log(`API server running at http://localhost:${port}`);
});
