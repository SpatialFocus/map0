import { LitElement, type PropertyValues, type TemplateResult } from "lit";
import { type Map0Config, type Map0Core } from "@map0/core";
/**
 * `<map0-viewer>` — the map0 web component.
 *
 * Config sources (first match wins):
 *  1. `config` property (JS object)
 *  2. `config-src` attribute (URL)
 *  3. inline `<script type="application/json">` child
 */
export declare class Map0Viewer extends LitElement {
    static styles: import("lit").CSSResult[];
    config?: Map0Config;
    configSrc?: string;
    private _errors;
    private _fatal;
    private _layers;
    private _basemapId;
    private _tocOpen;
    private _groupCollapsed;
    private _ready;
    private mapEl?;
    private core?;
    private normalized?;
    private popup?;
    private unsubs;
    private initialized;
    /** imperative access to the running map (available after `map0:ready`) */
    get api(): Map0Core | undefined;
    protected firstUpdated(): void;
    protected updated(changed: PropertyValues): void;
    disconnectedCallback(): void;
    /** tear down and re-init (e.g. after assigning a new config) */
    reload(): void;
    private teardown;
    private emit;
    private loadRawConfig;
    private init;
    private applyTheme;
    private showPopup;
    protected render(): TemplateResult;
    private renderErrors;
    private renderToc;
    private renderNodes;
    private renderLayerRow;
    private renderBasemaps;
}
//# sourceMappingURL=map0-viewer.d.ts.map