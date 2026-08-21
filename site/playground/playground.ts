/**
 * The playground: an Ace editor wired to map0's own `validateConfig`, with a
 * live viewer beside it. Validation runs on every keystroke (debounced); the
 * map only reloads on "Apply", and blurs while the editor is ahead of it —
 * rebuilding the whole map on every keypress would flash more than it helps.
 *
 * Configs arrive four ways: the inline example below, `?config=<path>` (the
 * demos' "Open in the playground" links), `?c=<json>` (demos whose config is
 * inline in their page), or plain pasting.
 */
import "@map0/ui";
/* Ace, hand-picked: the blanket esm-resolver would register every mode and
   worker Ace ships and Rollup would emit them all as chunks — megabytes of
   PHP/XQuery/Vim nobody here can ever load. This page needs exactly four
   pieces: the core, the JSON mode, one theme, and the search box (Ctrl-F). */
import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-tomorrow_night";
import "ace-builds/src-noconflict/ext-searchbox";
/* the linting worker is fetched by URL at runtime — hand Ace the URL Vite
   actually serves (dev) or emits (build) the file at */
import workerJsonUrl from "ace-builds/src-noconflict/worker-json.js?url";

ace.config.setModuleUrl("ace/mode/json_worker", workerJsonUrl);
import { resolveConfigExtends, validateConfig } from "@map0/schema";
import type { Map0Config } from "@map0/schema";
import type { Map0Viewer } from "@map0/ui";
import { LANG } from "../lang.js";

const EXAMPLE = `{
  "$schema": "https://map0.net/schema/v1.json",
  "version": 1,
  "map": { "center": [16.3725, 48.2083], "zoom": 12 },
  "basemaps": [
    {
      "type": "style",
      "title": "basemap.at",
      "url": "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json"
    }
  ],
  "layers": [
    {
      "type": "wms",
      "title": "Zoning plan",
      "url": "https://data.wien.gv.at/daten/geo",
      "layers": "GENFLWIDMUNGOGD",
      "opacity": 0.6
    }
  ]
}`;

const STR =
  LANG === "de"
    ? {
        empty: "Config einfügen, um sie zu prüfen.",
        notJson: "Noch kein JSON",
        valid: (w: string) => `Gültig — Übernehmen lädt die Karte${w}`,
        applied: (w: string) => `Gültig — die Karte zeigt diese Config${w}`,
        invalid: (e: number, w: string) =>
          `${e} Fehler${w} — die Karte bleibt auf dem letzten gültigen Stand`,
        warnings: (n: number) => ` (${n} Warnung${n === 1 ? "" : "en"})`,
        loadFailed: (src: string) => `${src} konnte nicht geladen werden`,
      }
    : {
        empty: "Paste a config to check it.",
        notJson: "Not JSON yet",
        valid: (w: string) => `Valid — Apply loads the map${w}`,
        applied: (w: string) => `Valid — the map shows this config${w}`,
        invalid: (e: number, w: string) =>
          `${e} error${e === 1 ? "" : "s"}${w} — the map keeps the last valid state`,
        warnings: (n: number) => ` (${n} warning${n === 1 ? "" : "s"})`,
        loadFailed: (src: string) => `could not load ${src}`,
      };

/* --------------------------------- editor -------------------------------- */

const editorHost = document.querySelector<HTMLElement>("[data-pg-editor]");
const output = document.querySelector<HTMLElement>("[data-pg-output]");
const mapPane = document.querySelector<HTMLElement>("[data-pg-map]");
const applyButton = document.querySelector<HTMLButtonElement>("[data-pg-apply]");
if (!editorHost || !output || !mapPane || !applyButton) throw new Error("playground markup missing");

const editor = ace.edit(editorHost, {
  mode: "ace/mode/json",
  theme: "ace/theme/tomorrow_night",
  tabSize: 2,
  useSoftTabs: true,
  showPrintMargin: false,
  fontSize: "12.5px",
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  wrap: true,
});
editor.renderer.setScrollMargin(10, 10, 0, 0);

/* ------------------------------- validation ------------------------------ */

interface CheckResult {
  ok: boolean;
  /** the extends-resolved config, ready to hand to the viewer */
  config?: Map0Config;
}

function row(list: HTMLUListElement, kind: "error" | "warning", path: string, message: string): void {
  const li = document.createElement("li");
  li.className = kind;
  const p = document.createElement("span");
  p.className = "path";
  p.textContent = `${kind === "warning" ? "⚠ " : "✗ "}${path}`;
  const m = document.createElement("span");
  m.className = "message";
  m.textContent = message;
  li.append(p, m);
  list.appendChild(li);
}

let checkSeq = 0;

/**
 * Parse, resolve `extends`, validate — and render the outcome below the
 * editor. Resolving before validating matches what the viewer itself does, so
 * a child config that leaves `basemaps` to its base validates here too.
 */
async function check(raw: string): Promise<CheckResult> {
  const seq = ++checkSeq;
  const stale = (): boolean => seq !== checkSeq;

  const status = document.createElement("p");
  status.className = "status";
  const list = document.createElement("ul");
  const show = (): void => {
    output!.textContent = "";
    output!.append(status, list);
  };

  if (!raw.trim()) {
    status.textContent = STR.empty;
    show();
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    status.textContent = STR.notJson;
    status.classList.add("bad");
    row(list, "error", "$", (e as Error).message);
    show();
    return { ok: false };
  }

  let resolved: unknown;
  try {
    resolved = await resolveConfigExtends(parsed);
  } catch (e) {
    if (stale()) return { ok: false };
    status.textContent = STR.invalid(1, "");
    status.classList.add("bad");
    row(list, "error", "$.extends", e instanceof Error ? e.message : String(e));
    show();
    return { ok: false };
  }
  if (stale()) return { ok: false };

  const result = validateConfig(resolved);
  const warnings = result.warnings.length > 0 ? STR.warnings(result.warnings.length) : "";
  if (result.valid) {
    const current = raw.trim() === appliedText?.trim();
    status.textContent = current ? STR.applied(warnings) : STR.valid(warnings);
    status.classList.add("ok");
  } else {
    status.textContent = STR.invalid(result.errors.length, warnings);
    status.classList.add("bad");
  }
  for (const e of result.errors) row(list, "error", e.path, e.message);
  for (const w of result.warnings) row(list, "warning", w.path, w.message);
  show();
  return result.valid ? { ok: true, config: resolved as Map0Config } : { ok: false };
}

/* ------------------------------ map / apply ------------------------------ */

let viewer: Map0Viewer | undefined;
let appliedText: string | undefined;

/** created on the first successful apply — before that there is nothing to show */
function ensureViewer(): Map0Viewer {
  if (viewer) return viewer;
  viewer = document.createElement("map0-viewer") as Map0Viewer;
  viewer.setAttribute("loading", "eager");
  /* the topbar's theme handler only reaches viewers that exist when it runs */
  try {
    const theme = localStorage.getItem("map0-theme");
    if (theme === "dark" || theme === "light") viewer.setAttribute("theme", theme);
  } catch {
    /* no localStorage, no override */
  }
  mapPane!.prepend(viewer);
  return viewer;
}

function setStale(stale: boolean): void {
  if (stale) mapPane!.setAttribute("data-stale", "");
  else mapPane!.removeAttribute("data-stale");
  applyButton!.disabled = !stale;
}

async function apply(): Promise<void> {
  const raw = editor.getValue();
  const { ok, config } = await check(raw);
  if (!ok || raw !== editor.getValue()) return; // invalid, or edited while checking
  appliedText = raw;
  const v = ensureViewer();
  v.config = config; // a fresh object every time — the viewer reloads on identity
  setStale(false);
  void check(raw); // re-render the status as "the map shows this config"
}

/* -------------------------------- wiring --------------------------------- */

let debounce: ReturnType<typeof setTimeout> | undefined;
editor.session.on("change", () => {
  setStale(appliedText !== undefined && editor.getValue().trim() !== appliedText.trim());
  clearTimeout(debounce);
  debounce = setTimeout(() => void check(editor.getValue()), 250);
});

editor.commands.addCommand({
  name: "map0-apply",
  bindKey: { win: "Ctrl-Enter", mac: "Cmd-Enter" },
  exec: () => void apply(),
});

applyButton.addEventListener("click", () => void apply());
document
  .querySelector("[data-pg-apply-veil]")
  ?.addEventListener("click", () => void apply());

document.querySelector("[data-pg-format]")?.addEventListener("click", () => {
  try {
    editor.setValue(JSON.stringify(JSON.parse(editor.getValue()), null, 2), -1);
  } catch {
    void check(editor.getValue()); // not parseable — the results say why
  }
});

/* ---------------------------------- boot --------------------------------- */

/** editor content by URL: ?config=<same-site path> | ?c=<json> | the example */
async function initialText(): Promise<string> {
  const params = new URLSearchParams(location.search);
  const src = params.get("config");
  if (src && src.startsWith("/") && !src.startsWith("//")) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.text()).trim();
    } catch {
      return `// ${STR.loadFailed(src)}`;
    }
  }
  const inline = params.get("c");
  if (inline) {
    try {
      return JSON.stringify(JSON.parse(inline), null, 2);
    } catch {
      /* mangled URL — fall through to the example */
    }
  }
  return EXAMPLE;
}

void initialText().then((text) => {
  editor.setValue(text, -1);
  void apply();
});
