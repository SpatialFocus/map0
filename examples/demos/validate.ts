/**
 * The online validator: map0's own `validateConfig` — the exact code the
 * viewer runs before it renders anything — wired to a textarea. No server
 * involved: the schema package is compiled into this page the same way it is
 * compiled into the viewer, so the two can never disagree.
 */
import { validateConfig } from "@map0/schema";

const EXAMPLES = {
  /* three errors and one typo warning — every kind of feedback on one screen */
  broken: `{
  "$schema": "https://map0.net/schema/v1.json",
  "version": 1,
  "basemaps": [
    { "type": "style", "title": "basemap.at" }
  ],
  "layers": [
    {
      "type": "wms",
      "title": "Noise map",
      "url": "https://sdi.example.gv.at/ows",
      "opacity": 2,
      "transparence": true
    }
  ]
}`,
  valid: `{
  "$schema": "https://map0.net/schema/v1.json",
  "version": 1,
  "map": { "center": [16.3725, 48.2083], "zoom": 12 },
  "basemaps": [
    {
      "type": "style",
      "url": "https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json"
    }
  ],
  "layers": [
    {
      "type": "wms",
      "title": "Zoning plan",
      "url": "https://data.wien.gv.at/daten/geo",
      "layers": "GENFLWIDMUNGOGD"
    }
  ]
}`,
};

const input = document.querySelector<HTMLTextAreaElement>("[data-validator-input]");
const output = document.querySelector<HTMLElement>("[data-validator-output]");

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

function render(): void {
  if (!input || !output) return;
  output.textContent = "";
  const status = document.createElement("p");
  status.className = "status";
  const list = document.createElement("ul");
  output.append(status, list);

  const raw = input.value.trim();
  if (!raw) {
    status.textContent = "Paste a config to check it.";
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    status.textContent = "Not JSON yet";
    status.classList.add("bad");
    row(list, "error", "$", (e as Error).message);
    return;
  }

  const result = validateConfig(parsed);
  const warnings =
    result.warnings.length > 0
      ? ` (${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"})`
      : "";
  if (result.valid) {
    status.textContent = `Valid — the map opens${warnings}`;
    status.classList.add("ok");
  } else {
    status.textContent =
      `${result.errors.length} error${result.errors.length === 1 ? "" : "s"}` +
      `${warnings} — the viewer renders these instead of a map`;
    status.classList.add("bad");
  }
  for (const e of result.errors) row(list, "error", e.path, e.message);
  for (const w of result.warnings) row(list, "warning", w.path, w.message);
}

if (input && output) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(pending);
    pending = setTimeout(render, 150);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-validator-example]")) {
    button.addEventListener("click", () => {
      input.value = EXAMPLES[button.dataset.validatorExample as keyof typeof EXAMPLES];
      render();
    });
  }
  input.value = EXAMPLES.broken;
  render();
}
