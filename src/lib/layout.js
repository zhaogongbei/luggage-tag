import { templateImageCache, paperPresets } from "./constants";
import { normalizeCustomerName } from "./validate";
import { formatDateTime } from "./format";

export function chunkOrders(orders, capacity) {
  const pages = [];
  for (let index = 0; index < orders.length; index += capacity) {
    pages.push(orders.slice(index, index + capacity));
  }
  return pages;
}

export function normalizeLayoutOptions(options) {
  const presetSize = paperPresets[options.paperPreset] ?? paperPresets.A4;
  return {
    ...options,
    paperWidth: options.paperPreset === "CUSTOM" ? Number(options.paperWidth) : presetSize.width,
    paperHeight: options.paperPreset === "CUSTOM" ? Number(options.paperHeight) : presetSize.height,
    productWidth: Number(options.productWidth),
    productHeight: Number(options.productHeight),
    margin: Number(options.margin),
    gap: Number(options.gap)
  };
}

export function drawCenteredText(ctx, text, x, y, font, color) {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
}

export function drawTag(canvas, { template, customerText, orderNo, watermarkEnabled, timestamp, image, showMeta = true }) {
  const ctx = canvas.getContext("2d");
  const width = image?.naturalWidth || 900;
  const height = image?.naturalHeight || 560;
  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);
  if (image) {
    ctx.drawImage(image, 0, 0, width, height);
  } else {
    ctx.fillStyle = template.color;
    ctx.fillRect(0, 0, width, height);
  }

  const name = normalizeCustomerName(customerText) || "MARISSA";
  const centerX = width / 2;
  const ink = template.textColor;
  if (showMeta) {
    drawCenteredText(ctx, orderNo, centerX, height * 0.62, "600 14pt Montserrat, Helvetica, Arial, sans-serif", ink);
  }
  drawCenteredText(ctx, name, centerX, showMeta ? height * 0.69 : height * 0.69, "700 28pt Helvetica, Arial, sans-serif", ink);

  if (showMeta && watermarkEnabled) {
    drawCenteredText(ctx, formatDateTime(timestamp), centerX, height * 0.76, "500 10pt Helvetica, Arial, sans-serif", ink);
  }
}

export function getTemplateImage(template) {
  const cachedImage = templateImageCache.get(template.preview);
  if (cachedImage) {
    return cachedImage;
  }
  const image = new Image();
  image.src = template.preview;
  templateImageCache.set(template.preview, image);
  return image;
}
