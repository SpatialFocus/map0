/**
 * {{property}} template rendering for popups.
 * Deliberately a closed mini-language (no logic, no eval — see N6 in docs/03-requirements.md).
 * Property VALUES are always HTML-escaped here; the surrounding template HTML is
 * author-controlled and additionally sanitized by the UI layer before rendering.
 */
import type { FieldDef } from "@map0/schema";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const PLACEHOLDER = /\{\{\s*([\w.:-]+)\s*\}\}/g;

/** Replace {{key}} placeholders with escaped property values. Missing keys → empty string. */
export function renderTemplate(template: string, props: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_, key: string) => escapeHtml(props[key]));
}

/** Render a fields list as table rows (used when a popup config has `fields`). */
export function renderFields(fields: FieldDef[], props: Record<string, unknown>): string {
  const rows = fields
    .map((f) => {
      const label = escapeHtml(f.label ?? f.key);
      const value = escapeHtml(props[f.key]);
      return `<tr><th scope="row">${label}</th><td>${value}</td></tr>`;
    })
    .join("");
  return `<table class="m0-fields">${rows}</table>`;
}

/** Fallback rendering when a popup has neither content nor fields: all properties. */
export function renderAllProps(props: Record<string, unknown>, maxRows = 12): string {
  const entries = Object.entries(props).slice(0, maxRows);
  const rows = entries
    .map(([k, v]) => `<tr><th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const more = Object.keys(props).length > maxRows ? `<div class="m0-more">…</div>` : "";
  return `<table class="m0-fields">${rows}</table>${more}`;
}
