/**
 * Client-side print/export (F7, D-04): render a hidden clone of the map at the
 * target size & DPI, then compose a layout (title, scale bar, legend,
 * attribution, date) onto one canvas. "Export what you see" — not survey-grade.
 * A server-side, scale-true PrintProvider can replace this in M2+ without UI changes.
 */
import { Map as MaplibreMap } from "maplibre-gl";
import type { Map as MapLibreMapType } from "maplibre-gl";
import type { LegendSpec } from "./adapters/types.js";

export interface PrintLegendItem {
  title: string;
  legend: LegendSpec;
}

export interface PrintRenderOptions {
  /** output map size in CSS px */
  width: number;
  height: number;
  /** rendering resolution; pixelRatio = dpi / 96 */
  dpi: number;
}

/** which parts of the sheet get drawn (config: `print.elements`) */
export type PrintElement = "title" | "legend" | "scalebar" | "attribution" | "date";

export interface PrintComposeOptions {
  title?: string;
  attribution: string;
  scale: { widthPx: number; label: string };
  dpi: number;
  dateLabel: string;
  legendItems: PrintLegendItem[];
  /** defaults to all of them */
  elements?: PrintElement[];
}

/** Paper sizes in millimetres, the source of truth for both the render and the PDF page. */
export const PAPER = {
  "A4-landscape": [297, 210],
  "A4-portrait": [210, 297],
  "A3-landscape": [420, 297],
  "A3-portrait": [297, 420],
} as const satisfies Record<string, readonly [number, number]>;

export type PaperSize = keyof typeof PAPER | "current";

/** Millimetres → pixels at a given resolution. */
export const mmToPx = (mm: number, dpi = 96): number => Math.round((mm / 25.4) * dpi);

/**
 * Place an image on a page, preserving its aspect ratio and centring it inside
 * the margins. The composed sheet is taller than the map alone (title, legend,
 * footer), so it rarely matches the paper aspect exactly — fitting is what keeps
 * an "A4" export an actual A4 page rather than something A4-shaped.
 */
export function fitOnPage(
  image: { width: number; height: number },
  page: { width: number; height: number },
  margin = 10,
): { x: number; y: number; width: number; height: number } {
  const available = { width: page.width - 2 * margin, height: page.height - 2 * margin };
  const scale = Math.min(available.width / image.width, available.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    x: margin + (available.width - width) / 2,
    y: margin + (available.height - height) / 2,
    width,
    height,
  };
}

/** plain-text attribution collected from all style sources (HTML stripped) */
export function collectAttributions(map: MapLibreMapType): string {
  const parts = new Set<string>();
  const sources = map.getStyle()?.sources ?? {};
  for (const source of Object.values(sources)) {
    const attribution = (source as { attribution?: string }).attribution;
    if (!attribution) continue;
    const div = document.createElement("div");
    div.innerHTML = attribution;
    const text = (div.textContent ?? "").trim();
    if (text) parts.add(text);
  }
  return [...parts].join(" · ");
}

/** a nice round scale bar (1/2/5 · 10^n) for the map's current center/zoom */
export function computeScaleBar(
  map: MapLibreMapType,
  maxWidthPx = 220,
): { widthPx: number; label: string } {
  const lat = (map.getCenter().lat * Math.PI) / 180;
  const metersPerPx = (40075016.686 * Math.cos(lat)) / (512 * 2 ** map.getZoom());
  const maxMeters = metersPerPx * maxWidthPx;
  const pow = 10 ** Math.floor(Math.log10(maxMeters));
  const candidates = [5 * pow, 2 * pow, pow];
  const meters = candidates.find((c) => c <= maxMeters) ?? pow;
  const label = meters >= 1000 ? `${meters / 1000} km` : `${Math.round(meters)} m`;
  return { widthPx: meters / metersPerPx, label };
}

/** Render a hidden clone of the map (same style incl. overlays) at size × dpi. */
export async function renderMapImage(
  map: MapLibreMapType,
  opts: PrintRenderOptions,
): Promise<HTMLCanvasElement> {
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-100000px;top:0;width:${opts.width}px;height:${opts.height}px;`;
  document.body.appendChild(container);
  const clone = new MaplibreMap({
    container,
    style: map.getStyle() as never, // includes overlays + projection (transformStyle architecture)
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    pixelRatio: opts.dpi / 96,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  } as never);

  try {
    await new Promise<void>((resolve) => {
      const done = (): void => resolve();
      clone.once("idle", done);
      setTimeout(done, 30_000); // export what has loaded by then
    });
    const src = clone.getCanvas();
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    out.getContext("2d")!.drawImage(src, 0, 0);
    return out;
  } finally {
    clone.remove();
    container.remove();
  }
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // canvas export needs CORS-clean pixels
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Wrap a composed sheet in a PDF. jsPDF is loaded here, on the click that asks
 * for a PDF — it is the heaviest thing in the client and most maps never need it.
 *
 * The image goes in as PNG: it is a map, so it is full of fine lines and text
 * where JPEG artefacts show immediately, and the file is meant to be printed.
 */
export async function exportPdf(
  sheet: HTMLCanvasElement,
  opts: { paper: PaperSize; dpi: number; title?: string },
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const paperMm =
    opts.paper === "current"
      ? ([(sheet.width / opts.dpi) * 25.4, (sheet.height / opts.dpi) * 25.4] as [number, number])
      : ([...PAPER[opts.paper]] as [number, number]);

  const doc = new jsPDF({
    unit: "mm",
    format: paperMm,
    orientation: paperMm[0] >= paperMm[1] ? "landscape" : "portrait",
    compress: true,
  });
  /* the current view exports at its own size, so it needs no margin */
  const margin = opts.paper === "current" ? 0 : 10;
  const box = fitOnPage(sheet, { width: paperMm[0], height: paperMm[1] }, margin);
  doc.addImage(sheet.toDataURL("image/png"), "PNG", box.x, box.y, box.width, box.height);
  if (opts.title) doc.setProperties({ title: opts.title });
  return doc.output("blob");
}

/** Compose the final layout. All measurements scale with dpi so print sizes hold. */
export async function composePrint(
  mapCanvas: HTMLCanvasElement,
  opts: PrintComposeOptions,
): Promise<HTMLCanvasElement> {
  const s = opts.dpi / 96; // ui scale factor
  const pad = 16 * s;
  const font = (px: number, weight = 400): string =>
    `${weight} ${px * s}px system-ui, 'Segoe UI', Roboto, sans-serif`;
  const wants = (element: PrintElement): boolean =>
    opts.elements === undefined || opts.elements.includes(element);

  /* pre-load legend images */
  const legendBlocks: Array<
    { title: string } & (
      | { image: HTMLImageElement }
      | { entries: Array<{ label?: string; color?: string; shape: string }> }
    )
  > = [];
  for (const item of wants("legend") ? opts.legendItems : []) {
    if (item.legend.kind === "image") {
      const img = await loadImage(item.legend.url);
      if (img) legendBlocks.push({ title: item.title, image: img });
    } else {
      legendBlocks.push({ title: item.title, entries: item.legend.entries });
    }
  }

  /* measure heights */
  const title = wants("title") ? opts.title : undefined;
  const titleH = title ? 34 * s : 0;
  const showScale = wants("scalebar");
  const showFooterText = wants("attribution") || wants("date");
  const footerH = showScale || showFooterText ? 30 * s : 0;
  let legendH = 0;
  if (legendBlocks.length > 0) {
    legendH = pad / 2;
    for (const block of legendBlocks) {
      legendH += 18 * s;
      legendH += "image" in block ? Math.min(block.image.height * s, 160 * s) + 6 * s : block.entries.length * 18 * s + 4 * s;
    }
  }

  const width = mapCanvas.width;
  const height = titleH + mapCanvas.height + legendH + footerH;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  /* title */
  if (title) {
    ctx.fillStyle = "#111827";
    ctx.font = font(16, 700);
    ctx.textBaseline = "middle";
    ctx.fillText(title, pad, titleH / 2);
  }

  /* map */
  ctx.drawImage(mapCanvas, 0, titleH);
  ctx.strokeStyle = "rgba(0,0,0,.25)";
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0.5, titleH + 0.5, width - 1, mapCanvas.height - 1);

  /* legend */
  let y = titleH + mapCanvas.height + (legendBlocks.length > 0 ? pad / 2 : 0);
  for (const block of legendBlocks) {
    ctx.fillStyle = "#6b7280";
    ctx.font = font(10, 600);
    ctx.textBaseline = "top";
    ctx.fillText(block.title.toUpperCase(), pad, y + 4 * s);
    y += 18 * s;
    if ("image" in block) {
      const h = Math.min(block.image.height * s, 160 * s);
      const w = (block.image.width / block.image.height) * h;
      try {
        ctx.drawImage(block.image, pad, y, w, h);
      } catch {
        /* tainted canvas safety net — skip image */
      }
      y += h + 6 * s;
    } else {
      ctx.font = font(11);
      for (const entry of block.entries) {
        const cy = y + 8 * s;
        ctx.fillStyle = entry.color ?? "#9ca3af";
        if (entry.shape === "line") {
          ctx.fillRect(pad, cy - 1.5 * s, 16 * s, 3 * s);
        } else if (entry.shape === "circle") {
          ctx.beginPath();
          ctx.arc(pad + 8 * s, cy, 6 * s, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(pad, cy - 7 * s, 14 * s, 14 * s);
        }
        if (entry.label) {
          ctx.fillStyle = "#111827";
          ctx.textBaseline = "middle";
          ctx.fillText(entry.label, pad + 24 * s, cy);
        }
        y += 18 * s;
      }
      y += 4 * s;
    }
  }

  /* footer: scale bar left, attribution + date right */
  const fy = height - footerH / 2;
  if (showScale) {
    const scaleW = opts.scale.widthPx * s;
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(pad, fy + 4 * s);
    ctx.lineTo(pad, fy + 8 * s);
    ctx.lineTo(pad + scaleW, fy + 8 * s);
    ctx.lineTo(pad + scaleW, fy + 4 * s);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.font = font(10);
    ctx.textBaseline = "bottom";
    ctx.fillText(opts.scale.label, pad + 4 * s, fy + 2 * s);
  }

  if (showFooterText) {
    ctx.fillStyle = "#6b7280";
    ctx.font = font(10);
    ctx.textBaseline = "bottom";
    ctx.textAlign = "right";
    const footerText = [wants("attribution") ? opts.attribution : "", wants("date") ? opts.dateLabel : ""]
      .filter(Boolean)
      .join("  ·  ");
    ctx.fillText(footerText, width - pad, fy + 6 * s);
    ctx.textAlign = "left";
  }

  return out;
}
