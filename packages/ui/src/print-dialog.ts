import { LitElement, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import {
  collectAttributions,
  composePrint,
  computeScaleBar,
  renderMapImage,
  type Map0Core,
  type PrintLegendItem,
  type Translate,
} from "@map0/core";
import { trapFocus } from "./focus-trap.js";

const SIZES: Record<string, { w: number; h: number } | null> = {
  current: null,
  a4l: { w: 1123, h: 794 },
  a4p: { w: 794, h: 1123 },
};

/** Print & export dialog (F7, D-04): client-side PNG / print window. */
export class Map0PrintDialog extends LitElement {
  @property({ attribute: false }) core?: Map0Core;
  @property({ attribute: false }) t: Translate = (k) => k;

  @state() private title_ = "";
  @state() private size: keyof typeof SIZES = "current";
  @state() private dpi = 150;
  @state() private includeLegend = true;
  @state() private busy = false;
  @state() private error = "";

  private releaseFocus?: () => void;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.title_ = this.core?.config.meta.title ?? "";
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

  private async compose(): Promise<HTMLCanvasElement> {
    const core = this.core!;
    const container = core.map.getContainer();
    const size = SIZES[this.size] ?? { w: container.clientWidth, h: container.clientHeight };
    const mapCanvas = await renderMapImage(core.map, {
      width: size.w,
      height: size.h,
      dpi: this.dpi,
    });
    const legendItems: PrintLegendItem[] = this.includeLegend
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
    });
  }

  private async run(mode: "png" | "print"): Promise<void> {
    if (!this.core || this.busy) return;
    this.busy = true;
    this.error = "";
    try {
      const canvas = await this.compose();
      if (mode === "png") {
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
        if (!blob) throw new Error("toBlob failed");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${(this.title_ || "map0").replace(/[^\wäöüß-]+/gi, "-").toLowerCase()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      } else {
        const win = window.open("", "_blank");
        if (!win) throw new Error("popup blocked");
        win.document.write(
          `<!doctype html><title>${this.title_ || "map0"}</title><style>body{margin:0}img{max-width:100%}</style><img src="${canvas.toDataURL("image/png")}" onload="setTimeout(()=>{window.print()},150)">`,
        );
        win.document.close();
      }
      this.close();
    } catch (e) {
      this.error = `${this.t("print.failed")}: ${e instanceof Error ? e.message : e}`;
    } finally {
      this.busy = false;
    }
  }

  protected override render(): TemplateResult {
    const t = this.t;
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
                @change=${(e: Event) => (this.size = (e.target as HTMLSelectElement).value)}
              >
                <option value="current">${t("print.size.current")}</option>
                <option value="a4l">${t("print.size.a4l")}</option>
                <option value="a4p">${t("print.size.a4p")}</option>
              </select>
            </label>
            <label class="form-row">
              <span>${t("print.dpi")}</span>
              <select
                .value=${String(this.dpi)}
                @change=${(e: Event) => (this.dpi = Number((e.target as HTMLSelectElement).value))}
              >
                <option value="96">96 dpi</option>
                <option value="150">150 dpi</option>
                <option value="300">300 dpi</option>
              </select>
            </label>
            <label class="form-check">
              <input
                type="checkbox"
                .checked=${this.includeLegend}
                @change=${(e: Event) =>
                  (this.includeLegend = (e.target as HTMLInputElement).checked)}
              />
              <span>${t("print.includeLegend")}</span>
            </label>
            ${this.busy ? html`<p class="dialog-note">${t("print.rendering")}</p>` : nothing}
            ${this.error ? html`<p class="dialog-error" role="alert">${this.error}</p>` : nothing}
          </div>
          <div class="dialog-footer">
            <button class="btn" @click=${this.close}>${t("addLayer.cancel")}</button>
            <button class="btn" ?disabled=${this.busy} @click=${() => void this.run("print")}>
              ${t("print.print")}
            </button>
            <button class="btn btn-primary" ?disabled=${this.busy} @click=${() => void this.run("png")}>
              ${t("print.png")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

if (!customElements.get("map0-print")) {
  customElements.define("map0-print", Map0PrintDialog);
}
