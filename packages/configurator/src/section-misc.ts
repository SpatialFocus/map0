/**
 * The sections that edit one top-level key each: general (meta, view,
 * permalink), basemaps, controls, search, print, theme & language. Each is a
 * function of the host — read the config, render fields, commit patches.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { BasemapDef, ControlsConfig, Map0Config, SearchConfig } from "@map0/schema";
import {
  checkField,
  checkGroup,
  colorField,
  numberField,
  section,
  selectField,
  textField,
  textFieldLazy,
  textareaField,
} from "./fields.js";
import type { Host } from "./host.js";
import {
  BASEMAP_PRESETS,
  numbersToText,
  setKey,
  textToNumbers,
  textToTuple,
} from "./state.js";

const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/* --------------------------------- general --------------------------------- */

export function renderGeneral(h: Host): TemplateResult {
  const { cfg, t } = h;
  const map = cfg.map ?? {};
  const meta = cfg.meta ?? {};
  const patchMap = (key: string, value: unknown): void => h.patchTop("map", (m) => setKey(m ?? {}, key, value));
  const setCenter = (index: 0 | 1, value: number | undefined): void => {
    const current: [number, number] = map.center ?? [0, 0];
    if (value === undefined) return patchMap("center", undefined);
    const next: [number, number] = [current[0], current[1]];
    next[index] = value;
    patchMap("center", next);
  };
  const useView = (): void => {
    const view = h.currentView();
    if (!view) return;
    h.patchTop("map", (m) => {
      let next = { ...(m ?? {}), center: view.center, zoom: view.zoom };
      next = setKey(next, "bearing", view.bearing !== 0 ? view.bearing : undefined);
      next = setKey(next, "pitch", view.pitch !== 0 ? view.pitch : undefined);
      return setKey(next, "bounds", undefined);
    });
  };
  const permalink = cfg.permalink;

  return html`
    ${section(
      t("general.meta"),
      html`
        ${textField({
          label: t("general.title"),
          value: meta.title,
          help: t("general.titleHelp"),
          onInput: (v) => h.patchTop("meta", (m) => setKey(m ?? {}, "title", v)),
        })}
        ${textareaField({
          label: t("general.description"),
          value: meta.description,
          rows: 2,
          onCommit: (v) => h.patchTop("meta", (m) => setKey(m ?? {}, "description", v)),
        })}
      `,
    )}
    ${section(
      t("general.view"),
      html`
        <div class="toolbar">
          <button class="btn primary" type="button" ?disabled=${!h.currentView()} @click=${useView}>
            ${t("general.useView")}
          </button>
          <span class="help">${t("general.useViewHelp")}</span>
        </div>
        <div class="row3">
          ${numberField({ label: t("general.lon"), value: map.center?.[0], min: -180, max: 180, onInput: (v) => setCenter(0, v) })}
          ${numberField({ label: t("general.lat"), value: map.center?.[1], min: -90, max: 90, onInput: (v) => setCenter(1, v) })}
          ${numberField({ label: t("general.zoom"), value: map.zoom, min: 0, max: 24, step: 0.1, onInput: (v) => patchMap("zoom", v) })}
        </div>
        ${textFieldLazy({
          label: t("general.bounds"),
          value: numbersToText(map.bounds),
          placeholder: "16.18, 48.12, 16.58, 48.32",
          help: t("general.boundsHelp"),
          onCommit: (v) => patchMap("bounds", v.trim() ? textToTuple(v, 4) : undefined),
        })}
        <div class="row2">
          ${numberField({ label: t("general.minZoom"), value: map.minZoom, min: 0, max: 24, onInput: (v) => patchMap("minZoom", v) })}
          ${numberField({ label: t("general.maxZoom"), value: map.maxZoom, min: 0, max: 24, onInput: (v) => patchMap("maxZoom", v) })}
        </div>
        ${textFieldLazy({
          label: t("general.maxBounds"),
          value: numbersToText(map.maxBounds),
          placeholder: "9.5, 46.3, 17.2, 49.1",
          help: t("general.maxBoundsHelp"),
          onCommit: (v) => patchMap("maxBounds", v.trim() ? textToTuple(v, 4) : undefined),
        })}
        <div class="row3">
          ${numberField({ label: t("general.bearing"), value: map.bearing, min: -360, max: 360, onInput: (v) => patchMap("bearing", v) })}
          ${numberField({ label: t("general.pitch"), value: map.pitch, min: 0, max: 85, onInput: (v) => patchMap("pitch", v) })}
          ${selectField({
            label: t("general.projection"),
            value: map.projection ?? "mercator",
            options: [
              { value: "mercator", label: "Mercator" },
              { value: "globe", label: t("general.globe") },
            ],
            onChange: (v) => patchMap("projection", v === "mercator" ? undefined : v),
          })}
        </div>
        ${checkField({
          label: t("general.cooperative"),
          help: t("general.cooperativeHelp"),
          checked: map.cooperativeGestures === true,
          onChange: (on) => patchMap("cooperativeGestures", on ? true : undefined),
        })}
      `,
    )}
    ${section(
      t("general.permalink"),
      html`
        ${checkField({
          label: t("general.permalinkOn"),
          help: t("general.permalinkHelp"),
          checked: permalink !== undefined && permalink !== false,
          onChange: (on) => h.commit(setKey(cfg, "permalink", on ? true : undefined)),
        })}
        ${permalink !== undefined && permalink !== false
          ? textFieldLazy({
              label: t("general.permalinkParam"),
              value: typeof permalink === "object" ? permalink.param : "",
              placeholder: "map0",
              help: t("general.permalinkParamHelp"),
              onCommit: (v) => h.commit({ ...cfg, permalink: v.trim() ? { param: v.trim() } : true }),
            })
          : nothing}
      `,
    )}
  `;
}

/* -------------------------------- basemaps -------------------------------- */

export function renderBasemaps(h: Host): TemplateResult {
  const { cfg, t } = h;
  const list = cfg.basemaps ?? [];
  const sel = h.selectedBasemap;
  const current = sel !== null ? list[sel] : undefined;
  const update = (next: BasemapDef[]): void => h.commit({ ...cfg, basemaps: next });
  const add = (def: BasemapDef): void => {
    update([...list, structuredClone(def)]);
    h.selectBasemap(list.length);
  };
  const move = (delta: -1 | 1): void => {
    if (sel === null) return;
    const target = sel + delta;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[sel], next[target]] = [next[target]!, next[sel]!];
    update(next);
    h.selectBasemap(target);
  };
  const remove = (): void => {
    if (sel === null) return;
    update(list.filter((_, i) => i !== sel));
    h.selectBasemap(null);
  };

  return html`
    ${section(
      t("basemaps.title"),
      html`
        ${list.length === 0
          ? html`<p class="empty">${t("basemaps.empty")}</p>`
          : html`<ul class="tree">
              ${list.map(
                (b, i) => html`<li
                  class="node ${i === sel ? "selected" : ""}"
                  @click=${() => h.selectBasemap(i)}
                >
                  <span class="badge">${b.type}</span>
                  <span class="name">${b.title || b.id || b.url || t("basemaps.untitled")}</span>
                  ${b.default ? html`<span class="tag">${t("basemaps.default")}</span>` : nothing}
                </li>`,
              )}
            </ul>`}
        ${current
          ? html`<div class="toolbar">
              <button class="btn small" type="button" ?disabled=${sel === 0} @click=${() => move(-1)}>↑ ${t("common.up")}</button>
              <button class="btn small" type="button" ?disabled=${sel === list.length - 1} @click=${() => move(1)}>↓ ${t("common.down")}</button>
              <span class="spacer"></span>
              <button class="btn small danger" type="button" @click=${remove}>${t("common.remove")}</button>
            </div>`
          : nothing}
        <div>
          <span class="label help">${t("basemaps.add")}</span>
          <div class="chips">
            ${BASEMAP_PRESETS.map(
              (p) => html`<button class="btn small" type="button" @click=${() => add(p.def)}>+ ${p.title}</button>`,
            )}
            <button class="btn small" type="button" @click=${() => add({ type: "style", title: "", url: "" })}>
              + ${t("basemaps.customStyle")}
            </button>
            <button class="btn small" type="button" @click=${() => add({ type: "raster", title: "", url: "" })}>
              + ${t("basemaps.customRaster")}
            </button>
          </div>
        </div>
      `,
      t("basemaps.intro"),
    )}
    ${current && sel !== null ? renderBasemapForm(h, current, sel) : nothing}
  `;
}

function renderBasemapForm(h: Host, b: BasemapDef, index: number): TemplateResult {
  const { cfg, t } = h;
  const set = (key: string, value: unknown): void => {
    const next = [...(cfg.basemaps ?? [])];
    next[index] = setKey(b, key, value);
    h.commit({ ...cfg, basemaps: next });
  };
  const setDefault = (on: boolean): void => {
    const next = (cfg.basemaps ?? []).map((bm, i) => setKey(bm, "default", on && i === index ? true : undefined));
    h.commit({ ...cfg, basemaps: next });
  };
  const isEmpty = b.type === "empty";
  return section(
    t("basemaps.edit"),
    html`
      ${textField({ label: t("common.title"), value: b.title, onInput: (v) => set("title", v) })}
      ${selectField({
        label: t("common.type"),
        value: b.type,
        options: [
          { value: "style", label: t("basemaps.typeStyle") },
          { value: "raster", label: t("basemaps.typeRaster") },
          { value: "empty", label: t("basemaps.typeEmpty") },
        ],
        onChange: (v) => set("type", v),
      })}
      ${isEmpty
        ? nothing
        : textFieldLazy({
            label: "URL",
            type: "url",
            value: b.url,
            placeholder: b.type === "style" ? "https://…/style.json" : "https://…/{z}/{x}/{y}.png",
            help: b.type === "style" ? t("basemaps.urlStyleHelp") : t("basemaps.urlRasterHelp"),
            onCommit: (v) => set("url", v.trim()),
          })}
      ${textField({ label: t("common.attribution"), value: b.attribution, onInput: (v) => set("attribution", v) })}
      ${b.type === "raster"
        ? html`<div class="row3">
            ${numberField({ label: t("basemaps.tileSize"), value: b.tileSize, min: 1, max: 4096, onInput: (v) => set("tileSize", v) })}
            ${numberField({ label: t("general.minZoom"), value: b.minZoom, min: 0, max: 24, onInput: (v) => set("minZoom", v) })}
            ${numberField({ label: t("general.maxZoom"), value: b.maxZoom, min: 0, max: 24, onInput: (v) => set("maxZoom", v) })}
          </div>`
        : nothing}
      ${textFieldLazy({ label: t("common.id"), value: b.id, help: t("common.idHelp"), onCommit: (v) => set("id", v.trim()) })}
      ${textFieldLazy({
        label: t("basemaps.thumbnail"),
        value: b.thumbnail,
        placeholder: "auto",
        help: t("basemaps.thumbnailHelp"),
        onCommit: (v) => set("thumbnail", v.trim()),
      })}
      ${checkField({ label: t("basemaps.setDefault"), checked: b.default === true, onChange: setDefault })}
    `,
  );
}

/* -------------------------------- controls -------------------------------- */

type ControlKey = keyof ControlsConfig;

const CONTROL_KEYS: ControlKey[] = [
  "navigation",
  "scale",
  "fullscreen",
  "geolocate",
  "globe",
  "home",
  "attribution",
  "layerSwitcher",
  "basemapSwitcher",
  "legend",
  "print",
  "measure",
  "coordinates",
];

/** every control is on by default except the home button */
const DEFAULT_ON: ReadonlySet<ControlKey> = new Set(CONTROL_KEYS.filter((k) => k !== "home"));

export function renderControls(h: Host): TemplateResult {
  const { cfg, t } = h;
  const controls: ControlsConfig = cfg.controls ?? {};
  const isOn = (key: ControlKey): boolean => {
    const v = controls[key];
    return v === undefined ? DEFAULT_ON.has(key) : v !== false;
  };
  const options = (key: ControlKey): Record<string, unknown> => {
    const v = controls[key];
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  };
  const setOn = (key: ControlKey, on: boolean): void =>
    h.patchTop("controls", (c) => setKey(c ?? {}, key, on === DEFAULT_ON.has(key) ? undefined : on));
  const setOption = (key: ControlKey, opt: string, value: unknown): void =>
    h.patchTop("controls", (c) => {
      const next = setKey(options(key), opt, value);
      return setKey(c ?? {}, key, Object.keys(next).length > 0 ? next : DEFAULT_ON.has(key) ? undefined : true);
    });
  const positionField = (key: ControlKey): TemplateResult =>
    selectField({
      label: t("controls.position"),
      value: options(key)["position"] as string | undefined,
      emptyLabel: t("common.default"),
      options: POSITIONS.map((p) => ({ value: p, label: t(`controls.pos.${p}`) })),
      onChange: (v) => setOption(key, "position", v),
    });

  const sub = (key: ControlKey): TemplateResult => {
    if (!isOn(key)) return html``;
    const o = options(key);
    switch (key) {
      case "scale":
        return html`<div class="row2 sub">
          ${selectField({
            label: t("controls.scaleUnit"),
            value: (o["unit"] as string | undefined) ?? "metric",
            options: [
              { value: "metric", label: t("controls.metric") },
              { value: "imperial", label: t("controls.imperial") },
            ],
            onChange: (v) => setOption(key, "unit", v === "metric" ? undefined : v),
          })}
          ${numberField({ label: t("controls.scaleWidth"), value: o["maxWidth"] as number | undefined, min: 40, max: 600, onInput: (v) => setOption(key, "maxWidth", v) })}
        </div>`;
      case "geolocate":
        return html`<div class="sub">
          ${checkField({ label: t("controls.follow"), checked: o["follow"] === true, onChange: (on) => setOption(key, "follow", on ? true : undefined) })}
        </div>`;
      case "attribution":
        return html`<div class="sub">
          ${selectField({
            label: t("controls.compact"),
            value: o["compact"] === undefined ? "" : String(o["compact"]),
            emptyLabel: t("common.default"),
            options: [
              { value: "auto", label: "auto" },
              { value: "true", label: t("common.yes") },
              { value: "false", label: t("common.no") },
            ],
            onChange: (v) => setOption(key, "compact", v === "" ? undefined : v === "auto" ? "auto" : v === "true"),
          })}
        </div>`;
      case "layerSwitcher":
        return html`<div class="sub">
          <div class="row2">
            ${positionField(key)}
            ${selectField({
              label: t("controls.open"),
              value: o["open"] === undefined ? "" : String(o["open"]),
              emptyLabel: t("common.default"),
              options: [
                { value: "auto", label: "auto" },
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
              onChange: (v) => setOption(key, "open", v === "" ? undefined : v === "auto" ? "auto" : v === "true"),
            })}
          </div>
          ${textField({ label: t("controls.tocTitle"), value: o["title"] as string | undefined, onInput: (v) => setOption(key, "title", v) })}
          ${checkField({
            label: t("controls.allowAdd"),
            help: t("controls.allowAddHelp"),
            checked: o["allowAdd"] !== false,
            onChange: (on) => setOption(key, "allowAdd", on ? undefined : false),
          })}
        </div>`;
      case "basemapSwitcher":
        return html`<div class="sub">${positionField(key)}</div>`;
      case "legend":
        return html`<div class="sub">
          <div class="row2">
            ${positionField(key)}
            ${selectField({
              label: t("controls.open"),
              value: o["open"] === undefined ? "" : String(o["open"]),
              emptyLabel: t("common.default"),
              options: [
                { value: "true", label: t("common.yes") },
                { value: "false", label: t("common.no") },
              ],
              onChange: (v) => setOption(key, "open", v === "" ? undefined : v === "true"),
            })}
          </div>
        </div>`;
      case "coordinates": {
        const crs = (o["crs"] as Array<{ code: string }> | undefined)?.map((c) => c.code).join(", ") ?? "";
        return html`<div class="sub">
          ${textFieldLazy({
            label: t("controls.crs"),
            value: crs,
            placeholder: "EPSG:4326, EPSG:31256, EPSG:32633",
            help: t("controls.crsHelp"),
            onCommit: (v) => {
              const codes = v
                .split(/[,\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              setOption(key, "crs", codes.length > 0 ? codes.map((code) => ({ code })) : undefined);
            },
          })}
        </div>`;
      }
      default:
        return html``;
    }
  };

  return section(
    t("controls.title"),
    html`
      ${CONTROL_KEYS.map(
        (key) => html`
          <div class="control">
            ${checkField({
              label: t(`controls.${key}`),
              help: t(`controls.${key}Help`),
              checked: isOn(key),
              onChange: (on) => setOn(key, on),
            })}
            ${sub(key)}
          </div>
        `,
      )}
    `,
    t("controls.intro"),
  );
}

/* --------------------------------- search --------------------------------- */

export function renderSearch(h: Host): TemplateResult {
  const { cfg, t } = h;
  const s: SearchConfig | undefined = cfg.search;
  const on = s !== undefined && s.enabled !== false;
  const set = (key: string, value: unknown): void => h.patchTop("search", (c) => setKey(c ?? {}, key, value));
  const provider = s?.provider ?? "photon";
  const custom = typeof provider === "object" ? provider : undefined;
  const setCustom = (key: string, value: unknown): void =>
    set("provider", setKey(custom ?? { url: "" }, key, value));

  return section(
    t("search.title"),
    html`
      ${checkField({
        label: t("search.enabled"),
        help: t("search.enabledHelp"),
        checked: on,
        onChange: (enable) => h.commit(setKey(cfg, "search", enable ? { ...(s ?? {}), enabled: undefined } : undefined)),
      })}
      ${on
        ? html`
            ${selectField({
              label: t("search.provider"),
              value: custom ? "custom" : (provider as string),
              options: [
                { value: "photon", label: "Photon (komoot)" },
                { value: "nominatim", label: "Nominatim (OSM)" },
                { value: "custom", label: t("search.custom") },
              ],
              onChange: (v) => set("provider", v === "photon" ? undefined : v === "custom" ? { url: "" } : v),
            })}
            ${custom
              ? html`
                  ${textFieldLazy({
                    label: t("search.customUrl"),
                    type: "url",
                    value: custom.url,
                    placeholder: "https://…/search?q={query}&limit={limit}",
                    help: t("search.customUrlHelp"),
                    onCommit: (v) => setCustom("url", v.trim()),
                  })}
                  <div class="row2">
                    ${selectField({
                      label: t("search.format"),
                      value: custom.format ?? "geojson",
                      options: [
                        { value: "geojson", label: "GeoJSON (Photon-like)" },
                        { value: "nominatim", label: "Nominatim array" },
                      ],
                      onChange: (v) => setCustom("format", v === "geojson" ? undefined : v),
                    })}
                    ${textField({ label: t("search.labelField"), value: custom.labelField, placeholder: "name", onInput: (v) => setCustom("labelField", v) })}
                  </div>
                `
              : textFieldLazy({
                  label: t("search.url"),
                  type: "url",
                  value: s?.url,
                  help: t("search.urlHelp"),
                  onCommit: (v) => set("url", v.trim()),
                })}
            <div class="row3">
              ${textField({ label: t("search.country"), value: s?.country, placeholder: "AT", onInput: (v) => set("country", v.toUpperCase()) })}
              ${numberField({ label: t("search.limit"), value: s?.limit, min: 1, max: 50, placeholder: "8", onInput: (v) => set("limit", v) })}
              ${numberField({ label: t("search.minLength"), value: s?.minLength, min: 1, max: 20, placeholder: "3", onInput: (v) => set("minLength", v) })}
            </div>
            ${textField({ label: t("search.placeholder"), value: s?.placeholder, onInput: (v) => set("placeholder", v) })}
            ${checkField({ label: t("search.bias"), help: t("search.biasHelp"), checked: s?.bias !== false, onChange: (v) => set("bias", v ? undefined : false) })}
            ${checkField({ label: t("search.coordinates"), help: t("search.coordinatesHelp"), checked: s?.coordinates !== false, onChange: (v) => set("coordinates", v ? undefined : false) })}
          `
        : nothing}
    `,
    t("search.intro"),
  );
}

/* ---------------------------------- print ---------------------------------- */

const PRINT_DEFAULTS = {
  formats: ["png", "pdf"],
  sizes: ["current", "A4-landscape", "A4-portrait"],
  dpi: [96, 150, 300],
  elements: ["title", "legend", "scalebar", "attribution", "date"],
};

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function renderPrint(h: Host): TemplateResult {
  const { cfg, t } = h;
  const p = cfg.print ?? {};
  const on = cfg.controls?.print !== false;
  const setList = (key: keyof typeof PRINT_DEFAULTS, value: (string | number)[]): void =>
    h.patchTop("print", (c) => setKey(c ?? {}, key, sameList(value, PRINT_DEFAULTS[key]) ? undefined : value));

  return section(
    t("print.title"),
    html`
      ${checkField({
        label: t("print.enabled"),
        help: t("print.enabledHelp"),
        checked: on,
        onChange: (enable) => h.patchTop("controls", (c) => setKey(c ?? {}, "print", enable ? undefined : false)),
      })}
      ${on
        ? html`
            ${checkGroup({
              label: t("print.formats"),
              value: p.formats ?? PRINT_DEFAULTS.formats,
              options: [
                { value: "png", label: "PNG" },
                { value: "pdf", label: "PDF" },
              ],
              help: t("print.formatsHelp"),
              onChange: (v) => setList("formats", v),
            })}
            ${checkGroup({
              label: t("print.sizes"),
              value: p.sizes ?? PRINT_DEFAULTS.sizes,
              options: [
                { value: "current", label: t("print.sizeCurrent") },
                { value: "A4-landscape", label: "A4 " + t("print.landscape") },
                { value: "A4-portrait", label: "A4 " + t("print.portrait") },
                { value: "A3-landscape", label: "A3 " + t("print.landscape") },
                { value: "A3-portrait", label: "A3 " + t("print.portrait") },
              ],
              onChange: (v) => setList("sizes", v),
            })}
            ${textFieldLazy({
              label: t("print.dpi"),
              value: numbersToText(p.dpi ?? PRINT_DEFAULTS.dpi),
              help: t("print.dpiHelp"),
              onCommit: (v) => setList("dpi", textToNumbers(v) ?? PRINT_DEFAULTS.dpi),
            })}
            ${checkGroup({
              label: t("print.elements"),
              value: p.elements ?? PRINT_DEFAULTS.elements,
              options: [
                { value: "title", label: t("print.elTitle") },
                { value: "legend", label: t("print.elLegend") },
                { value: "scalebar", label: t("print.elScalebar") },
                { value: "attribution", label: t("print.elAttribution") },
                { value: "date", label: t("print.elDate") },
              ],
              onChange: (v) => setList("elements", v),
            })}
          `
        : nothing}
    `,
    t("print.intro"),
  );
}

/* ----------------------------- theme & language ----------------------------- */

/** "de.layers.title=Kartenthemen" lines ↔ i18n.overrides */
function overridesToText(overrides?: Record<string, Record<string, string>>): string {
  const lines: string[] = [];
  for (const [locale, entries] of Object.entries(overrides ?? {}))
    for (const [key, value] of Object.entries(entries)) lines.push(`${locale}.${key}=${value}`);
  return lines.join("\n");
}

function textToOverrides(text: string): Record<string, Record<string, string>> | undefined {
  const out: Record<string, Record<string, string>> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    const dot = line.indexOf(".");
    if (!line || eq <= 0 || dot <= 0 || dot >= eq) continue;
    const locale = line.slice(0, dot);
    const key = line.slice(dot + 1, eq).trim();
    (out[locale] ??= {})[key] = line.slice(eq + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function renderTheme(h: Host): TemplateResult {
  const { cfg, t } = h;
  const theme = cfg.theme ?? {};
  const i18n = cfg.i18n ?? {};
  const setTheme = (key: string, value: unknown): void => h.patchTop("theme", (c) => setKey(c ?? {}, key, value));
  const setI18n = (key: string, value: unknown): void => h.patchTop("i18n", (c) => setKey(c ?? {}, key, value));

  return html`
    ${section(
      t("theme.title"),
      html`
        ${selectField({
          label: t("theme.mode"),
          value: theme.mode ?? "auto",
          options: [
            { value: "auto", label: t("theme.modeAuto") },
            { value: "light", label: t("theme.modeLight") },
            { value: "dark", label: t("theme.modeDark") },
          ],
          onChange: (v) => setTheme("mode", v === "auto" ? undefined : v),
        })}
        ${colorField({ label: t("theme.primary"), value: theme.primary, help: t("theme.primaryHelp"), onInput: (v) => setTheme("primary", v) })}
        ${selectField({
          label: t("theme.radius"),
          value: theme.radius ?? "md",
          options: [
            { value: "none", label: t("theme.radiusNone") },
            { value: "sm", label: t("theme.radiusSm") },
            { value: "md", label: t("theme.radiusMd") },
            { value: "lg", label: t("theme.radiusLg") },
          ],
          onChange: (v) => setTheme("radius", v === "md" ? undefined : v),
        })}
        ${textFieldLazy({
          label: t("theme.font"),
          value: theme.font,
          placeholder: "Inter, system-ui, sans-serif",
          help: t("theme.fontHelp"),
          onCommit: (v) => setTheme("font", v.trim()),
        })}
      `,
      t("theme.intro"),
    )}
    ${section(
      t("lang.title"),
      html`
        <div class="row2">
          ${selectField({
            label: t("lang.locale"),
            value: i18n.locale ?? "auto",
            options: [
              { value: "auto", label: t("lang.auto") },
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ],
            onChange: (v) => setI18n("locale", v === "auto" ? undefined : v),
          })}
          ${selectField({
            label: t("lang.fallback"),
            value: i18n.fallback ?? "en",
            options: [
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" },
            ],
            onChange: (v) => setI18n("fallback", v === "en" ? undefined : v),
          })}
        </div>
        ${textareaField({
          label: t("lang.overrides"),
          value: overridesToText(i18n.overrides),
          rows: 4,
          mono: true,
          placeholder: "de.layers.title=Kartenthemen\nen.layers.title=Map topics",
          help: t("lang.overridesHelp"),
          onCommit: (v) => setI18n("overrides", textToOverrides(v)),
        })}
      `,
      t("lang.intro"),
    )}
  `;
}

export type { Map0Config };
