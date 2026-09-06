import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, query, state } from "lit/decorators.js";
import type { Translate } from "@map0/core";

/* rest heights as a share of the map — mirrored by `.sheet` in styles.ts */
const COLLAPSED = 0.45;
const EXPANDED = 0.9;
/** the expanded sheet always leaves this much of the map (its top controls) visible */
const TOP_GAP = 60;
/** pointer travel before a press on the header counts as a drag rather than a tap */
const DRAG_SLOP = 6;
/** matches the transform transition in styles.ts — the element is removed after it */
const EXIT_MS = 240;

const reducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Feature info as a docked bottom sheet (F5.5). The viewer renders results in
 * here instead of an anchored MapLibre popup when it is narrower than 640 px
 * (the decision is the viewer's — this element is width-agnostic). `content` is
 * the same sanitized node `buildPopupContent()` hands to the popup, so both
 * containers show identical markup.
 *
 * Non-modal on purpose: the map above the sheet stays usable, so focus is moved
 * in but not trapped. Escape, the close button, dragging the header down, or a
 * tap on empty map (the viewer's part, via `close()`) close it; the handle
 * toggles between the collapsed and the expanded rest height.
 *
 * Renders into the host's shadow tree (no own shadow root) so the component
 * styles apply — same pattern as the dialogs.
 */
export class Map0BottomSheet extends LitElement {
  @property({ attribute: false }) content?: HTMLElement;
  /** dialog name for assistive tech — the layer title(s) the results belong to */
  @property({ attribute: false }) label = "";
  @property({ attribute: false }) t: Translate = (k) => k;

  @state() private expanded = false;
  @state() private closing = false;
  /** live height while the header is being dragged; undefined = a CSS rest height */
  @state() private dragHeight?: number;

  @query(".sheet") private sheetEl?: HTMLElement;
  @query(".sheet-body") private bodyEl?: HTMLElement;

  private drag?: { pointerId: number; startY: number; startHeight: number; moved: boolean };
  /* the click a drag ends with must not also toggle or close */
  private swallowClick = false;
  private exitTimer?: ReturnType<typeof setTimeout>;
  private root?: Node;

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    /* Escape anywhere in the viewer — the map canvas included — closes the
       sheet. The search field and the modal dialogs stop their own Escape, so
       this only sees the key when nothing closer to the user claimed it. */
    this.root = this.getRootNode();
    this.root.addEventListener("keydown", this.onRootKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.root?.removeEventListener("keydown", this.onRootKeydown);
    this.root = undefined;
    clearTimeout(this.exitTimer);
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has("content")) return;
    /* a fresh answer — the next tap, or the viewer crossing the breakpoint —
       starts collapsed so the new highlight stays in view, and takes over a
       sheet that was still sliding out for the previous one */
    this.expanded = false;
    this.closing = false;
    clearTimeout(this.exitTimer);
  }

  protected override updated(changed: PropertyValues): void {
    if (!changed.has("content")) return;
    if (this.bodyEl) this.bodyEl.scrollTop = 0;
    /* focus the dialog itself: announced with its label, nothing pressed by accident */
    this.sheetEl?.focus({ preventScroll: true });
  }

  /* --------------------------------- sizing -------------------------------- */

  private stageHeight(): number {
    return this.parentElement?.clientHeight ?? 0;
  }

  private expandedHeight(stage: number): number {
    return Math.min(stage * EXPANDED, stage - TOP_GAP);
  }

  /* ---------------------------------- drag --------------------------------- */

  private onPointerDown = (e: PointerEvent): void => {
    if (this.closing || !this.sheetEl || (e.pointerType === "mouse" && e.button !== 0)) return;
    this.swallowClick = false;
    this.drag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: this.sheetEl.offsetHeight,
      moved: false,
    };
  };

  private onPointerMove = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    /* a mouse released off the header before this became a drag never sent us
       its pointerup (touches are captured implicitly and always do): the press
       is over, this hover must not move the sheet */
    if (e.buttons === 0) {
      this.drag = undefined;
      return;
    }
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < DRAG_SLOP) return;
      d.moved = true;
      /* captured only once it is a drag: a plain tap keeps its click on the button */
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const max = this.expandedHeight(this.stageHeight());
    this.dragHeight = Math.max(0, Math.min(max, d.startHeight - dy));
  };

  private onPointerEnd = (e: PointerEvent): void => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = undefined;
    if (!d.moved) return; // a tap — the buttons' click handlers take it from here
    this.swallowClick = true;
    const height = this.dragHeight ?? d.startHeight;
    this.dragHeight = undefined;
    const stage = this.stageHeight();
    const collapsed = stage * COLLAPSED;
    if (height < collapsed * 0.6) {
      this.close();
      return;
    }
    /* snap to whichever rest height is nearer */
    this.expanded = Math.abs(height - this.expandedHeight(stage)) < Math.abs(height - collapsed);
  };

  /* --------------------------------- events -------------------------------- */

  private onHandleClick = (): void => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    this.expanded = !this.expanded;
  };

  private onCloseClick = (): void => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    this.close();
  };

  private onRootKeydown = (e: Event): void => {
    const key = (e as KeyboardEvent).key;
    if (key !== "Escape" || e.defaultPrevented) return;
    this.close();
  };

  /**
   * Slide out, then tell the viewer to remove the element with a `close` event
   * (at once under reduced motion). The user's exits end up here — and so does
   * the viewer when a tap on empty map or the measure tool puts the sheet away,
   * so every exit looks the same.
   */
  close(): void {
    if (this.closing) return;
    if (reducedMotion()) {
      this.dispatchEvent(new CustomEvent("close"));
      return;
    }
    this.closing = true;
    this.exitTimer = setTimeout(() => this.dispatchEvent(new CustomEvent("close")), EXIT_MS);
  }

  protected override render(): TemplateResult {
    const t = this.t;
    return html`
      <div
        class="sheet"
        role="dialog"
        aria-label=${this.label}
        tabindex="-1"
        ?data-expanded=${this.expanded}
        ?data-dragging=${this.dragHeight !== undefined}
        ?data-closing=${this.closing}
        style=${this.dragHeight !== undefined ? `height:${this.dragHeight}px` : nothing}
      >
        <div
          class="sheet-header"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerEnd}
          @pointercancel=${this.onPointerEnd}
        >
          <button
            type="button"
            class="sheet-handle"
            aria-expanded=${this.expanded ? "true" : "false"}
            aria-label=${t(this.expanded ? "popup.collapse" : "popup.expand")}
            @click=${this.onHandleClick}
          >
            <span class="sheet-grip" aria-hidden="true"></span>
          </button>
          <button
            type="button"
            class="icon-btn sheet-close"
            aria-label=${t("popup.close")}
            title=${t("popup.close")}
            @click=${this.onCloseClick}
          >
            ✕
          </button>
        </div>
        <div class="sheet-body">${this.content}</div>
      </div>
    `;
  }
}

if (!customElements.get("map0-bottom-sheet")) {
  customElements.define("map0-bottom-sheet", Map0BottomSheet);
}
