import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import {
  collectAttributions,
  composePrint,
  computeScaleBar,
  exportPdf,
  mmToPx,
  PAPER,
  renderMapImage,
  type Map0Core,
  type PaperSize,
  type PrintLegendItem,
  type Translate,
} from "@map0/core";
import { trapFocus } from "./focus-trap.js";

/** Print & export dialog (F7, D-04): client-side PNG, PDF and browser print. */
export class Map0PrintDialog extends LitElement {
  @property({ attribute: false }) core?: Map0Core;
  @property({ attribute: false }) t: Translate = (k) => k;

  @state() private title_ = "";
  @state() private size: PaperSize = "current";
  @state() private dpi = 150;
  @state() private includeLegend = true;
  @state() private busy: "png" | "pdf" | "print" | null = null;
  @state() private error = "";

  private releaseFocus?: () => void;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.title_ = this.core?.config.meta.title ?? "";
    const config = this.core?.config.print;
    if (config) {
      this.size = config.sizes[0] ?? "current";
      this.dpi = config.dpi.includes(150) ? 150 : (config.dpi[0] ?? 96);
    }
  }

  protected override firstUpdated(): void {
    this.releaseFocus = trapFocus(this, () => this.close());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.releaseFocus?.();
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent("close"));
  }

  private get printConfig() {
    return this.core!.config.print;
  }

  /** render the map at the target size, then draw the sheet around it */
  private async compose(): Promise<HTMLCanvasElement> {
    const core = this.core!;
    const container = core.map.getContainer();
    const size =
      this.size === "current"
        ? { w: container.clientWidth, h: container.clientHeight }
        : { w: mmToPx(PAPER[this.size][0]), h: mmToPx(PAPER[this.size][1]) };

    const mapCanvas = await renderMapImage(core.map, {
      width: size.w,
      height: size.h,
      dpi: this.dpi,
    });
    const legendItems: PrintLegendItem[] =
      this.includeLegend && this.printConfig.elements.includes("legend")
        ? core.layers.state.value
            .filter((l) => l.visible && l.inZoomRange && l.legend)
            .map((l) => ({ title: l.title, legend: l.legend! }))
        : [];
    return composePrint(mapCanvas, {
      title: this.title_ || undefined,
      attribution: collectAttributions(core.map),
      scale: computeScaleBar(core.map),
      dpi: this.dpi,
      dateLabel: new Date().toLocaleDateString(core.locale === "de" ? "de-AT" : "en-GB"),
      legendItems,
      elements: this.printConfig.elements,
    });
  }

  private fileName(extension: string): string {
    const base = (this.title_ || "map0").replace(/[^\wäöüß-]+/gi, "-").toLowerCase();
    return `${base}.${extension}`;
  }

  private download(blob: Blob, extension: string): void {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = this.fileName(extension);
    a.style.display = "none";
    /* the anchor has to be in the document: a detached one is ignored for
       multi-megabyte blobs in Chrome, and the click silently does nothing */
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  private async run(mode: "png" | "pdf" | "print"): Promise<void> {
    if (!this.core || this.busy) return;
    this.busy = mode;
    this.error = "";
    try {
      const sheet = await this.compose();
      if (mode === "png") {
        const blob = await new Promise<Blob | null>((r) => sheet.toBlob(r, "image/png"));
        if (!blob) throw new Error("toBlob failed");
        this.download(blob, "png");
      } else if (mode === "pdf") {
        this.download(
          await exportPdf(sheet, { paper: this.size, dpi: this.dpi, title: this.title_ }),
          "pdf",
        );
      } else {
        const win = window.open("", "_blank");
        if (!win) throw new Error("popup blocked");
        win.document.write(
          `<!doctype html><title>${this.title_ || "map0"}</title><style>body{margin:0}img{max-width:100%}</style><img src="${sheet.toDataURL("image/png")}" onload="setTimeout(()=>{window.print()},150)">`,
        );
        win.document.close();
      }
      this.close();
    } catch (e) {
      this.error = `${this.t("print.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.busy = null;
    }
  }

  protected override render(): TemplateResult {
    const t = this.t;
    const config = this.printConfig;
    const sizeLabel = (size: PaperSize): string =>
      size === "current" ? t("print.size.current") : size.replace("-landscape", " ↔").replace("-portrait", " ↕");
    return html`
      <div
        class="dialog-backdrop"
        @click=${(e: Event) => e.target === e.currentTarget && this.close()}
      >
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${t("print.title")}>
          <div class="dialog-header">
            <span>${t("print.title")}</span>
            <button class="icon-btn" @click=${this.close} aria-label=${t("popup.close")}>✕</button>
          </div>
          <div class="dialog-body">
            <label class="form-row">
              <span>${t("print.titleLabel")}</span>
              <input
                type="text"
                .value=${this.title_}
                @input=${(e: Event) => (this.title_ = (e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="form-row">
              <span>${t("print.size")}</span>
              <select
                .value=${this.size}
                @change=${(e: Event) => (this.size = (e.target as HTMLSelectElement).value as PaperSize)}
              >
                ${config.sizes.map((s) => html`<option value=${s}>${sizeLabel(s)}</option>`)}
              </select>
            </label>
            <label class="form-row">
              <span>${t("print.dpi")}</span>
              <select
                .value=${String(this.dpi)}
                @change=${(e: Event) => (this.dpi = Number((e.target as HTMLSelectElement).value))}
              >
                ${config.dpi.map((d) => html`<option value=${d}>${d} dpi</option>`)}
              </select>
            </label>
            ${config.elements.includes("legend")
              ? html`<label class="form-check">
                  <input
                    type="checkbox"
                    .checked=${this.includeLegend}
                    @change=${(e: Event) =>
                      (this.includeLegend = (e.target as HTMLInputElement).checked)}
                  />
                  <span>${t("print.includeLegend")}</span>
                </label>`
              : nothing}
            ${this.busy
              ? html`<p class="dialog-note">
                  ${this.busy === "pdf" ? t("print.buildingPdf") : t("print.rendering")}
                </p>`
              : nothing}
            ${this.error ? html`<p class="dialog-error" role="alert">${this.error}</p>` : nothing}
          </div>
          <div class="dialog-footer">
            <button class="btn" @click=${this.close}>${t("addLayer.cancel")}</button>
            <button class="btn" ?disabled=${!!this.busy} @click=${() => void this.run("print")}>
              ${t("print.print")}
            </button>
            ${config.formats.includes("png")
              ? html`<button class="btn" ?disabled=${!!this.busy} @click=${() => void this.run("png")}>
                  ${t("print.png")}
                </button>`
              : nothing}
            ${config.formats.includes("pdf")
              ? html`<button
                  class="btn btn-primary"
                  ?disabled=${!!this.busy}
                  @click=${() => void this.run("pdf")}
                >
                  ${t("print.pdf")}
                </button>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("map0-print")) {
  customElements.define("map0-print", Map0PrintDialog);
}
