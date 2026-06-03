import { useEffect } from "react";
import { getTemplateImage, drawTag } from "../lib/layout";

export function CanvasPreview({ template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef, showMeta = true }) {
  useEffect(() => {
    let cancelled = false;
    const image = getTemplateImage(template);
    function redraw() {
      if (!cancelled && canvasRef.current) {
        drawTag(canvasRef.current, { template, customerText, orderNo, watermarkEnabled, timestamp, image, showMeta });
      }
    }
    if (image.complete && image.naturalWidth) {
      redraw();
    } else {
      image.addEventListener("load", redraw, { once: true });
    }
    return () => {
      cancelled = true;
      image.removeEventListener("load", redraw);
    };
  }, [template, customerText, orderNo, watermarkEnabled, timestamp, canvasRef, showMeta]);

  return <canvas className="tag-canvas" ref={canvasRef} />;
}
