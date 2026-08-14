import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { isMercatorCrs, type Map0Core, type Translate } from "@map0/core";
import type { LayerDef, WmsLayerDef, WmtsLayerDef } from "@map0/schema";

interface Candidate {
  name: string;
  title: string;
  abstract?: string;
  queryable: boolean;
  has3857: boolean;
  minZoom?: number;
  bounds?: [number, number, number, number];
  metadataUrl?: string;
  attribution?: string;
  selected: boolean;
}

/** WebMercator zoom for a WMS ScaleDenominator (OGC pixel size, 256px tiles). */
function scaleDenominatorToZoom(sd: number): number {
  return Math.max(0, Math.ceil(Math.log2(559082264.028 / sd)));
}

type ServiceKind = "wms" | "wmts";

/**
 * "Add layer" dialog (F3.1, D-05): paste a WMS URL, pick layers from its
 * capabilities (parsed by @camptocamp/ogc-client), add them at runtime.
 * Renders into the host's shadow tree (no own shadow root) so panel styles apply.
 */
export class Map0AddLayerDialog extends LitElement {
  @property({ attribute: false }) core?: Map0Core;
  @property({ attribute: false }) t: Translate = (k) => k;

  @state() private url = "";
  @state() private service: ServiceKind = "wms";
  @state() private loading = false;
  @state() private error = "";
  @state() private candidates: Candidate[] = [];
  @state() private filter = "";
  private infoFormat: string | undefined;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private async load(): Promise<void> {
    const url = this.url.trim();
    if (!url) return;
    this.loading = true;
    this.error = "";
    this.candidates = [];
    try {
      /* ogc-client parses XML in a base64-inlined blob worker — bundler-safe.
         (Do NOT call enableFallbackWithoutWorker: its handler module can be
         dropped by dep optimizers, leaving requests queued forever.) */
      const ogc = await import("@camptocamp/ogc-client");
      const found: Candidate[] =
        this.service === "wms"
          ? await this.loadWms(ogc, url)
          : await this.loadWmts(ogc, url);
      this.candidates = found;
      if (found.length === 0) this.error = this.t("addLayer.empty");
    } catch (e) {
      this.error = `${this.t("addLayer.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.loading = false;
    }
  }

  private async loadWms(
    ogc: typeof import("@camptocamp/ogc-client"),
    url: string,
  ): Promise<Candidate[]> {
    const endpoint = new ogc.WmsEndpoint(url);
    await endpoint.isReady();
    const infoFormats = endpoint.getServiceInfo()?.infoFormats ?? [];
    this.infoFormat = infoFormats.includes("application/json")
      ? "application/json"
      : infoFormats.find((f: string) => f.includes("json") || f.includes("html"));

    const found: Candidate[] = [];
    const walk = (nodes: Array<{ name?: string; children?: unknown[] }>): void => {
      for (const node of nodes ?? []) {
        if (node.name && !node.children?.length) {
          const full = endpoint.getLayerByName(node.name);
          const crs = full.availableCrs ?? [];
          const bbox = full.boundingBoxes?.["EPSG:4326"] ?? full.boundingBoxes?.["CRS:84"];
          found.push({
            name: node.name,
            title: full.title ?? node.name,
            abstract: full.abstract,
            queryable: full.queryable,
            /* unknown CRS list → benefit of the doubt (inheritance quirks) */
            has3857: crs.length === 0 || crs.some((c: string) => isMercatorCrs(c)),
            minZoom: full.maxScaleDenominator
              ? scaleDenominatorToZoom(full.maxScaleDenominator)
              : undefined,
            ...(bbox ? { bounds: bbox as [number, number, number, number] } : {}),
            metadataUrl: full.metadata?.[0]?.url,
            attribution: full.attribution?.title,
            selected: false,
          });
        }
        walk((node.children ?? []) as never);
      }
    };
    walk(endpoint.getLayers() as never);
    return found;
  }

  private async loadWmts(
    ogc: typeof import("@camptocamp/ogc-client"),
    url: string,
  ): Promise<Candidate[]> {
    const endpoint = new ogc.WmtsEndpoint(url);
    await endpoint.isReady();
    return endpoint.getLayers().map((layer) => ({
      name: layer.name,
      title: layer.name,
      queryable: false,
      has3857: layer.matrixSets.some((m) => isMercatorCrs(m.crs)),
      ...(layer.latLonBoundingBox
        ? { bounds: layer.latLonBoundingBox as [number, number, number, number] }
        : {}),
      selected: false,
    }));
  }

  /** base URL without WMS operation params (they are re-added per request) */
  private cleanedUrl(): string {
    try {
      const u = new URL(this.url.trim());
      for (const key of [...u.searchParams.keys()]) {
        if (["service", "request", "version"].includes(key.toLowerCase())) {
          u.searchParams.delete(key);
        }
      }
      return u.toString().replace(/\?$/, "");
    } catch {
      return this.url.trim();
    }
  }

  private async add(): Promise<void> {
    if (!this.core) return;
    const url = this.service === "wms" ? this.cleanedUrl() : this.url.trim();
    for (const c of this.candidates.filter((c) => c.selected)) {
      const common = {
        title: c.title,
        ...(c.minZoom !== undefined ? { minZoom: c.minZoom } : {}),
        ...(c.bounds ? { bounds: c.bounds } : {}),
        ...(c.metadataUrl ? { metadata: { url: c.metadataUrl } } : {}),
        ...(c.attribution ? { attribution: c.attribution } : {}),
      };
      const def: LayerDef =
        this.service === "wms"
          ? ({
              type: "wms",
              url,
              layers: c.name,
              ...(c.queryable ? { info: { format: this.infoFormat ?? "application/json" } } : {}),
              ...common,
            } satisfies WmsLayerDef)
          : ({ type: "wmts", url, layer: c.name, ...common } satisfies WmtsLayerDef);
      await this.core.addLayer(def as Exclude<LayerDef, { type: "group" }>);
    }
    this.close();
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const selectedCount = this.candidates.filter((c) => c.selected).length;
    const filtered = this.filter
      ? this.candidates.filter((c) =>
          `${c.title} ${c.name}`.toLowerCase().includes(this.filter.toLowerCase()),
        )
      : this.candidates;
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
            <p class="dialog-intro">${t("addLayer.intro")}</p>
            <div class="service-toggle" role="radiogroup" aria-label="Service">
              ${(["wms", "wmts"] as const).map(
                (kind) => html`
                  <button
                    type="button"
                    role="radio"
                    aria-checked=${this.service === kind ? "true" : "false"}
                    ?data-active=${this.service === kind}
                    @click=${() => {
                      this.service = kind;
                      this.candidates = [];
                      this.error = "";
                    }}
                  >
                    ${kind.toUpperCase()}
                  </button>
                `,
              )}
            </div>
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
                @input=${(e: Event) => (this.url = (e.target as HTMLInputElement).value)}
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
          </div>
          <div class="dialog-footer">
            <button class="btn" @click=${this.close}>${t("addLayer.cancel")}</button>
            <button class="btn btn-primary" ?disabled=${selectedCount === 0} @click=${() => void this.add()}>
              ${t("addLayer.add")}${selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("map0-add-layer")) {
  customElements.define("map0-add-layer", Map0AddLayerDialog);
}
