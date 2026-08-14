import { LitElement, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
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

const RADII = { none: "0px", sm: "6px", md: "10px", lg: "16px" } as const;
const RADII_SM = { none: "0px", sm: "4px", md: "7px", lg: "10px" } as const;

const icons = {
  layers: html`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`,
  chevron: html`<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
  info: html`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>`,
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
  @state() private _groupCollapsed: Record<string, boolean> = {};
  @state() private _ready = false;

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
    this.popup?.remove();
    this.popup = undefined;
    this.core?.destroy();
    this.core = undefined;
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
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

      await this.updateComplete;
      if (!this.mapEl) throw new Error("internal: map container missing");

      const core = await createCore({ container: this.mapEl, config: cfg, fullscreenTarget: this });
      this.core = core;
      this._basemapId = core.basemaps.current.value;
      this.unsubs.push(
        core.layers.state.subscribe((v) => (this._layers = v), { immediate: true }),
        core.basemaps.current.subscribe((v) => (this._basemapId = v)),
        core.events.on("ready", () => {
          this.emit("map0:ready", { api: core });
        }),
        core.events.on("featureclick", (e) => this.showPopup(e)),
        core.events.on("error", (e) => this.emit("map0:error", e)),
      );
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
    this.emit("map0:featureclick", e);
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
        ${this.renderToc()} ${this.renderBasemaps()}
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
    if (!cfg || cfg.controls.layerSwitcher === false || cfg.layers.length === 0) return nothing;
    const byId = new Map(this._layers.map((l) => [l.id, l]));
    const title = cfg.controls.layerSwitcher.title ?? this.core?.t("layers.title") ?? "Layers";
    return html`
      <div class="toc panel" part="toc" ?data-open=${this._tocOpen}>
        <button
          class="panel-header"
          @click=${() => (this._tocOpen = !this._tocOpen)}
          aria-expanded=${this._tocOpen ? "true" : "false"}
        >
          ${icons.layers}<span>${title}</span>${icons.chevron}
        </button>
        ${this._tocOpen
          ? html`<div class="panel-body">${this.renderNodes(cfg.toc, byId, "")}</div>`
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
