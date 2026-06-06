import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportDir } from "./config.js";
import { getSettings } from "./db.js";
import { formatTicketDateTime, createTicketPdf } from "./pdf.js";

const execFileAsync = promisify(execFile);

const PRINTER_CACHE_TTL_MS = 30_000;
let printerCache = { data: null, fetchedAt: 0 };

function mmToHundredthsInch(value) {
  return Math.round(value * 100 / 25.4);
}

async function getSystemPrintersFresh() {
  if (process.platform === "win32") { return getWindowsPrinters(); }
  return getCupsPrinters();
}

async function getSystemPrinters(options = {}) {
  const forceRefresh = Boolean(options.refresh);
  if (!forceRefresh && printerCache.data && Date.now() - printerCache.fetchedAt < PRINTER_CACHE_TTL_MS) {
    return printerCache.data;
  }
  const printers = await getSystemPrintersFresh();
  printerCache = { data: printers, fetchedAt: Date.now() };
  return printers;
}

function isVirtualPrinterName(name) {
  return /\b(pdf|xps|onenote|fax)\b|wps|\u5BFC\u51FA\u4E3A/i.test(String(name ?? ""));
}

async function getWindowsPrinters() {
  const command = ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Printer | Select-Object Name,Default | ConvertTo-Json -Compress"];
  const { stdout } = await execFileAsync("powershell.exe", command, { windowsHide: true });
  if (!stdout.trim()) { return []; }
  const parsed = JSON.parse(stdout);
  return (Array.isArray(parsed) ? parsed : [parsed]).map((p) => ({ name: p.Name, isDefault: Boolean(p.Default), isVirtual: isVirtualPrinterName(p.Name) }));
}

async function getCupsPrinters() {
  try {
    const [{ stdout: printerOutput }, defaultResult] = await Promise.all([
      execFileAsync("lpstat", ["-p"], { timeout: 10_000 }),
      execFileAsync("lpstat", ["-d"], { timeout: 10_000 }).catch(() => ({ stdout: "" }))
    ]);
    const defaultPrinter = defaultResult.stdout.match(/:\s*(.+)\s*$/)?.[1]?.trim() ?? "";
    return printerOutput.split(/\r?\n/).map((line) => line.match(/^printer\s+(\S+)/)?.[1]).filter(Boolean)
      .map((name) => ({ name, isDefault: name === defaultPrinter, isVirtual: isVirtualPrinterName(name) }));
  } catch { return []; }
}

async function resolvePrinterName(requestedPrinterName = "") {
  const printers = await getSystemPrinters();
  const settings = await getSettings();
  const configuredPrinter = String(requestedPrinterName || settings.selectedPrinter || "").trim();
  if (configuredPrinter) {
    const configuredPrinterInfo = printers.find((p) => p.name === configuredPrinter);
    if (printers.length && !configuredPrinterInfo) {
      throw new Error(`\u672A\u627E\u5230\u6253\u5370\u673A\uFF1A${configuredPrinter}`);
    }
    if (configuredPrinterInfo?.isVirtual || isVirtualPrinterName(configuredPrinter)) {
      throw new Error(`\u6253\u5370\u673A\u662F\u865A\u62DF\u8BBE\u5907\uFF0C\u4E0D\u4F1A\u51FA\u7EB8\uFF1A${configuredPrinter}\u3002\u8BF7\u5230\u540E\u53F0\u9009\u62E9\u5B9E\u4F53\u6253\u5370\u673A`);
    }
    return configuredPrinter;
  }
  const defaultPrinter = printers.find((p) => p.isDefault);
  if (defaultPrinter && !defaultPrinter.isVirtual) { return defaultPrinter.name; }
  const physicalPrinter = printers.find((p) => !p.isVirtual);
  if (physicalPrinter) { return physicalPrinter.name; }
  if (defaultPrinter?.isVirtual) {
    throw new Error(`\u7CFB\u7EDF\u9ED8\u8BA4\u6253\u5370\u673A\u662F\u865A\u62DF\u6253\u5370\u673A\uFF1A${defaultPrinter.name}\u3002\u8BF7\u5230\u540E\u53F0\u914D\u7F6E\u5B9E\u4F53\u6253\u5370\u673A`);
  }
  throw new Error("\u672A\u8BFB\u53D6\u5230\u53EF\u7528\u5B9E\u4F53\u6253\u5370\u673A\uFF0C\u8BF7\u5230\u540E\u53F0\u5237\u65B0\u5E76\u914D\u7F6E\u6253\u5370\u673A");
}

async function printTicketDirectWindows(order, requestedPrinterName = "") {
  const settings = await getSettings();
  const printLayout = settings.ticketPrintLayout;
  const printerName = await resolvePrinterName(requestedPrinterName);
  const paperWidth = mmToHundredthsInch(printLayout.widthMm);
  const paperHeight = mmToHundredthsInch(printLayout.heightMm);
  const topY = Math.max(0, printLayout.paddingTopMm + printLayout.topOffsetMm);
  const paperName = `LuggageTag${String(printLayout.widthMm).replace(/\D/g, "")}x${String(printLayout.heightMm).replace(/\D/g, "")}`;
  const contentAlign = printLayout.contentAlign ?? "center";
  const contentInsetMm = printLayout.widthMm * 0.03;
  const textRectX = contentAlign === "center" ? 0 : contentInsetMm;
  const textRectWidth = contentAlign === "center" ? printLayout.widthMm : printLayout.widthMm - contentInsetMm * 2;
  const gdiAlignment = contentAlign === "left" ? "Near" : contentAlign === "right" ? "Far" : "Center";
  const footerFontSizePt = Math.max(2, Math.min(20, Number(printLayout.footerFontSizePt) || 6));
  const footerOpacity = Math.max(0, Math.min(100, Number(printLayout.footerOpacity) || 0));
  const footerBottomMm = Math.max(0, Math.min(30, Number(printLayout.footerBottomMm) || 0));
  const footerAlpha = Math.round(footerOpacity * 255 / 100);
  const script = `
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$printerName = $env:LUGGAGE_TAG_PRINT_PRINTER
$orderNo = $env:LUGGAGE_TAG_PRINT_ORDER_NO
$customerText = $env:LUGGAGE_TAG_PRINT_CUSTOMER_TEXT
$generatedAt = $env:LUGGAGE_TAG_PRINT_GENERATED_AT
$footerText = $env:LUGGAGE_TAG_PRINT_FOOTER_TEXT
Add-Type -AssemblyName System.Drawing
$document = New-Object System.Drawing.Printing.PrintDocument
$document.DocumentName = "Luggage Tag Ticket " + $orderNo
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
if (-not [string]::IsNullOrWhiteSpace($printerName)) {
  $document.PrinterSettings.PrinterName = $printerName
}
if (-not $document.PrinterSettings.IsValid) {
  throw ("\u6253\u5370\u673A\u4E0D\u53EF\u7528\uFF1A" + $document.PrinterSettings.PrinterName)
}
$document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("${paperName}", ${paperWidth}, ${paperHeight})
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$document.OriginAtMargins = $false
$document.add_PrintPage({
  param($sender, $event)
  $graphics = $event.Graphics
  $graphics.PageUnit = [System.Drawing.GraphicsUnit]::Millimeter
  $graphics.Clear([System.Drawing.Color]::White)
  $centerFormat = New-Object System.Drawing.StringFormat
  $centerFormat.Alignment = [System.Drawing.StringAlignment]::${gdiAlignment}
  $centerFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
  $textRectX = ${textRectX}
  $textRectWidthMm = ${textRectWidth}
  $topY = ${topY}
  $nameFontSize = ${printLayout.nameFontSize}
  $serialFontSize = ${printLayout.serialFontSize}
  $timeFontSize = ${printLayout.timeFontSize}
  $nameHeight = $nameFontSize * 25.4 / 72
  $serialHeight = $serialFontSize * 25.4 / 72
  $timeHeight = $timeFontSize * 25.4 / 72
  $footerFontSize = ${footerFontSizePt}
  $footerHeight = $footerFontSize * 25.4 / 72
  $footerAlpha = ${footerAlpha}
  $footerBottomMm = ${footerBottomMm}
  $paperHeightMm = ${printLayout.heightMm}
  $nameFont = New-Object System.Drawing.Font("Arial", $nameFontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Point)
  $noFont = New-Object System.Drawing.Font("Arial", $serialFontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $timeFont = New-Object System.Drawing.Font("Arial", $timeFontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $footerFont = New-Object System.Drawing.Font("Arial", $footerFontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
  $footerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($footerAlpha, 0, 0, 0))
  try {
    $graphics.DrawString($customerText, $nameFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF($textRectX, $topY, $textRectWidthMm, ($nameHeight + 1))), $centerFormat)
    $graphics.DrawString($orderNo, $noFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF($textRectX, ($topY + $nameHeight + ${printLayout.nameMarginBottomMm}), $textRectWidthMm, ($serialHeight + 1))), $centerFormat)
    $graphics.DrawString($generatedAt, $timeFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF($textRectX, ($topY + $nameHeight + ${printLayout.nameMarginBottomMm} + $serialHeight + ${printLayout.serialMarginBottomMm}), $textRectWidthMm, ($timeHeight + 1))), $centerFormat)
    if (-not [string]::IsNullOrWhiteSpace($footerText) -and $footerAlpha -gt 0) {
      $footerY = [Math]::Max(0, $paperHeightMm - $footerBottomMm - $footerHeight)
      $graphics.DrawString($footerText, $footerFont, $footerBrush, (New-Object System.Drawing.RectangleF($textRectX, $footerY, $textRectWidthMm, ($footerHeight + 1))), $centerFormat)
    }
  } finally {
    $nameFont.Dispose()
    $noFont.Dispose()
    $timeFont.Dispose()
    $footerFont.Dispose()
    $footerBrush.Dispose()
    $centerFormat.Dispose()
  }
  $event.HasMorePages = $false
})
try {
  $document.Print()
  Write-Output ("PRINTER_NAME=" + $document.PrinterSettings.PrinterName)
} finally {
  $document.Dispose()
}
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    env: {
      ...process.env,
      LUGGAGE_TAG_PRINT_PRINTER: printerName,
      LUGGAGE_TAG_PRINT_ORDER_NO: order.order_no,
      LUGGAGE_TAG_PRINT_CUSTOMER_TEXT: order.customer_text,
      LUGGAGE_TAG_PRINT_GENERATED_AT: formatTicketDateTime(order.generated_at),
      LUGGAGE_TAG_PRINT_FOOTER_TEXT: String(printLayout.footerText ?? "").trim()
    },
    timeout: 60_000,
    windowsHide: true
  });
  const printedPrinterName = stdout.match(/PRINTER_NAME=(.+)/)?.[1]?.trim();
  return { printerName: printedPrinterName || printerName || "\u9ED8\u8BA4\u6253\u5370\u673A" };
}

async function findPrintCommand() {
  for (const command of ["lp", "lpr"]) {
    try { await execFileAsync("sh", ["-c", `command -v ${command}`], { timeout: 5_000 }); return command; } catch { /* continue */ }
  }
  return "";
}

async function printTicketDirectCups(order, requestedPrinterName = "") {
  const printCommand = await findPrintCommand();
  if (!printCommand) {
    throw new Error("\u670D\u52A1\u5668\u672A\u914D\u7F6E\u672C\u5730\u6253\u5370\u670D\u52A1\uFF1A\u5F53\u524D\u7CFB\u7EDF\u672A\u627E\u5230 lp/lpr\u3002\u8BF7\u5728\u670D\u52A1\u5668\u914D\u7F6E CUPS/\u7F51\u7EDC\u6253\u5370\u673A\uFF0C\u6216\u628A\u670D\u52A1\u90E8\u7F72\u5230\u8FDE\u63A5\u6253\u5370\u673A\u7684 Windows \u4E3B\u673A");
  }
  const printerName = await resolvePrinterName(requestedPrinterName);
  const settings = await getSettings();
  const pdfPath = path.join(exportDir, `test-ticket-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.pdf`);
  await createTicketPdf(order, pdfPath, settings.ticketPrintLayout);
  try {
    const args = printCommand === "lp"
      ? [...(printerName ? ["-d", printerName] : []), pdfPath]
      : [...(printerName ? ["-P", printerName] : []), pdfPath];
    await execFileAsync(printCommand, args, { timeout: 30_000 });
    return { printerName: printerName || "\u9ED8\u8BA4\u6253\u5370\u673A" };
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

async function printTicketDirect(order, requestedPrinterName = "") {
  if (process.platform === "win32") { return printTicketDirectWindows(order, requestedPrinterName); }
  return printTicketDirectCups(order, requestedPrinterName);
}

async function printOrderTicket(order, requestedPrinterName = "") {
  return printTicketDirect(order, requestedPrinterName);
}

export { getSystemPrinters, printTicketDirect, printOrderTicket };
