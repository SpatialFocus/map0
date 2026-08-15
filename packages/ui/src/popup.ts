import DOMPurify from "dompurify";
import {
  renderAllProps,
  renderFields,
  renderTemplate,
  escapeHtml,
  type FeatureInfoResult,
  type Translate,
} from "@map0/core";
import type { PopupConfig } from "@map0/schema";

function renderFeature(popup: PopupConfig | undefined, props: Record<string, unknown>): string {
  const title = popup?.title ? `<h4>${renderTemplate(popup.title, props)}</h4>` : "";
  let body: string;
  if (popup?.content) {
    body = renderTemplate(popup.content, props);
  } else if (popup?.fields?.length) {
    body = renderFields(popup.fields, props);
  } else {
    body = renderAllProps(props);
  }
  return `<div class="m0-feature">${title}${body}</div>`;
}

function renderResult(result: FeatureInfoResult, t: Translate): string {
  const popup = result.popup === false ? undefined : result.popup;
  const layerTitle = `<p class="m0-layer-title">${escapeHtml(result.layerTitle)}</p>`;
  if (result.html !== undefined) {
    return `<section>${layerTitle}${result.html}</section>`;
  }
  /* multi-hit (F5.3): first feature expanded, the rest collapsed behind <details> */
  const [first, ...rest] = result.features;
  let features = first ? renderFeature(popup, first) : "";
  if (rest.length > 0) {
    const label = `${rest.length} ${escapeHtml(t("popup.more"))}`;
    features += `<details><summary>${label}</summary>${rest
      .map((f) => renderFeature(popup, f))
      .join("")}</details>`;
  }
  return `<section>${layerTitle}${features}</section>`;
}

/** Sanitize author- or service-provided HTML before it reaches the DOM (N6). */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

/**
 * Render feature-info results into a sanitized DOM node for the MapLibre popup.
 * Everything passes DOMPurify — templates come from CMS configs, HTML may come
 * from third-party WMS GetFeatureInfo responses (N6 in docs/03-requirements.md).
 */
export function buildPopupContent(results: FeatureInfoResult[], t: Translate): HTMLElement {
  const html = results.map((r) => renderResult(r, t)).join("");
  const container = document.createElement("div");
  container.className = "m0-popup";
  container.innerHTML = DOMPurify.sanitize(html);
  for (const a of container.querySelectorAll("a")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  return container;
}
