import { LitElement, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import DOMPurify from "dompurify";
import { Popup } from "maplibre-gl";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?inline";
import {
  createCore,
  normalizeConfig,
  validateConfig,
  type FeatureInfoResult,
  type LayerUIState,
  type Map0Config,
  type Map0Core,
  type NormalizedConfig,
  type ValidationError,
} from "@map0/core";
import type { TocNode } from "@map0/schema";
import { buildPopupContent } from "./popup.js";
import { componentStyles } from "./styles.js";
import "./add-layer-dialog.js";
import "./print-dialog.js";

const CONTROL_SVGS = {
  print:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
  share:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-3.9M8.6 13.5l6.8 3.9"/></svg>',
} as const;

class IconButtonControl {
  private container?: HTMLElement;
  constructor(
    private readonly icon: keyof typeof CONTROL_SVGS,
    private readonly onClick: () => void,
    private readonly label: string,
  ) {}
  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = this.label;
    btn.setAttribute("aria-label", this.label);
    btn.innerHTML = CONTROL_SVGS[this.icon];
    btn.addEventListener("click", this.onClick);
    div.appendChild(btn);
    this.container = div;
    return div;
  }
  onRemove(): void {
    this.container?.remove();
  }
}

const RADII = { none: "0px", sm: "6px", md: "10px", lg: "16px" } as const;
const RADII_SM = { none: "0px", sm: "4px", md: "7px", lg: "10px" } as const;

const icons = {
  layers: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`,
  chevron: html`<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  info: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>`,
  legend: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="6" height="6" rx="1"/><path d="M13 7h8"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 17h8"/></svg>`,
  plus: html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>`,
};

/**
 * `<map0-viewer>` — the map0 web component.
 *
 * Config sources (first match wins):
 *  1. `config` property (JS object)
 *  2. `config-src` attribute (URL)
 *  3. inline `<script type="application/json">` child
 */
export class Map0Viewer extends LitElement {
  static override styles = [unsafeCSS(maplibreCss), componentStyles];

  @property({ attribute: false }) config?: Map0Config;
  @property({ attribute: "config-src" }) configSrc?: string;

  @state() private _errors: ValidationError[] | null = null;
  @state() private _fatal: string | null = null;
  @state() private _layers: LayerUIState[] = [];
  @state() private _basemapId = "";
  @state() private _tocOpen = true;
  @state() private _legendOpen = false;
  @state() private _addOpen = false;
  @state() private _printOpen = false;
  @state() private _groupCollapsed: Record<string, boolean> = {};
  @state() private _ready = false;
  @state() private _notices: Array<{ id: number; kind: "error" | "info"; text: string }> = [];
  @state() private _hover: { x: number; y: number; html: string } | null = null;

  private noticeSeq = 0;
  private statusSeen = new Map<string, string>();

  @query(".map") private mapEl?: HTMLDivElement;

  private core?: Map0Core;
  private normalized?: NormalizedConfig;
  private popup?: Popup;
  private unsubs: Array<() => void> = [];
  private initialized = false;

  /** imperative access to the running map (available after `map0:ready`) */
  get api(): Map0Core | undefined {
    return this.core;
  }

  protected override firstUpdated(): void {
    this.initialized = true;
    void this.init();
  }

  protected override updated(changed: PropertyValues): void {
    if (
      this.initialized &&
      this.core &&
      (changed.has("config") || changed.has("configSrc")) &&
      (changed.get("config") !== undefined || changed.get("configSrc") !== undefined)
    ) {
      this.reload();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown();
  }

  /** tear down and re-init (e.g. after assigning a new config) */
  reload(): void {
    this.teardown();
    this._errors = null;
    this._fatal = null;
    this._layers = [];
    this._ready = false;
    void this.updateComplete.then(() => void this.init());
  }

  private teardown(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.statusSeen.clear();
    this._notices = [];
    this.popup?.remove();
    this.popup = undefined;
    this.core?.destroy();
    this.core = undefined;
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** transient notice toast (auto-dismisses; also used by copy/share actions) */
  notify(kind: "error" | "info", text: string): void {
    const id = ++this.noticeSeq;
    this._notices = [...this._notices, { id, kind, text }];
    setTimeout(() => {
      this._notices = this._notices.filter((n) => n.id !== id);
    }, 6000);
  }

  private async loadRawConfig(): Promise<unknown> {
    if (this.config) return this.config;
    if (this.configSrc) {
      const res = await fetch(this.configSrc);
      if (!res.ok) throw new Error(`could not fetch config: HTTP ${res.status} (${this.configSrc})`);
      return res.json();
    }
    const inline = this.querySelector('script[type="application/json"]');
    if (inline?.textContent?.trim()) {
      try {
        return JSON.parse(inline.textContent);
      } catch (e) {
        throw new Error(`inline config is not valid JSON: ${e instanceof Error ? e.message : e}`);
      }
    }
    throw new Error(
      'no config found — set the "config" property, a "config-src" attribute, or an inline <script type="application/json"> child',
    );
  }

  private async init(): Promise<void> {
    try {
      const raw = await this.loadRawConfig();
      const result = validateConfig(raw);
      if (!result.valid) {
        this._errors = result.errors;
        this.emit("map0:error", { errors: result.errors });
        return;
      }
      const cfg = normalizeConfig(result.config!);
      this.normalized = cfg;
      this.applyTheme(cfg);

      const ls = cfg.controls.layerSwitcher;
      this._tocOpen =
        ls === false ? false : ls.open === "auto" ? this.getBoundingClientRect().width >= 560 : ls.open;
      this._legendOpen = cfg.controls.legend === false ? false : cfg.controls.legend.open;

      await this.updateComplete;
      if (!this.mapEl) throw new Error("internal: map container missing");

      const core = await createCore({ container: this.mapEl, config: cfg, fullscreenTarget: this });
      this.core = core;
      this._basemapId = core.basemaps.current.value;
      this.unsubs.push(
        core.layers.state.subscribe(
          (v) => {
            this._layers = v;
            /* one toast per layer entering the error state (F2.5 feedback) */
            for (const l of v) {
              if (l.status === "error" && this.statusSeen.get(l.id) !== "error") {
                this.notify("error", `${l.title}: ${core.t("layers.error")}`);
              }
              this.statusSeen.set(l.id, l.status);
            }
          },
          { immediate: true },
        ),
        core.basemaps.current.subscribe((v) => (this._basemapId = v)),
        core.events.on("ready", () => {
          this.emit("map0:ready", { api: core });
        }),
        core.events.on("featureclick", (e) => this.showPopup(e)),
        core.events.on("featurehover", (e) => {
          this._hover = e
            ? { x: e.point[0], y: e.point[1], html: DOMPurify.sanitize(e.html) }
            : null;
        }),
        core.events.on("coordinates", (e) => this.showCoordinates(e)),
        core.events.on("error", (e) => this.emit("map0:error", e)),
      );
      if (cfg.controls.print) {
        core.map.addControl(
          new IconButtonControl("print", () => (this._printOpen = true), core.t("print.title")),
          "top-left",
        );
      }
      if (cfg.permalink !== false) {
        core.map.addControl(
          new IconButtonControl(
            "share",
            () => {
              const url = core.getShareUrl();
              if (!url) return;
              void navigator.clipboard
                .writeText(url)
                .then(() => this.notify("info", core.t("share.copied")))
                .catch(() => this.notify("error", core.t("coords.copyFailed")));
            },
            core.t("share.title"),
          ),
          "top-left",
        );
      }
      /* dismiss the loading veil on the first painted frame after the style is in —
         waiting for `load` (all initial tiles) can take long on slow WMS servers */
      core.map.once("style.load", () => core.map.once("render", () => (this._ready = true)));
      const readyFallback = setTimeout(() => (this._ready = true), 12_000);
      this.unsubs.push(() => clearTimeout(readyFallback));
    } catch (e) {
      this._fatal = e instanceof Error ? e.message : String(e);
      this.emit("map0:error", { message: this._fatal });
    }
  }

  private applyTheme(cfg: NormalizedConfig): void {
    this.style.setProperty("--map0-primary", cfg.theme.primary);
    this.style.setProperty("--map0-radius", RADII[cfg.theme.radius]);
    this.style.setProperty("--map0-radius-sm", RADII_SM[cfg.theme.radius]);
    if (cfg.theme.font) this.style.setProperty("--map0-font", cfg.theme.font);

    const apply = (dark: boolean) => this.setAttribute("data-theme", dark ? "dark" : "light");
    if (cfg.theme.mode === "auto" && typeof matchMedia !== "undefined") {
      const mq = matchMedia("(prefers-color-scheme: dark)");
      const listener = (e: MediaQueryListEvent) => apply(e.matches);
      mq.addEventListener("change", listener);
      this.unsubs.push(() => mq.removeEventListener("change", listener));
      apply(mq.matches);
    } else {
      apply(cfg.theme.mode === "dark");
    }
  }

  private showPopup(e: { lngLat: [number, number]; results: FeatureInfoResult[] }): void {
    if (!this.core) return;
    this.popup?.remove();
    const content = buildPopupContent(e.results, this.core.t);
    this.popup = new Popup({ closeButton: true, maxWidth: "340px" })
      .setLngLat(e.lngLat)
      .setDOMContent(content)
      .addTo(this.core.map);
    this.popup.on("close", () => this.core?.clearHighlight());
    this.emit("map0:featureclick", e);
  }

  private showCoordinates(e: {
    lngLat: [number, number];
    entries: Array<{ code: string; label: string; text: string }>;
  }): void {
    if (!this.core) return;
    const t = this.core.t;
    this.popup?.remove();
    /* built entirely with textContent — nothing here comes from remote services */
    const container = document.createElement("div");
    container.className = "m0-popup m0-coords";
    const heading = document.createElement("p");
    heading.className = "m0-layer-title";
    heading.textContent = t("coords.title");
    container.appendChild(heading);
    const table = document.createElement("table");
    table.className = "m0-fields";
    for (const entry of e.entries) {
      const row = table.insertRow();
      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = entry.label;
      th.title = entry.code;
      row.appendChild(th);
      const td = row.insertCell();
      const value = document.createElement("span");
      value.textContent = entry.text;
      td.appendChild(value);
      const copy = document.createElement("button");
      copy.className = "icon-btn copy-btn";
      copy.title = t("coords.copy");
      copy.setAttribute("aria-label", `${t("coords.copy")} (${entry.label})`);
      copy.textContent = "⧉";
      copy.addEventListener("click", () => {
        void navigator.clipboard
          .writeText(entry.text)
          .then(() => this.notify("info", t("coords.copied")))
          .catch(() => this.notify("error", t("coords.copyFailed")));
      });
      td.appendChild(copy);
    }
    container.appendChild(table);
    this.popup = new Popup({ closeButton: true, maxWidth: "340px" })
      .setLngLat(e.lngLat)
      .setDOMContent(container)
      .addTo(this.core.map);
  }

  /* --------------------------------- render -------------------------------- */

  protected override render(): TemplateResult {
    if (this._fatal) return this.renderErrors([{ path: "$", message: this._fatal }]);
    if (this._errors) return this.renderErrors(this._errors);
    return html`
      <div class="stage">
        <div class="map" aria-label=${this.normalized?.meta.title ?? "Karte"}></div>
        <div class="loading" ?data-done=${this._ready} aria-hidden="true">
          <div class="spinner"></div>
        </div>
        ${this._hover
          ? html`<div
              class="hover-tip"
              style=${`left:${this._hover.x + 12}px;top:${this._hover.y + 12}px`}
            >
              ${unsafeHTML(this._hover.html)}
            </div>`
          : nothing}
        ${this.renderToc()} ${this.renderBasemaps()} ${this.renderLegend()}
        ${this._addOpen && this.core
          ? html`<map0-add-layer
              .core=${this.core}
              .t=${this.core.t}
              @close=${() => (this._addOpen = false)}
            ></map0-add-layer>`
          : nothing}
        ${this._printOpen && this.core
          ? html`<map0-print
              .core=${this.core}
              .t=${this.core.t}
              @close=${() => (this._printOpen = false)}
            ></map0-print>`
          : nothing}
        ${this._notices.length > 0
          ? html`<div class="notices" role="status" aria-live="polite">
              ${this._notices.map(
                (n) => html`
                  <div class="notice" data-kind=${n.kind}>
                    <span>${n.text}</span>
                    <button
                      class="icon-btn"
                      aria-label=${this.core?.t("popup.close") ?? "Close"}
                      @click=${() =>
                        (this._notices = this._notices.filter((x) => x.id !== n.id))}
                    >
                      ✕
                    </button>
                  </div>
                `,
              )}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderLegend(): TemplateResult | typeof nothing {
    const cfg = this.normalized;
    if (!cfg || cfg.controls.legend === false) return nothing;
    const items = this._layers.filter((l) => l.visible && l.inZoomRange && l.legend);
    if (items.length === 0) return nothing;
    const t = this.core?.t ?? ((k: string) => k);
    return html`
      <div class="legend panel" part="legend" data-pos=${cfg.controls.legend.position} ?data-open=${this._legendOpen}>
        <button
          class="panel-header"
          @click=${() => (this._legendOpen = !this._legendOpen)}
          aria-expanded=${this._legendOpen ? "true" : "false"}
        >
          ${icons.legend}<span>${t("legend.title")}</span>${icons.chevron}
        </button>
        ${this._legendOpen
          ? html`<div class="panel-body">
              ${items.map(
                (l) => html`
                  <div class="legend-layer">
                    <div class="legend-layer-title">${l.title}</div>
                    ${l.legend!.kind === "image"
                      ? html`<img
                          class="legend-image"
                          src=${l.legend!.url}
                          alt=${l.title}
                          loading="lazy"
                          @error=${(e: Event) =>
                            ((e.target as HTMLElement).style.display = "none")}
                        />`
                      : l.legend!.entries.map(
                          (en) => html`
                            <div class="legend-entry">
                              ${en.image
                                ? html`<img class="legend-entry-img" src=${en.image} alt="" />`
                                : html`<span
                                    class="swatch"
                                    data-shape=${en.shape}
                                    style=${`--swatch:${en.color ?? "var(--map0-muted)"}`}
                                  ></span>`}
                              ${en.label ? html`<span>${en.label}</span>` : nothing}
                            </div>
                          `,
                        )}
                  </div>
                `,
              )}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderErrors(errors: ValidationError[]): TemplateResult {
    const t = this.core?.t ?? ((k: string) => (k === "error.title" ? "map0 configuration error" : "The map could not start. Please fix the configuration:"));
    return html`
      <div class="stage">
        <div class="error-panel" role="alert">
          <div class="error-card">
            <h3>${t("error.title")}</h3>
            <p>${t("error.intro")}</p>
            <ul>
              ${errors.map((e) => html`<li><code>${e.path}</code> — ${e.message}</li>`)}
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  private renderToc(): TemplateResult | typeof nothing {
    const cfg = this.normalized;
    if (!cfg || cfg.controls.layerSwitcher === false) return nothing;
    const allowAdd = cfg.controls.layerSwitcher.allowAdd;
    if (cfg.layers.length === 0 && this._layers.length === 0 && !allowAdd) return nothing;
    const t = this.core?.t ?? ((k: string) => k);
    const byId = new Map(this._layers.map((l) => [l.id, l]));
    const extras = this._layers.filter((l) => l.userAdded);
    const title = cfg.controls.layerSwitcher.title ?? t("layers.title");
    return html`
      <div class="toc panel" part="toc" ?data-open=${this._tocOpen}>
        <button
          class="panel-header"
          @click=${() => (this._tocOpen = !this._tocOpen)}
          aria-expanded=${this._tocOpen ? "true" : "false"}
        >
          ${icons.layers}<span>${title}</span>
          ${allowAdd
            ? html`<span
                class="icon-btn add-btn"
                role="button"
                tabindex="0"
                title=${t("addLayer.title")}
                aria-label=${t("addLayer.title")}
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._addOpen = true;
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    this._addOpen = true;
                  }
                }}
                >${icons.plus}</span
              >`
            : nothing}
          ${icons.chevron}
        </button>
        ${this._tocOpen
          ? html`<div class="panel-body">
              ${this.renderNodes(cfg.toc, byId, "")}
              ${extras.length > 0
                ? html`<div class="toc-extras">
                    <div class="group-label">${t("layers.added")}</div>
                    ${extras.map((l) => this.renderLayerRow(l))}
                  </div>`
                : nothing}
              ${cfg.layers.length === 0 && extras.length === 0
                ? html`<div class="toc-empty">${t("layers.empty")}</div>`
                : nothing}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderNodes(
    nodes: TocNode[],
    byId: Map<string, LayerUIState>,
    path: string,
  ): unknown[] {
    return nodes.map((n, i) => {
      if (n.kind === "group") {
        const key = `${path}/${i}:${n.title}`;
        const collapsed = this._groupCollapsed[key] ?? n.collapsed;
        return html`
          <div class="group" ?data-collapsed=${collapsed}>
            <button
              class="group-header"
              @click=${() =>
                (this._groupCollapsed = { ...this._groupCollapsed, [key]: !collapsed })}
              aria-expanded=${collapsed ? "false" : "true"}
            >
              <span>${n.title}</span>${icons.chevron}
            </button>
            <div class="group-body">${this.renderNodes(n.children, byId, key)}</div>
          </div>
        `;
      }
      const l = byId.get(n.layerId);
      return l ? this.renderLayerRow(l) : nothing;
    });
  }

  private renderLayerRow(l: LayerUIState): TemplateResult {
    const t = this.core?.t ?? ((k: string) => k);
    const outOfRange = l.visible && !l.inZoomRange;
    return html`
      <div class="layer-row" ?data-out-of-range=${outOfRange}>
        <div class="layer-main">
          <label>
            <input
              type="checkbox"
              .checked=${l.visible}
              @change=${(e: Event) =>
                this.core?.setLayerVisibility(l.id, (e.target as HTMLInputElement).checked)}
            />
            <span class="layer-title" title=${l.title}>${l.title}</span>
          </label>
          ${outOfRange
            ? nothing
            : html`<span
                class="status-dot"
                data-status=${l.status}
                title=${l.status === "error" ? t("layers.error") : ""}
              ></span>`}
          ${l.canZoom
            ? html`<button
                class="icon-btn zoom-btn"
                title=${t("layers.zoomTo")}
                aria-label=${t("layers.zoomTo")}
                @click=${() => void this.core?.zoomToLayer(l.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="2.5"/></svg>
              </button>`
            : nothing}
          ${l.metadataUrl
            ? html`<a
                class="meta-link"
                href=${l.metadataUrl}
                target="_blank"
                rel="noopener noreferrer"
                title=${l.metadataTitle ?? t("layers.metadata")}
                aria-label=${l.metadataTitle ?? t("layers.metadata")}
                >${icons.info}</a
              >`
            : nothing}
          ${l.userAdded
            ? html`<button
                class="icon-btn remove-btn"
                title=${t("layers.remove")}
                aria-label=${t("layers.remove")}
                @click=${() => this.core?.removeLayer(l.id)}
              >
                ✕
              </button>`
            : nothing}
        </div>
        ${outOfRange
          ? html`
              <div class="zoom-hint">
                ${l.minZoom !== undefined && (this.core?.map.getZoom() ?? 0) < l.minZoom
                  ? html`${t("layers.zoomHintMin")} ${l.minZoom}`
                  : html`${t("layers.zoomHintMax")} ${l.maxZoom}`}
              </div>
            `
          : nothing}
        ${l.visible
          ? html`
              <div class="opacity-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${String(Math.round(l.opacity * 100))}
                  aria-label=${t("layers.opacity")}
                  @input=${(e: Event) =>
                    this.core?.setLayerOpacity(
                      l.id,
                      Number((e.target as HTMLInputElement).value) / 100,
                    )}
                />
                <span class="opacity-value">${Math.round(l.opacity * 100)}%</span>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private renderBasemaps(): TemplateResult | typeof nothing {
    const cfg = this.normalized;
    if (!cfg || cfg.controls.basemapSwitcher === false || cfg.basemaps.length < 2) return nothing;
    return html`
      <div class="basemaps" part="basemaps" role="radiogroup" aria-label=${this.core?.t("basemaps.title") ?? "Basemap"}>
        ${cfg.basemaps.map(
          (b) => html`
            <button
              role="radio"
              aria-checked=${this._basemapId === b.id ? "true" : "false"}
              ?data-active=${this._basemapId === b.id}
              @click=${() => this.core?.setBasemap(b.id)}
            >
              ${b.title}
            </button>
          `,
        )}
      </div>
    `;
  }
}
