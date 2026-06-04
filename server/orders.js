import fs from "node:fs/promises";
import crypto from "node:crypto";
import { db } from "./db.js";
import {
  templateIds, getExportRelativePath, resolveStoredFilePath
} from "./config.js";
import { getActiveEvent, formatEventOrderNo, syncLegacyNumberSettings } from "./db.js";
import { getRequestUser, writeAuditLog } from "./auth.js";
import { createTicketPdf } from "./pdf.js";

function imageDataToBuffer(dataUrl) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) { throw new Error("Invalid PNG data URL"); }
  const buf = Buffer.from(match[1], "base64");
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) { throw new Error("Not a valid PNG"); }
  if (buf.length > 6 * 1024 * 1024) { throw new Error("PNG too large"); }
  return buf;
}

function normalizeCustomerName(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z ]/g, "").replace(/^ +/g, "").replace(/ {2,}/g, " ").slice(0, 12).trim();
}

function isValidCustomerName(value) { return /^[A-Z]+(?: [A-Z]+)*$/.test(value) && value.length <= 12; }
function isValidRawCustomerName(value) { return /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(value ?? "").trim()) && String(value ?? "").trim().length <= 12; }

async function createOrderFromPayload(req) {
  const templateId = String(req.body.templateId ?? "");
  const rawCustomerText = String(req.body.customerText ?? "");
  const customerText = normalizeCustomerName(rawCustomerText);
  const pngDataUrl = String(req.body.pngDataUrl ?? "");

  if (!templateIds.includes(templateId)) {
    const error = new Error("Invalid template"); error.statusCode = 400; throw error;
  }
  if (!isValidRawCustomerName(rawCustomerText) || !isValidCustomerName(customerText)) {
    const error = new Error("Customer name must contain 1-12 English letters only"); error.statusCode = 400; throw error;
  }

  let created;
  try {
    const generatedAt = new Date().toISOString();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    const activeEvent = getActiveEvent();
    const orderNo = formatEventOrderNo(activeEvent);
    const safeName = `${orderNo}-${generatedAt}-${crypto.randomBytes(4).toString("hex")}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const pngPath = getExportRelativePath(`${safeName}.png`);
    const pdfPath = getExportRelativePath(`${safeName}.pdf`);

    const result = db.prepare(
      `INSERT INTO orders (event_id, order_no, template_id, customer_text, generated_at, print_status, png_path, pdf_path, created_by) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
    ).run(activeEvent.id, orderNo, templateId, customerText, generatedAt, pngPath, pdfPath, getRequestUser(req)?.id ?? null);
    const nextNumber = Number(activeEvent.current_number) + 1;
    db.prepare("UPDATE events SET current_number = ? WHERE id = ?").run(nextNumber, activeEvent.id);
    syncLegacyNumberSettings({ ...activeEvent, current_number: nextNumber });
    db.exec("COMMIT");
    created = { id: result.lastInsertRowid, orderNo, generatedAt, pngPath, pdfPath, customerText, templateId };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    throw error;
  }

  try {
    await fs.writeFile(resolveStoredFilePath(created.pngPath), imageDataToBuffer(pngDataUrl));
    await createTicketPdf(
      { order_no: created.orderNo, customer_text: customerText, generated_at: created.generatedAt },
      resolveStoredFilePath(created.pdfPath)
    );
  } catch (error) {
    db.prepare("DELETE FROM orders WHERE id = ?").run(created.id);
    await Promise.allSettled([
      fs.unlink(resolveStoredFilePath(created.pngPath)),
      fs.unlink(resolveStoredFilePath(created.pdfPath))
    ]);
    throw error;
  }
  writeAuditLog(req, "orders.create", "order", created.id, { orderNo: created.orderNo, customerText, templateId });
  return created;
}

export { imageDataToBuffer, normalizeCustomerName, isValidCustomerName, isValidRawCustomerName, createOrderFromPayload };
