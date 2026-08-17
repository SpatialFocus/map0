import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Popup } from "maplibre-gl"; // type only — erased at build time
import type {
  FeatureInfoResult,
  LayerUIState,
  Map0Config,
  Map0Core,
  MeasureController,
  MeasureMode,
  MeasureState,
  NormalizedConfig,
  SearchResult,
  ValidationError,
} from "@map0/core";
import { normalizeConfig, resolveConfigExtends, validateConfig, type TocNode } from "@map0/schema";
import { componentStyles } from "./styles.js";

/**
 * Everything the map itself needs — the engine, MapLibre and its stylesheet, the
 * popup renderer with its sanitiser — is behind these imports, so a page that
 * embeds a map far below the fold downloads none of it until the map is needed.
 * Type-only imports above are erased at build time and cost nothing.
 */
const loadEngine = () => import("@map0/core");
const loadPopupRenderer = () => import("./popup.js");
const loadMaplibreCss = () => import("./maplibre-css.js");
/* The dialogs — and what they drag in, capabilities parsing and the print
   composer — are loaded the first time a user opens them, not on page load. */
const loadDialog = {
  add: () => import("./add-layer-dialog.js"),
  print: () => import("./print-dialog.js"),
};

type PopupRenderer = Awaited<ReturnType<typeof loadPopupRenderer>>;

/** one constructable sheet for MapLibre's CSS, shared by every viewer on the page */
let maplibreSheet: CSSStyleSheet | undefined;

const CONTROL_SVGS = {
  print:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
  share:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-3.9M8.6 13.5l6.8 3.9"/></svg>',
  measure:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:auto"><path d="M3 15 15 3l6 6L9 21z"/><path d="m7 11 2 2"/><path d="m10 8 2 2"/><path d="m13 5 2 2"/></svg>',
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
  search: html`<svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  pin: html`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`,
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
  static override styles = [componentStyles];

  @property({ attribute: false }) config?: Map0Config;
  @property({ attribute: "config-src" }) configSrc?: string;
  /**
   * When to start loading — mirrors `<img loading>`. `"lazy"` (default) waits
   * until the element is near the viewport; `"eager"` starts immediately.
   * This is an attribute rather than a config key on purpose: it decides
   * whether the config is fetched at all.
   */
  @property({ attribute: "loading" }) loading: "lazy" | "eager" = "lazy";

  @state() private _errors: ValidationError[] | null = null;
  @state() private _fatal: string | null = null;
  @state() private _layers: LayerUIState[] = [];
  @state() private _basemapId = "";
  @state() private _tocOpen = true;
  @state() private _legendOpen = false;
  @state() private _addOpen = false;
  @state() private _printOpen = false;
  @state() private _dialogLoading: "add" | "print" | null = null;
  @state() private _groupCollapsed: Record<string, boolean> = {};
  @state() private _ready = false;
  /** true once initialisation actually starts — before that the element only reserves space */
  @state() private _loading = false;
  @state() private _notices: Array<{ id: number; kind: "error" | "info"; text: string }> = [];
  @state() private _hover: { x: number; y: number; html: string } | null = null;
  @state() private _searchResults: SearchResult[] = [];
  @state() private _searchBusy = false;
  @state() private _searchActive = -1;
  @state() private _searchExpanded = false;
  @state() private _searchEmpty = false;
  @state() private _measure: MeasureState | null = null;
  @state() private _measureLoading = false;

  private measureController?: MeasureController;

  private noticeSeq = 0;
  private statusSeen = new Map<string, string>();
  private searchSeq = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private searchAbort?: AbortController;

  @query(".map") private mapEl?: HTMLDivElement;

  private core?: Map0Core;
  private normalized?: NormalizedConfig;
  private popup?: Popup;
  private popups?: PopupRenderer;
  private createPopup?: (options?: object) => Popup;
  private unsubs: Array<() => void> = [];
  private initialized = false;
  private initStarted = false;
  private observer?: IntersectionObserver;
  /** bumped by every teardown; an init() whose token is stale must not attach */
  private generation = 0;

  /** imperative access to the running map (available after `map0:ready`) */
  get api(): Map0Core | undefined {
    return this.core;
  }

  /**
   * The search and the layer panel both live in the top row, so the layout has
   * to know which of them is actually there — see the responsive block in
   * `styles.ts`. Both are mirrored onto `.stage` as `data-search`/`data-toc`.
   */
  private get hasSearch(): boolean {
    return !!this.normalized && this.normalized.search !== false;
  }

  private get hasToc(): boolean {
    const cfg = this.normalized;
    if (!cfg || cfg.controls.layerSwitcher === false) return false;
    return cfg.layers.length > 0 || this._layers.length > 0 || cfg.controls.layerSwitcher.allowAdd;
  }

  protected override firstUpdated(): void {
    this.initialized = true;
    this.arm();
  }

  /**
   * `firstUpdated()` runs once per element, but the element can be taken out of
   * the DOM and put back (SPA routing, tabs, CMS re-renders, `appendChild` of a
   * live node). `disconnectedCallback()` tears the map down, so re-connecting
   * has to arm it again — otherwise the element comes back dead.
   */
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.initialized && !this.initStarted) this.arm();
  }

  /** start now, or wait for the element to approach the viewport */
  private arm(): void {
    /* start early enough that the map is ready by the time it scrolls in */
    if (this.loading === "eager" || typeof IntersectionObserver === "undefined") {
      void this.init();
      return;
    }
    this.observer?.disconnect();
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) this.load();
      },
      { rootMargin: "300px" },
    );
    this.observer.observe(this);
  }

  /** Start loading now, whatever `loading` says (for tabs, accordions, tests). */
  load(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    if (!this.initStarted) void this.init();
  }

  protected override updated(changed: PropertyValues): void {
    if (
      this.initialized &&
      /* also while init() is still running — the token retires that attempt */
      (this.core || this.initStarted) &&
      (changed.has("config") || changed.has("configSrc")) &&
      (changed.get("config") !== undefined || changed.get("configSrc") !== undefined)
    ) {
      this.reload();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.observer?.disconnect();
    this.observer = undefined;
    this.teardown();
  }

  /** tear down and re-init (e.g. after assigning a new config) */
  reload(): void {
    this.teardown();
    void this.updateComplete.then(() => void this.init());
  }

  private teardown(): void {
    /* retires any init() still in flight: it checks the token after every await
       and destroys a core that finished for a generation nobody waits for */
    this.generation++;
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.statusSeen.clear();
    this.popup?.remove();
    this.popup = undefined;
    this.core?.destroy();
    this.core = undefined;
    this.measureController = undefined; // destroyed via unsubs — never reuse it
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    this.searchAbort = undefined;
    this.initStarted = false;
    this._notices = [];
    this._errors = null;
    this._fatal = null;
    this._layers = [];
    this._measure = null;
    this._searchResults = [];
    this._hover = null;
    this._ready = false;
    this._loading = false;
  }

  private emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** MapLibre's stylesheet arrives with the engine — prepend it so ours still wins */
  private adoptMaplibreCss(css: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    maplibreSheet ??= (() => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      return sheet;
    })();
    if (!root.adoptedStyleSheets.includes(maplibreSheet)) {
      root.adoptedStyleSheets = [maplibreSheet, ...root.adoptedStyleSheets];
    }
  }

  /** load a dialog's chunk, then open it (a slow network shows a busy cursor, not a blank panel) */
  private async openDialog(kind: "add" | "print"): Promise<void> {
    this._dialogLoading = kind;
    try {
      await loadDialog[kind]();
      if (kind === "add") this._addOpen = true;
      else this._printOpen = true;
    } catch (e) {
      this.notify("error", String(e));
    } finally {
      this._dialogLoading = null;
    }
  }

  /* -------------------------------- measuring ------------------------------- */

  /** activate a measure mode, loading the module on first use */
  private async startMeasure(mode: MeasureMode): Promise<void> {
    if (!this.core) return;
    this._measureLoading = true;
    try {
      if (!this.measureController) {
        const engine = await loadEngine();
        const { MeasureController } = await engine.loadMeasure();
        const controller = new MeasureController(
          this.core.map,
          this.normalized!.theme.primary,
          this.core.locale,
        );
        this.measureController = controller;
        this.unsubs.push(
          controller.state.subscribe((v) => (this._measure = v)),
          () => controller.destroy(),
        );
        /* the measurement must survive a basemap change like any other overlay */
        this.core.registerOverlay(() => controller.ids);
      }
      this.popup?.remove();
      this.core.setInteractionLocked(true);
      this.measureController.start(mode);
    } catch (e) {
      this.notify("error", String(e));
    } finally {
      this._measureLoading = false;
    }
  }

  private stopMeasure(): void {
    this.measureController?.stop();
    this.core?.setInteractionLocked(false);
    this._measure = null;
  }

  /* --------------------------------- search -------------------------------- */

  /** debounced query; the sequence guard keeps a slow answer from overwriting a newer one */
  private queueSearch(query: string): void {
    clearTimeout(this.searchTimer);
    this.searchAbort?.abort();
    const config = this.normalized?.search;
    if (!config || !this.core) return;
    if (!query.trim()) {
      this._searchResults = [];
      this._searchEmpty = false;
      this._searchBusy = false;
      return;
    }
    this.searchTimer = setTimeout(() => {
      void (async () => {
        const seq = ++this.searchSeq;
        const abort = new AbortController();
        this.searchAbort = abort;
        this._searchBusy = true;
        try {
          const { search } = await loadEngine();
          const center = this.core!.map.getCenter();
          const results = await search(config, query, {
            center: [center.lng, center.lat],
            lang: this.core!.locale,
            signal: abort.signal,
          });
          if (seq !== this.searchSeq) return;
          this._searchResults = results;
          this._searchActive = results.length > 0 ? 0 : -1;
          this._searchEmpty = results.length === 0 && query.trim().length >= config.minLength;
        } catch (e) {
          if (seq === this.searchSeq && (e as Error)?.name !== "AbortError") {
            this._searchResults = [];
            this.notify("error", `${this.core!.t("search.failed")}: ${(e as Error).message}`);
          }
        } finally {
          if (seq === this.searchSeq) this._searchBusy = false;
        }
      })();
    }, 250);
  }

  private pickSearchResult(result: SearchResult): void {
    this.core?.showLocation({ center: result.center, bbox: result.bbox });
    this._searchResults = [];
    this._searchActive = -1;
    this._searchEmpty = false;
    this.emit("map0:search", { result });
  }

  private onSearchKey(event: KeyboardEvent): void {
    const count = this._searchResults.length;
    if (event.key === "ArrowDown" && count > 0) {
      event.preventDefault();
      this._searchActive = (this._searchActive + 1) % count;
    } else if (event.key === "ArrowUp" && count > 0) {
      event.preventDefault();
      this._searchActive = (this._searchActive - 1 + count) % count;
    } else if (event.key === "Enter") {
      const hit = this._searchResults[Math.max(this._searchActive, 0)];
      if (hit) this.pickSearchResult(hit);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      this._searchResults = [];
      this._searchEmpty = false;
      (event.target as HTMLInputElement).blur();
    }
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
    if (this.config) return resolveConfigExtends(this.config);
    if (this.configSrc) {
      const res = await fetch(this.configSrc);
      if (!res.ok) throw new Error(`could not fetch config: HTTP ${res.status} (${this.configSrc})`);
      /* relative `extends` URLs resolve against the config file's own URL */
      return resolveConfigExtends(await res.json(), { baseUrl: res.url || this.configSrc });
    }
    const inline = this.querySelector('script[type="application/json"]');
    if (inline?.textContent?.trim()) {
      try {
        return await resolveConfigExtends(JSON.parse(inline.textContent));
      } catch (e) {
        throw new Error(`config could not be loaded: ${e instanceof Error ? e.message : e}`);
      }
    }
    throw new Error(
      'no config found — set the "config" property, a "config-src" attribute, or an inline <script type="application/json"> child',
    );
  }

  private async init(): Promise<void> {
    const gen = ++this.generation;
    /** true while this init() is still the one the element is waiting for */
    const current = (): boolean => gen === this.generation && this.isConnected;
    this.initStarted = true;
    this._loading = true;
    try {
      const raw = await this.loadRawConfig();
      if (!current()) return;
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

      /* the engine, MapLibre and its stylesheet, and the popup renderer */
      const [{ createCore, createPopup }, popups, maplibreCss] = await Promise.all([
        loadEngine(),
        loadPopupRenderer(),
        loadMaplibreCss().then((m) => m.default),
      ]);
      if (!current()) return;
      this.createPopup = createPopup;
      this.popups = popups;
      this.adoptMaplibreCss(maplibreCss);

      await this.updateComplete;
      if (!current()) return;
      if (!this.mapEl) throw new Error("internal: map container missing");

      const core = await createCore({ container: this.mapEl, config: cfg, fullscreenTarget: this });
      /* the element was removed or re-configured while the engine was starting:
         the finished core belongs to nobody, so it must not be kept */
      if (!current()) {
        core.destroy();
        return;
      }
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
            ? { x: e.point[0], y: e.point[1], html: popups.sanitizeHtml(e.html) }
            : null;
        }),
        core.events.on("coordinates", (e) => this.showCoordinates(e)),
        core.events.on("error", (e) => this.emit("map0:error", e)),
      );
      if (cfg.controls.print) {
        core.map.addControl(
          new IconButtonControl("print", () => void this.openDialog("print"), core.t("print.title")),
          "top-left",
        );
      }
      if (cfg.controls.measure) {
        core.map.addControl(
          new IconButtonControl(
            "measure",
            () => {
              if (this._measure) this.stopMeasure();
              else void this.startMeasure("distance");
            },
            core.t("measure.title"),
          ),
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
      if (!current()) return; // a failure nobody is waiting for any more
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
    if (!this.popups || !this.createPopup) return;
    const content = this.popups.buildPopupContent(e.results, this.core.t);
    this.popup = this.createPopup({ closeButton: true, maxWidth: "340px" })
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
    if (!this.core || !this.createPopup) return;
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
    this.popup = this.createPopup({ closeButton: true, maxWidth: "340px" })
      .setLngLat(e.lngLat)
      .setDOMContent(container)
      .addTo(this.core.map);
  }

  /* --------------------------------- render -------------------------------- */

  protected override render(): TemplateResult {
    if (this._fatal) return this.renderErrors([{ path: "$", message: this._fatal }]);
    if (this._errors) return this.renderErrors(this._errors);
    return html`
      <div
        class="stage"
        ?data-busy=${this._dialogLoading !== null}
        ?data-search=${this.hasSearch}
        ?data-toc=${this.hasToc}
      >
        <div class="map" aria-label=${this.normalized?.meta.title ?? "Karte"}></div>
        <div class="loading" ?data-done=${this._ready} aria-hidden="true">
          ${this._loading ? html`<div class="spinner"></div>` : nothing}
        </div>
        ${this._hover
          ? html`<div
              class="hover-tip"
              style=${`left:${this._hover.x + 12}px;top:${this._hover.y + 12}px`}
            >
              ${unsafeHTML(this._hover.html)}
            </div>`
          : nothing}
        ${this.renderSearch()} ${this.renderToc()} ${this.renderBasemaps()} ${this.renderLegend()}
        ${this.renderMeasure()}
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

  private renderMeasure(): TemplateResult | typeof nothing {
    const m = this._measure;
    if (!m) return nothing;
    const t = this.core?.t ?? ((k: string) => k);
    const started = m.points.length > 0;
    return html`
      <div class="measure-bar panel" part="measure" role="group" aria-label=${t("measure.title")}>
        <div class="measure-modes" role="radiogroup">
          ${(["distance", "area"] as const).map(
            (mode) => html`
              <button
                type="button"
                role="radio"
                aria-checked=${m.mode === mode ? "true" : "false"}
                ?data-active=${m.mode === mode}
                @click=${() => void this.startMeasure(mode)}
              >
                ${t(`measure.${mode}`)}
              </button>
            `,
          )}
        </div>
        <div class="measure-readout">
          ${started
            ? html`<strong>${m.text}</strong>
                ${m.perimeter
                  ? html`<span class="measure-sub">${t("measure.perimeter")} ${m.perimeter}</span>`
                  : nothing}`
            : html`<span class="measure-hint">${t("measure.hint")}</span>`}
        </div>
        ${started
          ? html`<button class="btn measure-clear" @click=${() => void this.startMeasure(m.mode)}>
              ${t("measure.clear")}
            </button>`
          : nothing}
        <button
          class="icon-btn"
          aria-label=${t("measure.close")}
          title=${t("measure.close")}
          @click=${() => this.stopMeasure()}
        >
          ✕
        </button>
      </div>
    `;
  }

  private renderSearch(): TemplateResult | typeof nothing {
    const cfg = this.normalized;
    if (!cfg || cfg.search === false) return nothing;
    const t = this.core?.t ?? ((k: string) => k);
    const open = this._searchResults.length > 0 || this._searchEmpty;
    return html`
      <div class="search" part="search" ?data-expanded=${this._searchExpanded}>
        <div class="search-field">
          ${icons.search}
          <input
            type="search"
            role="combobox"
            aria-expanded=${open ? "true" : "false"}
            aria-controls="m0-search-list"
            aria-label=${t("search.label")}
            placeholder=${cfg.search.placeholder ?? t("search.placeholder")}
            autocomplete="off"
            @focus=${() => (this._searchExpanded = true)}
            @blur=${() => setTimeout(() => (this._searchExpanded = false), 150)}
            @input=${(e: Event) => this.queueSearch((e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => this.onSearchKey(e)}
          />
          ${this._searchBusy ? html`<span class="search-spinner" aria-hidden="true"></span>` : nothing}
        </div>
        ${open
          ? html`<ul class="search-results" id="m0-search-list" role="listbox">
              ${this._searchEmpty
                ? html`<li class="search-empty">${t("search.noResults")}</li>`
                : this._searchResults.map(
                    (r, i) => html`
                      <li
                        role="option"
                        aria-selected=${i === this._searchActive ? "true" : "false"}
                        ?data-active=${i === this._searchActive}
                        @mousedown=${(e: Event) => {
                          e.preventDefault(); // keep focus, blur would close the list first
                          this.pickSearchResult(r);
                        }}
                        @mouseenter=${() => (this._searchActive = i)}
                      >
                        <span class="search-label">
                          ${r.isCoordinate ? icons.pin : nothing}${r.label}
                        </span>
                        ${r.detail ? html`<span class="search-detail">${r.detail}</span>` : nothing}
                      </li>
                    `,
                  )}
            </ul>`
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
    if (!cfg || cfg.controls.layerSwitcher === false || !this.hasToc) return nothing;
    const allowAdd = cfg.controls.layerSwitcher.allowAdd;
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
                  void this.openDialog("add");
                }}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    void this.openDialog("add");
                  }
                }}
                >${icons.plus}</span
              >`
            : nothing}
          ${icons.chevron}
        </button>
        ${this._tocOpen
          ? html`<div class="panel-body">
              ${extras.length > 0
                ? html`<div class="toc-extras">
                    <div class="group-label">${t("layers.added")}</div>
                    ${extras.map((l) => this.renderLayerRow(l))}
                  </div>`
                : nothing}
              ${this.renderNodes(cfg.toc, byId, "")}
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
