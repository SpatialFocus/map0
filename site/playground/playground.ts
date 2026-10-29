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
   worker Ace ships and the build would emit them all as chunks — megabytes of
   PHP/XQuery/Vim nobody here can ever load. This page needs exactly four
   pieces: the core, the JSON mode, one theme, and the search box (Ctrl-F).

   No linting worker (`useWorker: false` on the editor): Ace's JSON worker is
   wired without a schema request service, so a document with a `$schema` URL —
   every map0 config — makes it throw on each update, after which it reports
   nothing, not even syntax errors, and logs a TypeError every time (ace-builds
   1.45). This page parses and validates on every change anyway, so it places
   the gutter marks itself: jsonc-parser says where the JSON breaks, and the
   validator's paths say which line a config problem belongs to. That also
   saves the worker's 280 KB download. */
import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-tomorrow_night";
import "ace-builds/src-noconflict/ext-searchbox";
import { findNodeAtLocation, parseTree, type Node, type ParseError } from "jsonc-parser";
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
        valid: (w: string) => `Gültig: Übernehmen lädt die Karte${w}`,
        applied: (w: string) => `Gültig: die Karte zeigt diese Config${w}`,
        invalid: (e: number, w: string) =>
          `${e} Fehler${w}: die Karte bleibt auf dem letzten gültigen Stand`,
        warnings: (n: number) => ` (${n} Warnung${n === 1 ? "" : "en"})`,
        loadFailed: (src: string) => `${src} konnte nicht geladen werden`,
      }
    : {
        empty: "Paste a config to check it.",
        notJson: "Not JSON yet",
        valid: (w: string) => `Valid: Apply loads the map${w}`,
        applied: (w: string) => `Valid: the map shows this config${w}`,
        invalid: (e: number, w: string) =>
          `${e} error${e === 1 ? "" : "s"}${w}: the map keeps the last valid state`,
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
  useWorker: false, // before `mode`, or the mode starts the worker first — see the Ace note above
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

/* ------------------------------ gutter marks ----------------------------- */

/** an Ace annotation: a mark in the gutter with the message as its tooltip */
interface GutterMark {
  row: number;
  column: number;
  text: string;
  type: "error" | "warning";
}

/** 0-based row and column of a character offset in `text` */
function positionAt(text: string, offset: number): { row: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lineStart = before.lastIndexOf("\n") + 1;
  return { row: before.split("\n").length - 1, column: before.length - lineStart };
}

/** the validator's path grammar: `$.layers[0].url` → ["layers", 0, "url"], `$` → [] */
function segmentsOf(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const m of path.slice(1).matchAll(/\.([^.[\]]+)|\[(\d+)\]/g)) {
    segments.push(m[1] !== undefined ? m[1] : Number(m[2]));
  }
  return segments;
}

/**
 * Where the JSON breaks: the first error jsonc-parser finds, which is where
 * JSON.parse gave up too (comments and trailing commas count as errors here,
 * as they do for the viewer). Undefined when it finds none.
 */
function syntaxErrorAt(text: string): number | undefined {
  const errors: ParseError[] = [];
  parseTree(text, errors, { disallowComments: true });
  return errors[0]?.offset;
}

/** marks for the validator's findings — those whose path exists in the text */
function marksFor(
  text: string,
  tree: Node | undefined,
  findings: { path: string; message: string }[],
  type: GutterMark["type"],
): GutterMark[] {
  if (!tree) return [];
  const marks: GutterMark[] = [];
  for (const { path, message } of findings) {
    /* absent: a key the config lacks, or one the base of an `extends` contributed —
       the list below the editor still has it */
    const node = findNodeAtLocation(tree, segmentsOf(path));
    if (!node) continue;
    /* the key rather than the value: a value on its own line would mark the wrong row */
    const at = node.parent?.type === "property" ? node.parent : node;
    marks.push({ ...positionAt(text, at.offset), text: message, type });
  }
  return marks;
}

let checkSeq = 0;

/**
 * Parse, resolve `extends`, validate — and render the outcome below the
 * editor and in its gutter. Resolving before validating matches what the
 * viewer itself does, so a child config that leaves `basemaps` to its base
 * validates here too.
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
    editor.session.clearAnnotations();
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const message = (e as Error).message;
    status.textContent = STR.notJson;
    status.classList.add("bad");
    row(list, "error", "$", message);
    show();
    const offset = syntaxErrorAt(raw);
    editor.session.setAnnotations(
      offset === undefined ? [] : [{ ...positionAt(raw, offset), text: message, type: "error" }],
    );
    return { ok: false };
  }
  const tree = parseTree(raw);

  let resolved: unknown;
  try {
    resolved = await resolveConfigExtends(parsed);
  } catch (e) {
    if (stale()) return { ok: false };
    const message = e instanceof Error ? e.message : String(e);
    status.textContent = STR.invalid(1, "");
    status.classList.add("bad");
    row(list, "error", "$.extends", message);
    show();
    editor.session.setAnnotations(marksFor(raw, tree, [{ path: "$.extends", message }], "error"));
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
  editor.session.setAnnotations([
    ...marksFor(raw, tree, result.errors, "error"),
    ...marksFor(raw, tree, result.warnings, "warning"),
  ]);
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
