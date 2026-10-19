/**
 * The layers section: the tree with its toolbar, the two "add" panels (from a
 * service's capabilities, or a plain data URL) and the property form of the
 * selected node — common keys first, then what the layer type needs, then
 * feature info, style and clustering where they apply, and a raw JSON editor
 * for everything the form does not cover.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { FieldDef, LayerDef, PopupConfig } from "@map0/schema";
import {
  checkField,
  colorField,
  numberField,
  rangeField,
  section,
  segmented,
  selectField,
  textField,
  textFieldLazy,
  textareaField,
} from "./fields.js";
import type { CatalogKind } from "./catalog.js";
import { NO_DRAG, type AddPanel, type DropPosition, type Host } from "./host.js";
import { SERVICE_KINDS, URL_LAYER_TYPES, type ServiceKind, type UrlLayerType } from "./services.js";
import { MAX_CATEGORIES, SIMPLE_PRESETS, dataDrivenStyle, propertyNames, simplePreset } from "./style-presets.js";
import {
  duplicateLayer,
  flattenLayers,
  getLayer,
  getSiblings,
  indentLayer,
  isGroup,
  layerTypeLabel,
  moveLayer,
  outdentLayer,
  paramsToText,
  removeLayer,
  samePath,
  setKey,
  textToParams,
  updateLayer,
  type LayerPath,
} from "./state.js";

type Rec = Record<string, unknown>;

/** layer types rendered through the geojson pipeline: styled, clustered and queried by map0 itself */
const VECTOR_DATA: ReadonlySet<string> = new Set(["geojson", "geoparquet", "wfs", "ogcapi-features"]);

const SERVICE_PLACEHOLDERS: Record<ServiceKind, string> = {
  wms: "https://data.wien.gv.at/daten/geo",
  wmts: "https://…/WMTSCapabilities.xml",
  wfs: "https://…/geoserver/ows",
  "ogcapi-features": "https://…/ogcapi",
};

const URL_PLACEHOLDERS: Record<UrlLayerType, string> = {
  geojson: "https://…/data.geojson",
  geoparquet: "https://…/data.parquet",
  cog: "https://…/image.tif",
  vector: "https://…/tiles.json · {z}/{x}/{y}.pbf · pmtiles://…",
  raster: "https://…/{z}/{x}/{y}.png",
};

/* ---------------------------------- tree ---------------------------------- */

export function renderLayers(h: Host): TemplateResult {
  const { cfg, t } = h;
  const rows = flattenLayers(cfg);
  const sel = h.selectedPath;
  const selDef = sel ? getLayer(cfg, sel) : undefined;
  const panel = (which: Exclude<AddPanel, null>): void => h.setAddPanel(h.addPanel === which ? null : which);

  return html`
    ${section(
      t("layers.title"),
      html`
        <div class="toolbar">
          <button class="btn primary" type="button" @click=${() => panel("service")}>+ ${t("layers.addService")}</button>
          <button class="btn" type="button" @click=${() => panel("url")}>+ ${t("layers.addUrl")}</button>
          <button class="btn" type="button" @click=${() => panel("catalog")}>+ ${t("layers.addCatalog")}</button>
          <button class="btn" type="button" @click=${() => h.addGroup()}>+ ${t("layers.addGroup")}</button>
        </div>
        ${h.addPanel === "service"
          ? renderAddService(h)
          : h.addPanel === "url"
            ? renderAddUrl(h)
            : h.addPanel === "catalog"
              ? renderAddCatalog(h)
              : nothing}
        ${rows.length === 0
          ? html`<p class="empty">${t("layers.empty")}</p>`
          : html`<ul
              class="tree"
              role="listbox"
              aria-label=${t("layers.title")}
              @dragleave=${(e: DragEvent) => {
                /* leaving the list altogether clears the hint; moving between rows does not */
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null))
                  h.setDrag({ ...h.drag, over: null, position: null });
              }}
            >
              ${rows.map(
                (r) => html`<li
                  class="node ${samePath(r.path, sel) ? "selected" : ""}"
                  role="option"
                  aria-selected=${samePath(r.path, sel) ? "true" : "false"}
                  style="--depth:${r.depth}"
                  draggable="true"
                  ?data-dragging=${samePath(h.drag.from, r.path)}
                  data-drop=${samePath(h.drag.over, r.path) ? (h.drag.position ?? nothing) : nothing}
                  @click=${() => h.selectLayer(r.path)}
                  @dragstart=${(e: DragEvent) => {
                    e.dataTransfer?.setData("text/plain", JSON.stringify(r.path));
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                    h.setDrag({ from: r.path, over: null, position: null });
                  }}
                  @dragover=${(e: DragEvent) => {
                    if (!h.drag.from) return;
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                    const position = dropPosition(e, isGroup(r.def));
                    if (!samePath(h.drag.over, r.path) || h.drag.position !== position)
                      h.setDrag({ ...h.drag, over: r.path, position });
                  }}
                  @drop=${(e: DragEvent) => {
                    e.preventDefault();
                    const { from, position } = h.drag;
                    if (!from || !position) return;
                    const target = dropTarget(h, r.path, position);
                    h.dropLayer(target.parent, target.index);
                  }}
                  @dragend=${() => h.setDrag(NO_DRAG)}
                >
                  <span class="grip" aria-hidden="true">⋮⋮</span>
                  <span class="badge">${isGroup(r.def) ? t("layers.groupBadge") : layerTypeLabel(r.def.type)}</span>
                  <span class="name">${r.def.title || ("id" in r.def && r.def.id) || t("layers.untitled")}</span>
                  ${"visible" in r.def && r.def.visible === false ? html`<span class="tag">${t("layers.hidden")}</span>` : nothing}
                </li>`,
              )}
            </ul>`}
        ${rows.length > 1 ? html`<p class="note">${t("layers.dragHint")}</p>` : nothing}
        ${sel && selDef ? renderTreeToolbar(h, sel) : nothing}
      `,
      t("layers.intro"),
    )}
    ${sel && selDef ? renderLayerForm(h, sel, selDef) : nothing}
  `;
}

/** where over a row the pointer is: the middle third of a group row means "into it" */
function dropPosition(e: DragEvent, group: boolean): DropPosition {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
  if (group && y > 0.3 && y < 0.7) return "into";
  return y < 0.5 ? "before" : "after";
}

/** the list and index a drop on `path` at `position` means */
function dropTarget(h: Host, path: LayerPath, position: DropPosition): { parent: LayerPath; index: number } {
  const index = path[path.length - 1]!;
  if (position === "into") {
    const group = getLayer(h.cfg, path);
    return { parent: path, index: isGroup(group) ? group.children.length : 0 };
  }
  return { parent: path.slice(0, -1), index: position === "before" ? index : index + 1 };
}

function renderTreeToolbar(h: Host, sel: LayerPath): TemplateResult {
  const { cfg, t } = h;
  const siblings = getSiblings(cfg, sel) ?? [];
  const index = sel[sel.length - 1]!;
  const canIndent = index > 0 && isGroup(siblings[index - 1]);
  const apply = (result: { config: typeof cfg; path: LayerPath } | null): void => {
    if (!result) return;
    h.commit(result.config);
    h.selectLayer(result.path);
  };
  return html`
    <div class="toolbar">
      <button class="btn small" type="button" ?disabled=${index === 0} @click=${() => apply(moveLayer(cfg, sel, -1))}>↑ ${t("common.up")}</button>
      <button class="btn small" type="button" ?disabled=${index >= siblings.length - 1} @click=${() => apply(moveLayer(cfg, sel, 1))}>↓ ${t("common.down")}</button>
      <button class="btn small" type="button" ?disabled=${!canIndent} title=${t("layers.indentHelp")} @click=${() => apply(indentLayer(cfg, sel))}>→ ${t("layers.indent")}</button>
      <button class="btn small" type="button" ?disabled=${sel.length < 2} @click=${() => apply(outdentLayer(cfg, sel))}>← ${t("layers.outdent")}</button>
      <button class="btn small" type="button" @click=${() => h.commit(duplicateLayer(cfg, sel))}>${t("common.duplicate")}</button>
      <span class="spacer"></span>
      <button
        class="btn small danger"
        type="button"
        @click=${() => {
          h.commit(removeLayer(cfg, sel));
          h.selectLayer(null);
        }}
      >
        ${t("common.remove")}
      </button>
    </div>
  `;
}

/* ------------------------------- add panels ------------------------------- */

function renderAddService(h: Host): TemplateResult {
  const { t } = h;
  const a = h.addService;
  const probe = a.probe;
  const filter = a.filter.trim().toLowerCase();
  const visible =
    probe?.candidates.filter((c) => !filter || `${c.title} ${c.name}`.toLowerCase().includes(filter)) ?? [];
  const toggle = (name: string, on: boolean): void => {
    const next = new Set(a.selected);
    if (on) next.add(name);
    else next.delete(name);
    h.setAddService({ selected: next });
  };
  return html`
    <div class="panel">
      ${segmented({
        label: t("add.kind"),
        value: a.kind,
        options: SERVICE_KINDS.map((k) => ({ value: k, label: layerTypeLabel(k) })),
        onChange: (v) => h.setAddService({ kind: v as ServiceKind, probe: null, error: "", selected: new Set() }),
      })}
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          h.loadService();
        }}
      >
        <input
          type="url"
          required
          aria-label="URL"
          placeholder=${SERVICE_PLACEHOLDERS[a.kind]}
          .value=${a.url}
          @input=${(e: Event) => h.setAddService({ url: (e.target as HTMLInputElement).value })}
        />
        <button class="btn primary" type="submit" ?disabled=${a.loading}>${t("add.load")}</button>
      </form>
      <p class="note">${t(`add.hint.${a.kind}`)}</p>
      ${a.loading ? html`<p class="note">${t("add.loading")}</p>` : nothing}
      ${a.error ? html`<p class="error" role="alert">${a.error}</p>` : nothing}
      ${probe && probe.candidates.length > 0
        ? html`
            <p class="note">
              ${probe.serviceTitle ? html`<strong>${probe.serviceTitle}</strong> · ` : nothing}
              ${t("add.found", { n: probe.candidates.length })}
            </p>
            ${probe.candidates.length > 10
              ? html`<input
                  type="search"
                  placeholder=${t("add.filter")}
                  .value=${a.filter}
                  @input=${(e: Event) => h.setAddService({ filter: (e.target as HTMLInputElement).value })}
                />`
              : nothing}
            <ul class="candidates">
              ${visible.map(
                (c) => html`<li>
                  <label ?data-off=${!c.has3857}>
                    <input
                      type="checkbox"
                      ?disabled=${!c.has3857}
                      .checked=${a.selected.has(c.name)}
                      @change=${(e: Event) => toggle(c.name, (e.target as HTMLInputElement).checked)}
                    />
                    <span>${c.title}</span>
                    <span class="sub">
                      ${c.name}${!c.has3857 ? ` · ${t("add.no3857")}` : ""}${c.queryable && probe.kind === "wms" ? ` · ${t("add.queryable")}` : ""}
                    </span>
                  </label>
                </li>`,
              )}
            </ul>
            <div class="toolbar">
              <button
                class="btn small"
                type="button"
                @click=${() => h.setAddService({ selected: new Set(visible.filter((c) => c.has3857).map((c) => c.name)) })}
              >
                ${t("add.selectAll")}
              </button>
              <span class="spacer"></span>
              <button class="btn" type="button" @click=${() => h.setAddPanel(null)}>${t("common.cancel")}</button>
              <button class="btn primary" type="button" ?disabled=${a.selected.size === 0} @click=${() => h.addSelectedCandidates()}>
                ${t("add.addN", { n: a.selected.size })}
              </button>
            </div>
          `
        : nothing}
    </div>
  `;
}

const CATALOG_PLACEHOLDERS: Record<CatalogKind, string> = {
  csw: "https://…/geonetwork/srv/eng/csw",
  records: "https://…/collections/metadata",
};

function renderAddCatalog(h: Host): TemplateResult {
  const { t } = h;
  const a = h.addCatalog;
  return html`
    <div class="panel">
      ${segmented({
        label: t("catalog.kind"),
        value: a.kind,
        options: [
          { value: "csw", label: "CSW 2.0.2" },
          { value: "records", label: "OGC API Records" },
        ],
        onChange: (v) => h.setAddCatalog({ kind: v as CatalogKind, records: null, error: "" }),
      })}
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          h.searchCatalog();
        }}
      >
        <input
          type="url"
          required
          aria-label="URL"
          placeholder=${CATALOG_PLACEHOLDERS[a.kind]}
          .value=${a.url}
          @input=${(e: Event) => h.setAddCatalog({ url: (e.target as HTMLInputElement).value })}
        />
        <span></span>
        <input
          type="search"
          required
          aria-label=${t("catalog.query")}
          placeholder=${t("catalog.query")}
          .value=${a.query}
          @input=${(e: Event) => h.setAddCatalog({ query: (e.target as HTMLInputElement).value })}
        />
        <button class="btn primary" type="submit" ?disabled=${a.loading}>${t("catalog.search")}</button>
      </form>
      <p class="note">${t(`catalog.hint.${a.kind}`)}</p>
      ${a.loading ? html`<p class="note">${t("catalog.loading")}</p>` : nothing}
      ${a.error ? html`<p class="error" role="alert">${a.error}</p>` : nothing}
      ${a.records && a.records.length > 0
        ? html`
            <p class="note">${t("catalog.found", { n: a.records.length })}</p>
            <ul class="candidates">
              ${a.records.map(
                (r) => html`<li class="record">
                  <strong>${r.title}</strong>
                  ${r.abstract ? html`<span class="sub">${r.abstract.length > 180 ? `${r.abstract.slice(0, 180)}…` : r.abstract}</span>` : nothing}
                  ${r.links.length === 0
                    ? html`<span class="sub">${t("catalog.noLinks")}</span>`
                    : html`<span class="chips">
                        ${r.links.map(
                          (l) => html`<button class="btn small" type="button" title=${l.url} @click=${() => h.addFromCatalog(r, l)}>
                            + ${layerTypeLabel(l.kind)}${l.name ? `: ${l.name}` : ` (${t("catalog.pick")})`}
                          </button>`,
                        )}
                      </span>`}
                </li>`,
              )}
            </ul>
          `
        : nothing}
      <div class="toolbar">
        <span class="spacer"></span>
        <button class="btn" type="button" @click=${() => h.setAddPanel(null)}>${t("common.cancel")}</button>
      </div>
    </div>
  `;
}

function renderAddUrl(h: Host): TemplateResult {
  const { t } = h;
  const a = h.addUrl;
  return html`
    <div class="panel">
      ${selectField({
        label: t("common.type"),
        value: a.type,
        options: URL_LAYER_TYPES.map((k) => ({ value: k, label: layerTypeLabel(k) })),
        onChange: (v) => h.setAddUrl({ type: v as UrlLayerType, error: "" }),
      })}
      <p class="note">${t(`add.hint.${a.type}`)}</p>
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          h.addUrlLayer();
        }}
      >
        <input
          type="url"
          required
          aria-label="URL"
          placeholder=${URL_PLACEHOLDERS[a.type]}
          .value=${a.url}
          @input=${(e: Event) => h.setAddUrl({ url: (e.target as HTMLInputElement).value, error: "" })}
        />
        <button class="btn primary" type="submit">${t("common.add")}</button>
        <input
          type="text"
          aria-label=${t("common.title")}
          placeholder=${t("add.titleOptional")}
          .value=${a.title}
          @input=${(e: Event) => h.setAddUrl({ title: (e.target as HTMLInputElement).value })}
        />
        <button class="btn" type="button" @click=${() => h.setAddPanel(null)}>${t("common.cancel")}</button>
      </form>
      ${a.error ? html`<p class="error" role="alert">${a.error}</p>` : nothing}
    </div>
  `;
}

/* ------------------------------- layer form ------------------------------- */

type Setter = (key: string, value: unknown) => void;

function renderLayerForm(h: Host, path: LayerPath, def: LayerDef): TemplateResult {
  const { cfg, t } = h;
  const upd = (fn: (d: LayerDef) => LayerDef): void => h.commit(updateLayer(cfg, path, fn));
  const set: Setter = (key, value) => upd((d) => setKey(d, key, value));
  const rec = def as unknown as Rec;

  if (isGroup(def)) {
    return section(
      `${t("layers.groupBadge")} · ${def.title || t("layers.untitled")}`,
      html`
        ${textField({ label: t("common.title"), value: def.title, onInput: (v) => set("title", v) })}
        ${checkField({ label: t("layer.collapsed"), help: t("layer.collapsedHelp"), checked: def.collapsed === true, onChange: (on) => set("collapsed", on ? true : undefined) })}
        ${rawJson(h, def, upd)}
      `,
    );
  }

  const legendMode =
    def.legend === false
      ? "none"
      : Array.isArray(def.legend)
        ? "entries"
        : typeof def.legend === "string" && def.legend !== "auto"
          ? "image"
          : "auto";

  return html`
    ${section(
      `${layerTypeLabel(def.type)} · ${def.title || t("layers.untitled")}`,
      html`
        ${textField({ label: t("common.title"), value: def.title, onInput: (v) => set("title", v) })}
        ${checkField({ label: t("layer.visible"), checked: def.visible !== false, onChange: (on) => set("visible", on ? undefined : false) })}
        ${rangeField({
          label: t("layer.opacity"),
          value: def.opacity ?? 1,
          min: 0,
          max: 1,
          step: 0.05,
          format: (v) => `${Math.round(v * 100)} %`,
          onInput: (v) => set("opacity", v >= 1 ? undefined : Math.round(v * 100) / 100),
        })}
        <div class="row2">
          ${numberField({ label: t("general.minZoom"), value: def.minZoom, min: 0, max: 24, help: t("layer.zoomHelp"), onInput: (v) => set("minZoom", v) })}
          ${numberField({ label: t("general.maxZoom"), value: def.maxZoom, min: 0, max: 24, onInput: (v) => set("maxZoom", v) })}
        </div>
        ${renderTypeFields(h, def, set)}
        ${textField({ label: t("common.attribution"), value: def.attribution, onInput: (v) => set("attribution", v) })}
        ${textFieldLazy({
          label: t("layer.metadata"),
          type: "url",
          value: def.metadata?.url,
          help: t("layer.metadataHelp"),
          onCommit: (v) => set("metadata", v.trim() ? { ...(def.metadata ?? {}), url: v.trim() } : undefined),
        })}
        ${selectField({
          label: t("layer.legend"),
          value: legendMode,
          options: [
            { value: "auto", label: t("layer.legendAuto") },
            { value: "none", label: t("layer.legendNone") },
            { value: "image", label: t("layer.legendImage") },
            { value: "entries", label: t("layer.legendEntries") },
          ],
          onChange: (v) =>
            set(
              "legend",
              v === "auto" ? undefined : v === "none" ? false : v === "image" ? "https://" : [{ label: "Class 1", color: "#0e7490" }],
            ),
        })}
        ${legendMode === "image"
          ? textFieldLazy({ label: t("layer.legendUrl"), type: "url", value: def.legend as string, onCommit: (v) => set("legend", v.trim() || "https://") })
          : nothing}
        ${legendMode === "entries"
          ? jsonField(h, t("layer.legendEntriesJson"), def.legend, (parsed) => Array.isArray(parsed) && set("legend", parsed), 6)
          : nothing}
        ${textFieldLazy({ label: t("common.id"), value: def.id, help: t("common.idHelp"), onCommit: (v) => set("id", v.trim()) })}
      `,
    )}
    ${VECTOR_DATA.has(def.type) || def.type === "vector" || def.type === "wms" ? renderFeatureInfo(h, def, set) : nothing}
    ${VECTOR_DATA.has(def.type) ? renderStyle(h, path, rec, set) : nothing}
    ${VECTOR_DATA.has(def.type) ? renderCluster(h, rec, set) : nothing}
    ${section(t("layer.advanced"), rawJson(h, def, upd), t("layer.advancedHelp"))}
  `;
}

/** a textarea holding JSON; a parse failure is reported, never committed */
function jsonField(
  h: Host,
  label: string,
  value: unknown,
  onParsed: (parsed: unknown) => unknown,
  rows = 10,
): TemplateResult {
  return textareaField({
    label,
    value: value === undefined ? "" : JSON.stringify(value, null, 2),
    rows,
    mono: true,
    onCommit: (v) => {
      if (!v.trim()) return onParsed(undefined);
      try {
        onParsed(JSON.parse(v));
      } catch (e) {
        h.notify(`${h.t("common.notJson")}: ${e instanceof Error ? e.message : e}`);
      }
    },
  });
}

function rawJson(h: Host, def: LayerDef, upd: (fn: (d: LayerDef) => LayerDef) => void): TemplateResult {
  return jsonField(
    h,
    h.t("layer.json"),
    def,
    (parsed) => {
      if (parsed && typeof parsed === "object" && typeof (parsed as Rec)["type"] === "string") upd(() => parsed as LayerDef);
      else h.notify(h.t("layer.jsonNeedsType"));
    },
    14,
  );
}

function paramsField(h: Host, rec: Rec, set: Setter): TemplateResult {
  return textareaField({
    label: h.t("layer.params"),
    value: paramsToText(rec["params"] as Record<string, string> | undefined),
    rows: 2,
    mono: true,
    placeholder: "cql_filter=BEZ=1\nTIME=2024",
    help: h.t("layer.paramsHelp"),
    onCommit: (v) => set("params", textToParams(v)),
  });
}

function crsField(h: Host, rec: Rec, set: Setter): TemplateResult {
  const crs = rec["crs"];
  const value = typeof crs === "string" ? crs : typeof crs === "object" && crs !== null ? (crs as Rec)["code"] : "";
  return textFieldLazy({
    label: h.t("layer.crs"),
    value: value as string,
    placeholder: "EPSG:31256",
    help: h.t("layer.crsHelp"),
    onCommit: (v) => set("crs", v.trim()),
  });
}

function renderTypeFields(h: Host, def: LayerDef, set: Setter): TemplateResult {
  const { t } = h;
  const rec = def as unknown as Rec;
  const url = (label = "URL", help?: string): TemplateResult =>
    textFieldLazy({ label, type: "url", value: rec["url"] as string, help, onCommit: (v) => set("url", v.trim()) });
  const paging = (): TemplateResult => html`<div class="row2">
    ${numberField({ label: t("layer.limit"), value: rec["limit"] as number | undefined, min: 1, placeholder: "10000", help: t("layer.limitHelp"), onInput: (v) => set("limit", v) })}
    ${numberField({ label: t("layer.pageSize"), value: rec["pageSize"] as number | undefined, min: 1, onInput: (v) => set("pageSize", v) })}
  </div>`;

  switch (def.type) {
    case "wms":
      return html`
        ${url(t("layer.wmsUrl"))}
        ${textFieldLazy({ label: t("layer.wmsLayers"), value: def.layers, help: t("layer.wmsLayersHelp"), onCommit: (v) => set("layers", v.trim()) })}
        <div class="row2">
          ${textFieldLazy({ label: t("layer.wmsStyles"), value: def.styles, help: t("layer.wmsStylesHelp"), onCommit: (v) => set("styles", v.trim()) })}
          ${selectField({
            label: t("layer.format"),
            value: def.format ?? "",
            emptyLabel: t("common.default"),
            options: [
              { value: "image/png", label: "image/png" },
              { value: "image/jpeg", label: "image/jpeg" },
              { value: "image/webp", label: "image/webp" },
            ],
            onChange: (v) => set("format", v),
          })}
        </div>
        <div class="row2">
          ${selectField({
            label: t("layer.version"),
            value: def.version ?? "",
            emptyLabel: t("common.default"),
            options: [
              { value: "1.3.0", label: "1.3.0" },
              { value: "1.1.1", label: "1.1.1" },
            ],
            onChange: (v) => set("version", v),
          })}
          ${numberField({ label: t("layer.tileSize"), value: def.tileSize, min: 1, max: 4096, placeholder: "256", onInput: (v) => set("tileSize", v) })}
        </div>
        ${checkField({ label: t("layer.transparent"), checked: def.transparent !== false, onChange: (on) => set("transparent", on ? undefined : false) })}
        ${paramsField(h, rec, set)}
      `;
    case "wmts":
      return html`
        ${url(t("layer.wmtsUrl"))}
        ${textFieldLazy({ label: t("layer.wmtsLayer"), value: def.layer, onCommit: (v) => set("layer", v.trim()) })}
        <div class="row3">
          ${textFieldLazy({ label: t("layer.matrixSet"), value: def.matrixSet, placeholder: t("common.default"), onCommit: (v) => set("matrixSet", v.trim()) })}
          ${textFieldLazy({ label: t("layer.wmtsStyle"), value: def.style, placeholder: t("common.default"), onCommit: (v) => set("style", v.trim()) })}
          ${textFieldLazy({ label: t("layer.format"), value: def.format, placeholder: "image/png", onCommit: (v) => set("format", v.trim()) })}
        </div>
      `;
    case "wfs":
      return html`
        ${url(t("layer.wfsUrl"))}
        ${textFieldLazy({ label: t("layer.typeNames"), value: def.typeNames, onCommit: (v) => set("typeNames", v.trim()) })}
        <div class="row2">
          ${selectField({
            label: t("layer.version"),
            value: def.version ?? "2.0.0",
            options: [
              { value: "2.0.0", label: "2.0.0" },
              { value: "1.1.0", label: "1.1.0" },
            ],
            onChange: (v) => set("version", v === "2.0.0" ? undefined : v),
          })}
          ${textFieldLazy({ label: t("layer.outputFormat"), value: def.outputFormat, placeholder: "application/json", onCommit: (v) => set("outputFormat", v.trim()) })}
        </div>
        ${paging()}
        ${paramsField(h, rec, set)}
        ${textFieldLazy({ label: t("layer.promoteId"), value: def.promoteId, help: t("layer.promoteIdHelp"), onCommit: (v) => set("promoteId", v.trim()) })}
      `;
    case "ogcapi-features":
      return html`
        ${url(t("layer.collectionUrl"), t("layer.collectionUrlHelp"))}
        ${paging()}
        ${paramsField(h, rec, set)}
        ${textFieldLazy({ label: t("layer.promoteId"), value: def.promoteId, help: t("layer.promoteIdHelp"), onCommit: (v) => set("promoteId", v.trim()) })}
      `;
    case "geojson":
      return html`
        ${typeof def.data === "string"
          ? textFieldLazy({ label: t("layer.dataUrl"), type: "url", value: def.data, onCommit: (v) => set("data", v.trim()) })
          : html`<p class="note">${t("layer.inlineData")}</p>`}
        ${crsField(h, rec, set)}
        ${textFieldLazy({ label: t("layer.promoteId"), value: def.promoteId, help: t("layer.promoteIdHelp"), onCommit: (v) => set("promoteId", v.trim()) })}
      `;
    case "geoparquet":
      return html`
        ${url(t("layer.fileUrl"))}
        ${crsField(h, rec, set)}
        ${textFieldLazy({ label: t("layer.promoteId"), value: def.promoteId, help: t("layer.promoteIdHelp"), onCommit: (v) => set("promoteId", v.trim()) })}
      `;
    case "vector":
      return html`
        ${url(t("layer.tilesUrl"), t("layer.tilesUrlHelp"))}
        ${textFieldLazy({ label: t("layer.sourceLayer"), value: def.sourceLayer, help: t("layer.sourceLayerHelp"), onCommit: (v) => set("sourceLayer", v.trim()) })}
        ${jsonField(h, t("layer.styleLayers"), def.style, (parsed) => Array.isArray(parsed) && set("style", parsed), 8)}
      `;
    case "raster":
      return html`
        ${url(t("layer.rasterUrl"), t("layer.rasterUrlHelp"))}
        ${numberField({ label: t("layer.tileSize"), value: def.tileSize, min: 1, max: 4096, placeholder: "256", onInput: (v) => set("tileSize", v) })}
      `;
    case "cog": {
      const color = (def.color ?? {}) as Rec;
      const setColor = (key: string, value: unknown): void => {
        const next = setKey(color, key, value);
        set("color", Object.keys(next).length > 0 ? next : undefined);
      };
      return html`
        ${url(t("layer.cogUrl"), t("layer.cogUrlHelp"))}
        ${checkField({
          label: t("layer.hillshade"),
          help: t("layer.hillshadeHelp"),
          checked: def.hillshade !== undefined && def.hillshade !== false,
          onChange: (on) => set("hillshade", on ? true : undefined),
        })}
        ${def.hillshade
          ? nothing
          : html`
              ${textFieldLazy({
                label: t("layer.cogScheme"),
                value: color["scheme"] as string | undefined,
                placeholder: "BrewerSpectral7",
                help: t("layer.cogSchemeHelp"),
                onCommit: (v) => setColor("scheme", v.trim()),
              })}
              ${color["scheme"]
                ? html`<div class="row2">
                      ${numberField({ label: t("layer.cogMin"), value: color["min"] as number | undefined, onInput: (v) => setColor("min", v) })}
                      ${numberField({ label: t("layer.cogMax"), value: color["max"] as number | undefined, onInput: (v) => setColor("max", v) })}
                    </div>
                    ${checkField({ label: t("layer.cogContinuous"), checked: color["continuous"] === true, onChange: (on) => setColor("continuous", on ? true : undefined) })}
                    ${checkField({ label: t("layer.cogReverse"), checked: color["reverse"] === true, onChange: (on) => setColor("reverse", on ? true : undefined) })}`
                : nothing}
            `}
      `;
    }
    default:
      return html``;
  }
}

/* ------------------------------ feature info ------------------------------ */

function fieldsToText(fields?: FieldDef[]): string {
  return (fields ?? []).map((f) => (f.label ? `${f.key}=${f.label}` : f.key)).join("\n");
}

function textToFields(text: string): FieldDef[] | undefined {
  const out: FieldDef[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out.push({ key: line.slice(0, eq).trim(), label: line.slice(eq + 1).trim() });
    else out.push({ key: line });
  }
  return out.length > 0 ? out : undefined;
}

function renderFeatureInfo(h: Host, def: LayerDef, set: Setter): TemplateResult {
  const { t } = h;
  const isWms = def.type === "wms";
  const key = isWms ? "info" : "popup";
  const rec = def as unknown as Rec;
  const value = rec[key] as (PopupConfig & { format?: string }) | false | undefined;
  /* popups default to on for vector layers; GetFeatureInfo needs the "info" key to exist */
  const enabled = isWms ? value !== undefined && value !== false : value !== false;
  const obj = typeof value === "object" ? value : {};
  const setP = (k: string, v: unknown): void => set(key, setKey(obj, k, v));
  const hover = rec["hover"] as { content: string } | false | undefined;

  return section(
    isWms ? t("popup.infoTitle") : t("popup.title"),
    html`
      ${checkField({
        label: isWms ? t("popup.infoEnabled") : t("popup.enabled"),
        help: isWms ? t("popup.infoHelp") : t("popup.enabledHelp"),
        checked: enabled,
        onChange: (on) => set(key, on ? (isWms ? { format: "application/json" } : undefined) : false),
      })}
      ${enabled
        ? html`
            ${textField({ label: t("popup.titleTemplate"), value: obj.title, placeholder: "{{name}}", help: t("popup.templateHelp"), onInput: (v) => setP("title", v) })}
            ${textareaField({
              label: t("popup.content"),
              value: obj.content,
              rows: 3,
              mono: true,
              placeholder: "<b>{{name}}</b><br>{{address}}",
              help: t("popup.contentHelp"),
              onCommit: (v) => setP("content", v),
            })}
            ${textareaField({
              label: t("popup.fields"),
              value: fieldsToText(obj.fields),
              rows: 3,
              mono: true,
              placeholder: "name=Name\naddress=Adresse",
              help: t("popup.fieldsHelp"),
              onCommit: (v) => setP("fields", textToFields(v)),
            })}
            <div class="row2">
              ${textFieldLazy({ label: t("popup.maxWidth"), value: obj.maxWidth, placeholder: "320px", onCommit: (v) => setP("maxWidth", v.trim()) })}
              ${isWms
                ? textFieldLazy({ label: t("popup.format"), value: obj.format, placeholder: "application/json", onCommit: (v) => setP("format", v.trim()) })
                : nothing}
            </div>
          `
        : nothing}
      ${!isWms
        ? textFieldLazy({
            label: t("popup.hover"),
            value: typeof hover === "object" && hover ? hover.content : "",
            placeholder: "{{name}}",
            help: t("popup.hoverHelp"),
            onCommit: (v) => set("hover", v.trim() ? { content: v.trim() } : undefined),
          })
        : nothing}
    `,
    isWms ? undefined : t("popup.intro"),
  );
}

/* ---------------------------------- style ---------------------------------- */

/**
 * One-click styles: simple presets from the layer's current base colour, and
 * data-driven colouring by a property of the features the preview has loaded
 * (categorised for few distinct values, graduated for numeric ranges), with a
 * legend to match.
 */
function renderPresets(h: Host, path: LayerPath, s: Rec, set: Setter): TemplateResult {
  const { t } = h;
  const base = ((s["fill-color"] ?? s["line-color"] ?? s["circle-color"]) as string | undefined) ?? "#0e7490";
  const sample = h.sampleFeatures(path);
  const props = sample ? propertyNames(sample) : [];
  const applyData = (prop: string): void => {
    if (!prop || !sample) return;
    const result = dataDrivenStyle(sample, prop);
    if (!result) {
      h.notify(t("style.tooManyValues", { n: MAX_CATEGORIES }));
      return;
    }
    h.commit(
      updateLayer(h.cfg, path, (d) => ({ ...d, style: result.style, legend: result.legend }) as unknown as LayerDef),
    );
  };
  return html`
    <div class="field">
      <span class="label">${t("style.presets")}</span>
      <div class="chips">
        ${SIMPLE_PRESETS.map(
          (id) => html`<button class="btn small" type="button" @click=${() => set("style", simplePreset(id, base))}>
            ${t(`style.preset.${id}`)}
          </button>`,
        )}
      </div>
    </div>
    ${selectField({
      label: t("style.byAttribute"),
      value: "",
      emptyLabel: sample === null ? t("style.noSample") : props.length === 0 ? t("style.noProperties") : t("style.chooseProperty"),
      options: props.map((p) => ({ value: p, label: p })),
      disabled: !sample || props.length === 0,
      help: t("style.byAttributeHelp", { n: MAX_CATEGORIES }),
      onChange: applyData,
    })}
  `;
}

function renderStyle(h: Host, path: LayerPath, rec: Rec, set: Setter): TemplateResult {
  const { t } = h;
  const style = rec["style"];
  const presets = renderPresets(h, path, (Array.isArray(style) ? {} : (style ?? {})) as Rec, set);
  if (Array.isArray(style)) {
    return section(
      t("style.title"),
      html`
        ${presets}
        <p class="note">${t("style.advancedNote")}</p>
        ${jsonField(h, t("layer.styleLayers"), style, (parsed) => Array.isArray(parsed) && set("style", parsed), 10)}
        <div class="toolbar">
          <button class="btn small" type="button" @click=${() => set("style", undefined)}>${t("style.toSimple")}</button>
        </div>
      `,
    );
  }
  const s = (style ?? {}) as Rec;
  const setS = (key: string, value: unknown): void => set("style", setKey(s, key, value));
  const num = (key: string, label: string, min: number, max: number, step: number): TemplateResult =>
    numberField({ label, value: s[key] as number | undefined, min, max, step, onInput: (v) => setS(key, v) });
  return section(
    t("style.title"),
    html`
      ${presets}
      <div class="row2">
        ${colorField({ label: t("style.fillColor"), value: s["fill-color"] as string | undefined, onInput: (v) => setS("fill-color", v) })}
        ${num("fill-opacity", t("style.fillOpacity"), 0, 1, 0.05)}
      </div>
      <div class="row2">
        ${colorField({ label: t("style.lineColor"), value: s["line-color"] as string | undefined, onInput: (v) => setS("line-color", v) })}
        ${num("line-width", t("style.lineWidth"), 0, 50, 0.5)}
      </div>
      <div class="row2">
        ${colorField({ label: t("style.circleColor"), value: s["circle-color"] as string | undefined, onInput: (v) => setS("circle-color", v) })}
        ${num("circle-radius", t("style.circleRadius"), 0, 100, 0.5)}
      </div>
      <div class="row2">
        ${colorField({ label: t("style.circleStroke"), value: s["circle-stroke-color"] as string | undefined, onInput: (v) => setS("circle-stroke-color", v) })}
        ${num("circle-stroke-width", t("style.circleStrokeWidth"), 0, 20, 0.5)}
      </div>
      <details>
        <summary>${t("style.jsonSummary")}</summary>
        ${jsonField(h, t("style.json"), style, (parsed) => set("style", parsed), 8)}
      </details>
    `,
    t("style.intro"),
  );
}

/* --------------------------------- cluster --------------------------------- */

function renderCluster(h: Host, rec: Rec, set: Setter): TemplateResult {
  const { t } = h;
  const c = rec["cluster"];
  const on = c === true || (typeof c === "object" && c !== null && (c as Rec)["enabled"] !== false);
  const opts = typeof c === "object" && c !== null ? (c as Rec) : {};
  const setOpt = (key: string, value: unknown): void => {
    const next = setKey(opts, key, value);
    delete next["enabled"];
    set("cluster", Object.keys(next).length > 0 ? next : true);
  };
  return section(
    t("cluster.title"),
    html`
      ${checkField({ label: t("cluster.enabled"), help: t("cluster.help"), checked: on, onChange: (enable) => set("cluster", enable ? true : undefined) })}
      ${on
        ? html`<div class="row2">
            ${numberField({ label: t("cluster.radius"), value: opts["radius"] as number | undefined, min: 1, max: 1000, placeholder: "50", onInput: (v) => setOpt("radius", v) })}
            ${numberField({ label: t("cluster.maxZoom"), value: opts["maxZoom"] as number | undefined, min: 0, max: 24, placeholder: "14", onInput: (v) => setOpt("maxZoom", v) })}
          </div>`
        : nothing}
    `,
  );
}
