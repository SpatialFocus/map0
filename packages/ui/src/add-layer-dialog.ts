import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import {
  declaredGeoJsonCrs,
  isWgs84Code,
  loadGeoFile,
  readWmsCapabilities,
  readWmtsCapabilities,
  wmsLayerFromCandidate,
  wmtsLayerFromCandidate,
  type Map0Core,
  type ServiceLayerCandidate,
  type Translate,
  type WmsCapabilities,
  type WmtsCapabilities,
} from "@map0/core";
import { urlPolicyError, type GeoJsonLayerDef, type LayerDef } from "@map0/schema";
import { trapFocus } from "./focus-trap.js";

/** a layer the service offers, plus whether the user ticked it */
type Candidate = ServiceLayerCandidate & { selected: boolean };

type ServiceKind = "wms" | "wmts" | "geojson";

const KIND_LABELS: Record<ServiceKind, string> = { wms: "WMS", wmts: "WMTS", geojson: "GeoJSON" };

/** what the file picker offers — extensions for every OS, MIME types for pickers that filter by type */
const FILE_ACCEPT =
  ".geojson,.json,.kml,.gpx,application/geo+json,application/json," +
  "application/vnd.google-earth.kml+xml,application/gpx+xml";

/**
 * "Add layer" dialog (F3.1, F3.2, D-05): paste a WMS/WMTS URL and pick layers
 * from its capabilities (parsed by @camptocamp/ogc-client), paste a GeoJSON
 * URL, or pick GeoJSON/KML/GPX files from the device — the phone's way of
 * dropping a file on the map. Renders into the host's shadow tree (no own
 * shadow root) so panel styles apply.
 */
export class Map0AddLayerDialog extends LitElement {
  @property({ attribute: false }) core?: Map0Core;
  @property({ attribute: false }) t: Translate = (k) => k;

  @state() private url = "";
  @state() private layerTitle = "";
  @state() private service: ServiceKind = "wms";
  @state() private loading = false;
  @state() private error = "";
  @state() private candidates: Candidate[] = [];
  @state() private filter = "";
  @query("input[type=file]") private fileInput?: HTMLInputElement;
  /** the parsed service the candidates came from — its URL and info format go into the layers */
  private caps: WmsCapabilities | WmtsCapabilities | undefined;
  private loadSeq = 0;

  private releaseFocus?: () => void;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override firstUpdated(): void {
    this.releaseFocus = trapFocus(this, () => this.close());
  }

  override disconnectedCallback(): void {
    this.loadSeq++;
    super.disconnectedCallback();
    this.releaseFocus?.();
  }

  private close(): void {
    this.loadSeq++;
    this.dispatchEvent(new CustomEvent("close"));
  }

  private async load(): Promise<void> {
    const url = this.url.trim();
    if (!url) return;
    const service = this.service;
    const seq = ++this.loadSeq;
    this.loading = true;
    this.error = "";
    this.candidates = [];
    try {
      /* capabilities parsing (and the CRS inheritance it corrects) lives in the
         core, shared with the configurator — see core/capabilities.ts */
      const caps = service === "wms" ? await readWmsCapabilities(url) : await readWmtsCapabilities(url);
      if (seq !== this.loadSeq) return;
      this.caps = caps;
      this.candidates = caps.candidates.map((c) => ({ ...c, selected: false }));
      if (caps.candidates.length === 0) this.error = this.t("addLayer.empty");
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.error = `${this.t("addLayer.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      if (seq === this.loadSeq) this.loading = false;
    }
  }

  private async add(): Promise<void> {
    const caps = this.caps;
    if (!this.core || this.loading || !caps) return;
    this.loading = true;
    const seq = ++this.loadSeq;
    const core = this.core;
    this.error = "";
    try {
      for (const c of this.candidates.filter((c) => c.selected)) {
        const def: LayerDef = caps.kind === "wms" ? wmsLayerFromCandidate(caps, c) : wmtsLayerFromCandidate(caps, c);
        const id = await core.addLayer(def as Exclude<LayerDef, { type: "group" }>);
        if (seq !== this.loadSeq) return;
        if (!id) throw new Error(this.t("layers.error"));
        c.selected = false;
      }
      this.close();
    } catch (e) {
      if (seq === this.loadSeq) this.error = `${this.t("addLayer.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      if (seq === this.loadSeq) this.loading = false;
    }
  }

  private resetCandidates(): void {
    this.loadSeq++;
    this.candidates = [];
    this.caps = undefined;
    this.error = "";
    this.loading = false;
  }

  /* ------------------------------ GeoJSON by URL ----------------------------- */

  /**
   * The layer keeps the URL as its data — MapLibre fetches it, and the layer
   * can travel in a share link. The fetch here only finds out what is there,
   * so a typo, a CORS refusal or an HTML error page is reported in the dialog
   * instead of as a silently empty layer. A legacy `crs` member in the answer
   * becomes the layer's `crs`, which the URL form of `data` cannot carry.
   */
  private async addGeoJsonUrl(): Promise<void> {
    if (!this.core || this.loading) return;
    const core = this.core;
    const url = this.url.trim();
    if (!url) return;
    const policy = urlPolicyError(url);
    if (policy) {
      this.error = policy;
      return;
    }
    this.loading = true;
    const seq = ++this.loadSeq;
    this.error = "";
    try {
      const geo = await loadGeoFile();
      if (seq !== this.loadSeq) return;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      const resolved = new URL(url, location.href);
      const lastSegment = resolved.pathname.split("/").pop() ?? "";
      let fileName = lastSegment;
      try {
        fileName = decodeURIComponent(lastSegment);
      } catch {
        /* a malformed %-sequence: the raw segment still makes a title */
      }
      let parsed;
      try {
        parsed = geo.parseGeoJsonText(fileName || url, await res.text());
      } catch (e) {
        throw new Error(`${this.t("addLayer.notGeoJson")} (${e instanceof Error ? e.message : e})`);
      }
      const declared = declaredGeoJsonCrs(parsed);
      if (seq !== this.loadSeq) return;
      const def: GeoJsonLayerDef = {
        type: "geojson",
        title: this.layerTitle.trim() || geo.titleFromFileName(fileName) || resolved.hostname,
        data: url,
        ...(declared && !isWgs84Code(declared) ? { crs: declared } : {}),
      };
      const id = await core.addLayer(def);
      if (seq !== this.loadSeq) return;
      if (!id) throw new Error(this.t("layers.error"));
      await core.zoomToLayer(id);
      if (seq !== this.loadSeq) return;
      this.close();
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.error = `${this.t("addLayer.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      if (seq === this.loadSeq) this.loading = false;
    }
  }

  /* --------------------------- files from the device -------------------------- */

  private async addFiles(files: File[]): Promise<void> {
    if (!this.core || files.length === 0) return;
    this.loading = true;
    this.error = "";
    try {
      const { importGeoFiles } = await import("./file-import.js");
      const { added, errors } = await importGeoFiles(this.core, files, this.t);
      /* stay open when something went wrong, so the message can be read */
      if (errors.length > 0) this.error = errors.join("\n");
      else if (added.length > 0) this.close();
    } finally {
      this.loading = false;
      if (this.fileInput) this.fileInput.value = ""; // picking the same file again must fire `change`
    }
  }

  /* --------------------------------- render --------------------------------- */

  protected override render(): TemplateResult {
    const t = this.t;
    const selectedCount = this.candidates.filter((c) => c.selected).length;
    const isFile = this.service === "geojson";
    return html`
      <div
        class="dialog-backdrop"
        @click=${(e: Event) => e.target === e.currentTarget && this.close()}
      >
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${t("addLayer.title")}>
          <div class="dialog-header">
            <span>${t("addLayer.title")}</span>
            <button class="icon-btn" @click=${this.close} aria-label=${t("popup.close")}>✕</button>
          </div>
          <div class="dialog-body">
            <p class="dialog-intro">${isFile ? t("addLayer.introFile") : t("addLayer.intro")}</p>
            <div class="service-toggle" role="radiogroup" aria-label="Service">
              ${(["wms", "wmts", "geojson"] as const).map(
                (kind) => html`
                  <button
                    type="button"
                    role="radio"
                    aria-checked=${this.service === kind ? "true" : "false"}
                    ?data-active=${this.service === kind}
                    @click=${() => {
                      this.service = kind;
                      this.resetCandidates();
                    }}
                  >
                    ${KIND_LABELS[kind]}
                  </button>
                `,
              )}
            </div>
            ${isFile ? this.renderFileKind() : this.renderServiceKind()}
          </div>
          <div class="dialog-footer">
            <button class="btn" @click=${this.close}>${t("addLayer.cancel")}</button>
            ${isFile
              ? nothing
              : html`<button
                  class="btn btn-primary"
                  ?disabled=${selectedCount === 0 || this.loading}
                  @click=${() => void this.add()}
                >
                  ${t("addLayer.add")}${selectedCount > 0 ? ` (${selectedCount})` : ""}
                </button>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderServiceKind(): TemplateResult {
    const t = this.t;
    const filtered = this.filter
      ? this.candidates.filter((c) =>
          `${c.title} ${c.name}`.toLowerCase().includes(this.filter.toLowerCase()),
        )
      : this.candidates;
    return html`
      <form
        class="url-row"
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.load();
        }}
      >
        <input
          type="url"
          required
          placeholder="https://…/geoserver/ows"
          .value=${this.url}
          @input=${(e: Event) => {
            this.url = (e.target as HTMLInputElement).value;
            this.resetCandidates();
          }}
        />
        <button type="submit" ?disabled=${this.loading}>${t("addLayer.load")}</button>
      </form>
      ${this.loading ? html`<p class="dialog-note">${t("addLayer.loading")}</p>` : nothing}
      ${this.error ? html`<p class="dialog-error" role="alert">${this.error}</p>` : nothing}
      ${this.candidates.length > 15
        ? html`<input
            class="list-filter"
            type="search"
            placeholder="Filter…"
            .value=${this.filter}
            @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          />`
        : nothing}
      ${filtered.length > 0
        ? html`<div class="add-list">
            ${filtered.map(
              (c) => html`
                <label class="add-row">
                  <input
                    type="checkbox"
                    .checked=${c.selected}
                    @change=${(e: Event) => {
                      c.selected = (e.target as HTMLInputElement).checked;
                      this.requestUpdate();
                    }}
                  />
                  <span class="add-row-text">
                    <span class="add-row-title">${c.title}</span>
                    ${c.has3857
                      ? nothing
                      : html`<span class="add-row-warn">⚠ ${t("addLayer.no3857")}</span>`}
                  </span>
                </label>
              `,
            )}
          </div>`
        : nothing}
    `;
  }

  private renderFileKind(): TemplateResult {
    const t = this.t;
    /* the URL field is type="text", not "url": the policy allows relative URLs
       (/data/x.geojson), which the browser's url validation would refuse before
       we ever saw them — urlPolicyError() is the check that applies */
    return html`
      <form
        class="url-row"
        @submit=${(e: Event) => {
          e.preventDefault();
          void this.addGeoJsonUrl();
        }}
      >
        <input
          type="text"
          inputmode="url"
          spellcheck="false"
          required
          placeholder="https://…/data.geojson"
          .value=${this.url}
          @input=${(e: Event) => {
            this.url = (e.target as HTMLInputElement).value;
            this.resetCandidates();
          }}
        />
        <button type="submit" ?disabled=${this.loading}>${t("addLayer.add")}</button>
      </form>
      <label class="form-row title-row">
        <span>${t("addLayer.titleLabel")}</span>
        <input
          type="text"
          .value=${this.layerTitle}
          @input=${(e: Event) => (this.layerTitle = (e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="file-row">
        <span class="dialog-note">${t("addLayer.fromDevice")}</span>
        <input
          type="file"
          hidden
          multiple
          accept=${FILE_ACCEPT}
          @change=${(e: Event) => {
            void this.addFiles(Array.from((e.target as HTMLInputElement).files ?? []));
          }}
        />
        <button
          type="button"
          class="btn"
          ?disabled=${this.loading}
          @click=${() => this.fileInput?.click()}
        >
          ${t("addLayer.chooseFiles")}
        </button>
      </div>
      ${this.loading ? html`<p class="dialog-note">${t("addLayer.loadingData")}</p>` : nothing}
      ${this.error ? html`<p class="dialog-error" role="alert">${this.error}</p>` : nothing}
    `;
  }
}

if (!customElements.get("map0-add-layer")) {
  customElements.define("map0-add-layer", Map0AddLayerDialog);
}
