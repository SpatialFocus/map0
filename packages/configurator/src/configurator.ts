/**
 * `<map0-configurator>` — the visual config editor: a section nav, the forms,
 * and a live `<map0-viewer>` that shows the config as it is being built. The
 * JSON is the product; the element only ever holds one config object and
 * every form commits a new one, so the export can never disagree with the
 * preview.
 *
 * Preview updates are debounced and only happen while the config validates,
 * because the viewer reloads the whole map on a new config — one reload per
 * pause in typing, not one per keystroke.
 */
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import "@map0/ui";
import type { Map0Viewer } from "@map0/ui";
import {
  resolveConfigExtends,
  urlPolicyError,
  validateConfig,
  type LayerDef,
  type Map0Config,
  type ValidationResult,
} from "@map0/schema";
import { checkField, textareaField } from "./fields.js";
import {
  SECTIONS,
  type AddPanel,
  type AddServiceState,
  type AddUrlState,
  type Host,
  type Lang,
  type SectionId,
  type T,
  type View,
} from "./host.js";
import { makeT } from "./i18n.js";
import { renderLayers } from "./section-layers.js";
import { renderBasemaps, renderControls, renderGeneral, renderPrint, renderSearch, renderTheme } from "./section-misc.js";
import { candidateToLayer, probeService, urlLayer } from "./services.js";
import {
  BLANK_CONFIG,
  STARTER_CONFIG,
  cleanConfig,
  embedSnippet,
  flattenLayers,
  insertLayer,
  playgroundUrl,
  serializeConfig,
  setKey,
  type LayerPath,
} from "./state.js";
import { configuratorStyles } from "./styles.js";

const OK: ValidationResult = { valid: true, errors: [], warnings: [] };
const HISTORY_LIMIT = 60;
const APPLY_DELAY = 700;

const round = (n: number, digits: number): number => Math.round(n * 10 ** digits) / 10 ** digits;

export class Map0Configurator extends LitElement implements Host {
  static override styles = [configuratorStyles];

  /** the config to start from — wins over a stored draft */
  @property({ attribute: false }) config?: Map0Config;
  /** UI language — the standard `lang` attribute, read through its own property so
      it does not collide with HTMLElement.lang */
  @property({ attribute: "lang" }) uiLang: Lang = "en";
  /** host-page colour scheme, passed on to the preview */
  @property({ reflect: true }) theme?: "light" | "dark";
  /** the map0 bundle the embed snippet points at */
  @property({ attribute: "script-url" }) scriptUrl = "https://cdn.jsdelivr.net/npm/map0-viewer/dist/map0.js";
  /** the playground the "open in the playground" link targets */
  @property({ attribute: "playground-href" }) playgroundHref = "/playground/";
  /** localStorage key for the draft; empty disables drafts */
  @property({ attribute: "storage-key" }) storageKey = "map0-configurator-draft";

  @state() cfg: Map0Config = STARTER_CONFIG;
  @state() section: SectionId = "general";
  @state() selectedPath: LayerPath | null = null;
  @state() selectedBasemap: number | null = null;
  @state() addPanel: AddPanel = null;
  @state() addService: AddServiceState = {
    kind: "wms",
    url: "",
    loading: false,
    error: "",
    probe: null,
    selected: new Set(),
    filter: "",
  };
  @state() addUrl: AddUrlState = { type: "geojson", url: "", title: "", error: "" };
  @state() private validation: ValidationResult = OK;
  @state() private autoApply = true;
  @state() private applied = "";
  @state() private jsonDraft: string | null = null;
  @state() private importUrl = "";
  @state() private toast = "";
  @state() private history: Map0Config[] = [];
  @state() private previewReady = false;
  @state() private restoredDraft = false;

  @query("map0-viewer") private viewer?: Map0Viewer;
  @query("input[type=file]") private fileInput?: HTMLInputElement;

  t: T = makeT("en");

  private applyTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private validateSeq = 0;
  private loadSeq = 0;

  /* ------------------------------- lifecycle ------------------------------- */

  override connectedCallback(): void {
    super.connectedCallback();
    this.t = makeT(this.uiLang);
    const draft = this.config ? null : this.readDraft();
    this.restoredDraft = draft !== null;
    this.cfg = this.config ?? draft ?? STARTER_CONFIG;
    this.validate();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("uiLang")) this.t = makeT(this.uiLang);
    /* a config handed in later replaces the working copy (the host page loaded a file) */
    if (changed.has("config") && this.config && changed.get("config") !== undefined) this.loadConfig(this.config);
  }

  protected override firstUpdated(): void {
    this.apply();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.applyTimer);
    clearTimeout(this.toastTimer);
  }

  /* -------------------------------- config -------------------------------- */

  /** replace the config from outside (import, reset) — history is kept */
  loadConfig(next: Map0Config): void {
    this.commit(next);
    this.selectedPath = null;
    this.selectedBasemap = null;
    this.addPanel = null;
    this.jsonDraft = null;
  }

  commit(next: Map0Config): void {
    if (next === this.cfg) return;
    this.history = [...this.history.slice(-(HISTORY_LIMIT - 1)), this.cfg];
    this.cfg = next;
    this.jsonDraft = null;
    this.validate();
    this.writeDraft();
    this.dispatchEvent(new CustomEvent("map0c:change", { detail: { config: next }, bubbles: true, composed: true }));
    if (this.autoApply) this.scheduleApply();
  }

  patchTop<K extends keyof Map0Config>(
    key: K,
    fn: (current: NonNullable<Map0Config[K]> | undefined) => Map0Config[K] | undefined,
  ): void {
    const current = this.cfg[key] as NonNullable<Map0Config[K]> | undefined;
    this.commit(setKey(this.cfg, key, fn(current)));
  }

  undo(): void {
    const previous = this.history[this.history.length - 1];
    if (!previous) return;
    this.history = this.history.slice(0, -1);
    this.cfg = previous;
    this.jsonDraft = null;
    this.selectedPath = null;
    this.selectedBasemap = null;
    this.validate();
    this.writeDraft();
    if (this.autoApply) this.scheduleApply();
  }

  reset(kind: "example" | "blank"): void {
    this.loadConfig(structuredClone(kind === "blank" ? BLANK_CONFIG : STARTER_CONFIG));
    this.section = kind === "blank" ? "basemaps" : "general";
  }

  private validate(): void {
    const seq = ++this.validateSeq;
    const cleaned = cleanConfig(this.cfg);
    if (!cleaned.extends) {
      this.validation = validateConfig(cleaned);
      return;
    }
    /* like the viewer: resolve the base first, so a child that inherits its
       basemaps validates here too */
    void resolveConfigExtends(cleaned)
      .then((resolved) => {
        if (seq === this.validateSeq) this.validation = validateConfig(resolved);
      })
      .catch((e: unknown) => {
        if (seq === this.validateSeq)
          this.validation = {
            valid: false,
            errors: [{ path: "$.extends", message: e instanceof Error ? e.message : String(e) }],
            warnings: [],
          };
      });
  }

  /* -------------------------------- drafts -------------------------------- */

  private readDraft(): Map0Config | null {
    if (!this.storageKey) return null;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && (parsed as Map0Config).version === 1) return parsed as Map0Config;
    } catch {
      /* no storage, or a mangled draft — start fresh */
    }
    return null;
  }

  private writeDraft(): void {
    if (!this.storageKey) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(cleanConfig(this.cfg)));
    } catch {
      /* private mode, quota — drafts are a convenience */
    }
  }

  private discardDraft(): void {
    try {
      localStorage.removeItem(this.storageKey);
    } catch {
      /* nothing stored */
    }
    this.restoredDraft = false;
  }

  /* -------------------------------- preview -------------------------------- */

  private scheduleApply(): void {
    clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => this.apply(), APPLY_DELAY);
  }

  private apply(): void {
    if (!this.validation.valid || !this.viewer) return;
    const json = serializeConfig(this.cfg);
    if (json === this.applied) return;
    this.applied = json;
    this.previewReady = false;
    this.viewer.config = JSON.parse(json) as Map0Config; // a fresh object: the viewer reloads on identity
    this.dispatchEvent(new CustomEvent("map0c:apply", { bubbles: true, composed: true }));
  }

  private get dirty(): boolean {
    return this.validation.valid && serializeConfig(this.cfg) !== this.applied;
  }

  currentView(): View | null {
    const map = this.viewer?.api?.map;
    if (!map || !this.previewReady) return null;
    const c = map.getCenter();
    return {
      center: [round(c.lng, 5), round(c.lat, 5)],
      zoom: round(map.getZoom(), 2),
      bearing: round(map.getBearing(), 1),
      pitch: round(map.getPitch(), 1),
    };
  }

  /* -------------------------------- layers -------------------------------- */

  selectLayer(path: LayerPath | null): void {
    this.selectedPath = path;
  }

  setAddPanel(panel: AddPanel): void {
    this.addPanel = panel;
  }

  setAddService(patch: Partial<AddServiceState>): void {
    this.addService = { ...this.addService, ...patch };
  }

  setAddUrl(patch: Partial<AddUrlState>): void {
    this.addUrl = { ...this.addUrl, ...patch };
  }

  loadService(): void {
    void this.doLoadService();
  }

  private async doLoadService(): Promise<void> {
    const url = this.addService.url.trim();
    if (!url) return;
    const policy = urlPolicyError(url);
    if (policy) {
      this.setAddService({ error: policy });
      return;
    }
    const seq = ++this.loadSeq;
    const kind = this.addService.kind;
    this.setAddService({ loading: true, error: "", probe: null, selected: new Set() });
    try {
      const probe = await probeService(kind, url);
      if (seq !== this.loadSeq) return;
      this.setAddService({ loading: false, probe, error: probe.candidates.length === 0 ? this.t("add.empty") : "" });
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.setAddService({ loading: false, error: `${this.t("add.failed")}: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** insert at the top of the tree: new layers land above everything, like in the viewer */
  private insertAtTop(defs: LayerDef[]): void {
    let next = this.cfg;
    defs.forEach((def, i) => (next = insertLayer(next, [], def, i)));
    this.commit(next);
    this.selectedPath = defs.length > 0 ? [0] : null;
  }

  addSelectedCandidates(): void {
    const { probe, selected } = this.addService;
    if (!probe) return;
    const defs = probe.candidates.filter((c) => selected.has(c.name)).map((c) => candidateToLayer(probe, c));
    if (defs.length === 0) return;
    this.insertAtTop(defs);
    this.setAddService({ selected: new Set() });
    this.addPanel = null;
    this.notify(this.t("add.added", { n: defs.length }));
  }

  addUrlLayer(): void {
    const url = this.addUrl.url.trim();
    if (!url) return;
    const policy = urlPolicyError(url);
    if (policy) {
      this.setAddUrl({ error: policy });
      return;
    }
    this.insertAtTop([urlLayer(this.addUrl.type, url, this.addUrl.title)]);
    this.addUrl = { ...this.addUrl, url: "", title: "", error: "" };
    this.addPanel = null;
  }

  addGroup(): void {
    this.insertAtTop([{ type: "group", title: this.t("layers.newGroup"), children: [] }]);
  }

  selectBasemap(index: number | null): void {
    this.selectedBasemap = index;
  }

  /* ------------------------------- feedback ------------------------------- */

  notify(message: string): void {
    this.toast = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ""), 2400);
  }

  private async copy(text: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.notify(done);
    } catch {
      this.notify(this.t("export.copyFailed"));
    }
  }

  private download(): void {
    const blob = new Blob([serializeConfig(this.cfg)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = "config.map0.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  /* -------------------------------- import -------------------------------- */

  private importJson(text: string, source: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      this.notify(`${this.t("common.notJson")}: ${e instanceof Error ? e.message : e}`);
      return false;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.notify(this.t("common.notJson"));
      return false;
    }
    this.loadConfig(parsed as Map0Config);
    this.notify(this.t("export.loaded", { source }));
    return true;
  }

  private async importFromUrl(): Promise<void> {
    const url = this.importUrl.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (this.importJson(await res.text(), url)) this.importUrl = "";
    } catch (e) {
      this.notify(`${this.t("export.loadFailed")}: ${e instanceof Error ? e.message : e}`);
    }
  }

  private async importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    this.importJson(await file.text(), file.name);
    if (this.fileInput) this.fileInput.value = "";
  }

  /* -------------------------------- render -------------------------------- */

  protected override render(): TemplateResult {
    const t = this.t;
    const layerCount = flattenLayers(this.cfg).filter((r) => r.def.type !== "group").length;
    const counts: Partial<Record<SectionId, number>> = {
      basemaps: this.cfg.basemaps?.length ?? 0,
      layers: layerCount,
    };
    return html`
      <div class="shell">
        <nav class="sections" aria-label=${t("nav.label")}>
          ${SECTIONS.map(
            (id) => html`<button
              type="button"
              aria-current=${this.section === id ? "true" : "false"}
              @click=${() => (this.section = id)}
            >
              ${t(`nav.${id}`)}
              ${counts[id] !== undefined ? html`<span class="count">${counts[id]}</span>` : nothing}
            </button>`,
          )}
        </nav>
        <div class="form">${this.renderSection()}</div>
        <div class="preview">
          ${this.renderBar()}
          <map0-viewer
            loading="eager"
            theme=${this.theme ?? nothing}
            @map0:ready=${() => (this.previewReady = true)}
          ></map0-viewer>
          ${this.renderProblems()}
        </div>
      </div>
    `;
  }

  private renderSection(): TemplateResult {
    switch (this.section) {
      case "general":
        return renderGeneral(this);
      case "basemaps":
        return renderBasemaps(this);
      case "layers":
        return renderLayers(this);
      case "controls":
        return renderControls(this);
      case "search":
        return renderSearch(this);
      case "print":
        return renderPrint(this);
      case "theme":
        return renderTheme(this);
      case "export":
        return this.renderExport();
    }
  }

  private renderBar(): TemplateResult {
    const t = this.t;
    const v = this.validation;
    const warnings = v.warnings.length > 0 ? ` · ${t("status.warnings", { n: v.warnings.length })}` : "";
    const status = !v.valid
      ? html`<span class="status bad">${t("status.invalid", { n: v.errors.length })}${warnings}</span>`
      : this.dirty
        ? html`<span class="status pending">${t("status.pending")}${warnings}</span>`
        : html`<span class="status ok">${t("status.applied")}${warnings}</span>`;
    return html`
      <div class="bar">
        ${status}
        <span class="spacer" style="flex:1"></span>
        ${this.toast ? html`<span class="toast" role="status">${this.toast}</span>` : nothing}
        <button class="btn small" type="button" ?disabled=${this.history.length === 0} @click=${() => this.undo()}>
          ↶ ${t("common.undo")}
        </button>
        ${checkField({
          label: t("status.autoApply"),
          checked: this.autoApply,
          onChange: (on) => {
            this.autoApply = on;
            if (on) this.apply();
          },
        })}
        ${!this.autoApply || this.dirty
          ? html`<button class="btn small primary" type="button" ?disabled=${!this.dirty} @click=${() => this.apply()}>
              ${t("status.apply")}
            </button>`
          : nothing}
      </div>
    `;
  }

  private renderProblems(): TemplateResult {
    const v = this.validation;
    if (v.errors.length === 0 && v.warnings.length === 0) return html``;
    return html`
      <ul class="problems" aria-live="polite">
        ${v.errors.map(
          (e) => html`<li class="error"><span class="path">✗ ${e.path}</span><span class="message">${e.message}</span></li>`,
        )}
        ${v.warnings.map(
          (w) => html`<li class="warning"><span class="path">⚠ ${w.path}</span><span class="message">${w.message}</span></li>`,
        )}
      </ul>
    `;
  }

  private renderExport(): TemplateResult {
    const t = this.t;
    const json = this.jsonDraft ?? serializeConfig(this.cfg);
    return html`
      <section class="block">
        <h3>${t("export.title")}</h3>
        <p class="intro">${t("export.intro")}</p>
        <div class="toolbar">
          <button class="btn primary" type="button" @click=${() => void this.copy(serializeConfig(this.cfg), t("export.copied"))}>
            ${t("export.copyJson")}
          </button>
          <button class="btn" type="button" @click=${() => this.download()}>${t("export.download")}</button>
          <button
            class="btn"
            type="button"
            @click=${() => void this.copy(embedSnippet(this.cfg, this.scriptUrl), t("export.copiedEmbed"))}
          >
            ${t("export.copyEmbed")}
          </button>
          <a class="btn" href=${playgroundUrl(this.cfg, this.playgroundHref.replace(/\/playground\/?$/, ""))} target="_blank" rel="noopener">
            ${t("export.playground")} ↗
          </a>
        </div>
        ${textareaField({
          label: t("export.json"),
          value: json,
          rows: 22,
          mono: true,
          help: t("export.jsonHelp"),
          onCommit: (v) => {
            this.jsonDraft = v;
          },
        })}
        ${this.jsonDraft !== null && this.jsonDraft !== serializeConfig(this.cfg)
          ? html`<div class="toolbar">
              <button class="btn primary" type="button" @click=${() => this.importJson(this.jsonDraft ?? "", "JSON")}>
                ${t("export.useJson")}
              </button>
              <button class="btn" type="button" @click=${() => (this.jsonDraft = null)}>${t("common.cancel")}</button>
            </div>`
          : nothing}
      </section>
      <section class="block">
        <h3>${t("export.importTitle")}</h3>
        <form
          class="toolbar"
          @submit=${(e: Event) => {
            e.preventDefault();
            void this.importFromUrl();
          }}
        >
          <input
            type="url"
            style="flex:1"
            aria-label="URL"
            placeholder="https://…/config.map0.json"
            .value=${this.importUrl}
            @input=${(e: Event) => (this.importUrl = (e.target as HTMLInputElement).value)}
          />
          <button class="btn" type="submit" ?disabled=${!this.importUrl.trim()}>${t("export.loadUrl")}</button>
        </form>
        <div class="toolbar">
          <button class="btn" type="button" @click=${() => this.fileInput?.click()}>${t("export.openFile")}</button>
          <input
            class="sr-only"
            type="file"
            accept=".json,application/json"
            @change=${(e: Event) => void this.importFile((e.target as HTMLInputElement).files?.[0])}
          />
          <span class="spacer"></span>
          <button class="btn" type="button" @click=${() => this.reset("example")}>${t("export.resetExample")}</button>
          <button class="btn" type="button" @click=${() => this.reset("blank")}>${t("export.resetBlank")}</button>
        </div>
        <p class="note">
          ${this.restoredDraft ? t("export.draftRestored") : t("export.draftNote")}
          ${this.storageKey
            ? html` <button class="btn small" type="button" @click=${() => this.discardDraft()}>${t("export.discardDraft")}</button>`
            : nothing}
        </p>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "map0-configurator": Map0Configurator;
  }
}
