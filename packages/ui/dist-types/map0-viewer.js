var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { LitElement, html, nothing, unsafeCSS } from "lit";
import { property, query, state } from "lit/decorators.js";
import { Popup } from "maplibre-gl";
import maplibreCss from "maplibre-gl/dist/maplibre-gl.css?inline";
import { createCore, normalizeConfig, validateConfig, } from "@map0/core";
import { buildPopupContent } from "./popup.js";
import { componentStyles } from "./styles.js";
const RADII = { none: "0px", sm: "6px", md: "10px", lg: "16px" };
const RADII_SM = { none: "0px", sm: "4px", md: "7px", lg: "10px" };
const icons = {
    layers: html `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg>`,
    chevron: html `<svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>`,
    info: html `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5"/><path d="M12 8h.01"/></svg>`,
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
    constructor() {
        super(...arguments);
        this._errors = null;
        this._fatal = null;
        this._layers = [];
        this._basemapId = "";
        this._tocOpen = true;
        this._groupCollapsed = {};
        this._ready = false;
        this.unsubs = [];
        this.initialized = false;
    }
    static { this.styles = [unsafeCSS(maplibreCss), componentStyles]; }
    /** imperative access to the running map (available after `map0:ready`) */
    get api() {
        return this.core;
    }
    firstUpdated() {
        this.initialized = true;
        void this.init();
    }
    updated(changed) {
        if (this.initialized &&
            this.core &&
            (changed.has("config") || changed.has("configSrc")) &&
            (changed.get("config") !== undefined || changed.get("configSrc") !== undefined)) {
            this.reload();
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.teardown();
    }
    /** tear down and re-init (e.g. after assigning a new config) */
    reload() {
        this.teardown();
        this._errors = null;
        this._fatal = null;
        this._layers = [];
        this._ready = false;
        void this.updateComplete.then(() => void this.init());
    }
    teardown() {
        for (const u of this.unsubs)
            u();
        this.unsubs = [];
        this.popup?.remove();
        this.popup = undefined;
        this.core?.destroy();
        this.core = undefined;
    }
    emit(name, detail) {
        this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
    async loadRawConfig() {
        if (this.config)
            return this.config;
        if (this.configSrc) {
            const res = await fetch(this.configSrc);
            if (!res.ok)
                throw new Error(`could not fetch config: HTTP ${res.status} (${this.configSrc})`);
            return res.json();
        }
        const inline = this.querySelector('script[type="application/json"]');
        if (inline?.textContent?.trim()) {
            try {
                return JSON.parse(inline.textContent);
            }
            catch (e) {
                throw new Error(`inline config is not valid JSON: ${e instanceof Error ? e.message : e}`);
            }
        }
        throw new Error('no config found — set the "config" property, a "config-src" attribute, or an inline <script type="application/json"> child');
    }
    async init() {
        try {
            const raw = await this.loadRawConfig();
            const result = validateConfig(raw);
            if (!result.valid) {
                this._errors = result.errors;
                this.emit("map0:error", { errors: result.errors });
                return;
            }
            const cfg = normalizeConfig(result.config);
            this.normalized = cfg;
            this.applyTheme(cfg);
            const ls = cfg.controls.layerSwitcher;
            this._tocOpen =
                ls === false ? false : ls.open === "auto" ? this.getBoundingClientRect().width >= 560 : ls.open;
            await this.updateComplete;
            if (!this.mapEl)
                throw new Error("internal: map container missing");
            const core = await createCore({ container: this.mapEl, config: cfg, fullscreenTarget: this });
            this.core = core;
            this._basemapId = core.basemaps.current.value;
            this.unsubs.push(core.layers.state.subscribe((v) => (this._layers = v), { immediate: true }), core.basemaps.current.subscribe((v) => (this._basemapId = v)), core.events.on("ready", () => {
                this.emit("map0:ready", { api: core });
            }), core.events.on("featureclick", (e) => this.showPopup(e)), core.events.on("error", (e) => this.emit("map0:error", e)));
            /* dismiss the loading veil on the first painted frame after the style is in —
               waiting for `load` (all initial tiles) can take long on slow WMS servers */
            core.map.once("style.load", () => core.map.once("render", () => (this._ready = true)));
            const readyFallback = setTimeout(() => (this._ready = true), 12_000);
            this.unsubs.push(() => clearTimeout(readyFallback));
        }
        catch (e) {
            this._fatal = e instanceof Error ? e.message : String(e);
            this.emit("map0:error", { message: this._fatal });
        }
    }
    applyTheme(cfg) {
        this.style.setProperty("--map0-primary", cfg.theme.primary);
        this.style.setProperty("--map0-radius", RADII[cfg.theme.radius]);
        this.style.setProperty("--map0-radius-sm", RADII_SM[cfg.theme.radius]);
        if (cfg.theme.font)
            this.style.setProperty("--map0-font", cfg.theme.font);
        const apply = (dark) => this.setAttribute("data-theme", dark ? "dark" : "light");
        if (cfg.theme.mode === "auto" && typeof matchMedia !== "undefined") {
            const mq = matchMedia("(prefers-color-scheme: dark)");
            const listener = (e) => apply(e.matches);
            mq.addEventListener("change", listener);
            this.unsubs.push(() => mq.removeEventListener("change", listener));
            apply(mq.matches);
        }
        else {
            apply(cfg.theme.mode === "dark");
        }
    }
    showPopup(e) {
        if (!this.core)
            return;
        this.popup?.remove();
        const content = buildPopupContent(e.results, this.core.t);
        this.popup = new Popup({ closeButton: true, maxWidth: "340px" })
            .setLngLat(e.lngLat)
            .setDOMContent(content)
            .addTo(this.core.map);
        this.emit("map0:featureclick", e);
    }
    /* --------------------------------- render -------------------------------- */
    render() {
        if (this._fatal)
            return this.renderErrors([{ path: "$", message: this._fatal }]);
        if (this._errors)
            return this.renderErrors(this._errors);
        return html `
      <div class="stage">
        <div class="map" aria-label=${this.normalized?.meta.title ?? "Karte"}></div>
        <div class="loading" ?data-done=${this._ready} aria-hidden="true">
          <div class="spinner"></div>
        </div>
        ${this.renderToc()} ${this.renderBasemaps()}
      </div>
    `;
    }
    renderErrors(errors) {
        const t = this.core?.t ?? ((k) => (k === "error.title" ? "map0 configuration error" : "The map could not start. Please fix the configuration:"));
        return html `
      <div class="stage">
        <div class="error-panel" role="alert">
          <div class="error-card">
            <h3>${t("error.title")}</h3>
            <p>${t("error.intro")}</p>
            <ul>
              ${errors.map((e) => html `<li><code>${e.path}</code> — ${e.message}</li>`)}
            </ul>
          </div>
        </div>
      </div>
    `;
    }
    renderToc() {
        const cfg = this.normalized;
        if (!cfg || cfg.controls.layerSwitcher === false || cfg.layers.length === 0)
            return nothing;
        const byId = new Map(this._layers.map((l) => [l.id, l]));
        const title = cfg.controls.layerSwitcher.title ?? this.core?.t("layers.title") ?? "Layers";
        return html `
      <div class="toc panel" part="toc" ?data-open=${this._tocOpen}>
        <button
          class="panel-header"
          @click=${() => (this._tocOpen = !this._tocOpen)}
          aria-expanded=${this._tocOpen ? "true" : "false"}
        >
          ${icons.layers}<span>${title}</span>${icons.chevron}
        </button>
        ${this._tocOpen
            ? html `<div class="panel-body">${this.renderNodes(cfg.toc, byId, "")}</div>`
            : nothing}
      </div>
    `;
    }
    renderNodes(nodes, byId, path) {
        return nodes.map((n, i) => {
            if (n.kind === "group") {
                const key = `${path}/${i}:${n.title}`;
                const collapsed = this._groupCollapsed[key] ?? n.collapsed;
                return html `
          <div class="group" ?data-collapsed=${collapsed}>
            <button
              class="group-header"
              @click=${() => (this._groupCollapsed = { ...this._groupCollapsed, [key]: !collapsed })}
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
    renderLayerRow(l) {
        const t = this.core?.t ?? ((k) => k);
        return html `
      <div class="layer-row">
        <div class="layer-main">
          <label>
            <input
              type="checkbox"
              .checked=${l.visible}
              @change=${(e) => this.core?.setLayerVisibility(l.id, e.target.checked)}
            />
            <span class="layer-title" title=${l.title}>${l.title}</span>
          </label>
          <span
            class="status-dot"
            data-status=${l.status}
            title=${l.status === "error" ? t("layers.error") : ""}
          ></span>
          ${l.metadataUrl
            ? html `<a
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
        ${l.visible
            ? html `
              <div class="opacity-row">
                <input
                  type="range"
                  min="0"
                  max="100"
                  .value=${String(Math.round(l.opacity * 100))}
                  aria-label=${t("layers.opacity")}
                  @input=${(e) => this.core?.setLayerOpacity(l.id, Number(e.target.value) / 100)}
                />
                <span class="opacity-value">${Math.round(l.opacity * 100)}%</span>
              </div>
            `
            : nothing}
      </div>
    `;
    }
    renderBasemaps() {
        const cfg = this.normalized;
        if (!cfg || cfg.controls.basemapSwitcher === false || cfg.basemaps.length < 2)
            return nothing;
        return html `
      <div class="basemaps" part="basemaps" role="radiogroup" aria-label=${this.core?.t("basemaps.title") ?? "Basemap"}>
        ${cfg.basemaps.map((b) => html `
            <button
              role="radio"
              aria-checked=${this._basemapId === b.id ? "true" : "false"}
              ?data-active=${this._basemapId === b.id}
              @click=${() => this.core?.setBasemap(b.id)}
            >
              ${b.title}
            </button>
          `)}
      </div>
    `;
    }
}
__decorate([
    property({ attribute: false })
], Map0Viewer.prototype, "config", void 0);
__decorate([
    property({ attribute: "config-src" })
], Map0Viewer.prototype, "configSrc", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_errors", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_fatal", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_layers", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_basemapId", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_tocOpen", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_groupCollapsed", void 0);
__decorate([
    state()
], Map0Viewer.prototype, "_ready", void 0);
__decorate([
    query(".map")
], Map0Viewer.prototype, "mapEl", void 0);
//# sourceMappingURL=map0-viewer.js.map