/**
 * Build-time rendering of everything the site used to draw in the browser: the
 * demo gallery, the prev/next pager, the quick-start snippet and every code
 * figure. A crawler without JavaScript — every AI crawler, and a search engine
 * before it gets round to rendering — now sees the same page a visitor does,
 * and the configs the demos run on are in the HTML instead of behind a fetch.
 *
 * Runs on the finished HTML of BOTH language variants (see index.ts), so every
 * function here takes the language and replaces what an earlier pass rendered.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { HTMLElement } from "node-html-parser";
import { DEMOS, GROUPS, GROUP_LABELS_DE, type Demo } from "../demos/demos.js";
import { dedent, escapeHtml, figureHtml } from "../highlight.js";

export type Lang = "en" | "de";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const STR = {
  en: { copy: "Copy", prev: "Previous", next: "Next", pager: "Demo navigation" },
  de: { copy: "Kopieren", prev: "Zurück", next: "Weiter", pager: "Demo-Navigation" },
} as const;

export const langPrefix = (lang: Lang): string => (lang === "de" ? "/de" : "");
export const demoTitle = (d: Demo, lang: Lang): string => (lang === "de" && d.titleDe) || d.title;
export const demoBlurb = (d: Demo, lang: Lang): string => (lang === "de" ? d.blurbDe : d.blurb);
export const demoHref = (d: Demo, lang: Lang): string => `${langPrefix(lang)}/demos/${d.id}`;

/** the demo a page belongs to ("demos/wms.html" → the wms entry), if any */
export function demoFor(page: string): Demo | undefined {
  const m = /^demos\/([^/]+)\.html$/.exec(page);
  return m ? DEMOS.find((d) => d.id === m[1]) : undefined;
}

/** the published package the CDN snippet pins — read from the package so it cannot drift */
export const PKG = JSON.parse(readFileSync(r("../../packages/map0/package.json"), "utf8")) as {
  name: string;
  version: string;
};
export const CDN_URL = `https://cdn.jsdelivr.net/npm/${PKG.name}@${PKG.version}/dist/map0.js`;

/* --------------------------------- gallery -------------------------------- */

export function galleryHtml(lang: Lang): string {
  return GROUPS.map((group) => {
    const cards = DEMOS.filter((d) => d.group === group)
      .map(
        (d) =>
          `<a class="card" href="${demoHref(d, lang)}">` +
          `<div class="icon">${d.icon}</div>` +
          `<h3>${escapeHtml(demoTitle(d, lang))}</h3>` +
          `<p>${escapeHtml(demoBlurb(d, lang))}</p>` +
          `</a>`,
      )
      .join("");
    const label = lang === "de" ? GROUP_LABELS_DE[group] : group;
    return `<h2 class="group-title">${escapeHtml(label)}</h2><div class="grid">${cards}</div>`;
  }).join("");
}

/* ---------------------------------- pager --------------------------------- */

export function pagerHtml(current: Demo, lang: Lang): string {
  const i = DEMOS.findIndex((d) => d.id === current.id);
  const prev = DEMOS[i - 1];
  const next = DEMOS[i + 1];
  const s = STR[lang];
  const link = (d: Demo, label: string, cls = ""): string =>
    `<a${cls ? ` class="${cls}"` : ""} href="${demoHref(d, lang)}"><small>${label}</small>${d.icon} ${escapeHtml(demoTitle(d, lang))}</a>`;
  return (
    `<nav class="pager" data-pager aria-label="${s.pager}">` +
    (prev ? link(prev, s.prev) : "<span></span>") +
    (next ? link(next, s.next, "next") : "") +
    `</nav>`
  );
}

/* ------------------------------- quick start ------------------------------ */

/* The landing page's quick-start snippet is generated FROM the element running
   next to it — the inline JSON of #quickstart — so the two can never drift. */
function quickStart(root: HTMLElement, lang: Lang): void {
  const host = root.querySelector("[data-quickstart]");
  const inline = root.querySelector('#quickstart > script[type="application/json"]');
  if (!host || !inline) return;

  const raw = inline.rawText; // a <script>'s content is raw text: no entity decoding
  const config = dedent(raw)
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  /* One snippet, one Copy button, a page that runs: the CDN line belongs in it.
     Self-hosting only swaps this src for your own folder — that is a developer
     concern and lives in the README, not on the landing page. */
  const snippet = [
    `<script type="module"`,
    `        src="${CDN_URL}">`,
    `</script>`,
    ``,
    `<map0-viewer style="height:520px">`,
    `  <script type="application/json">`,
    config,
    `  </script>`,
    `</map0-viewer>`,
  ].join("\n");

  host.replaceWith(
    figureHtml("index.html", snippet, "html", {
      copyLabel: STR[lang].copy,
      className: "full", // a quick start nobody can read is not one
      attrs: "data-quickstart",
    }),
  );

  /* the button below the snippet hands this same config to the playground */
  const link = root.querySelector("[data-playground-link]");
  if (link) {
    const json = JSON.stringify(JSON.parse(raw)); // invalid JSON here is a bug: let the build fail
    link.setAttribute("href", `${langPrefix(lang)}/playground/?c=${encodeURIComponent(json)}`);
  }
}

/* ------------------------------- code figures ----------------------------- */

/**
 * Every <pre data-src> is filled from the very file the map loads — the rule
 * that keeps a printed config identical to the running one — and every
 * <pre data-lang> inline snippet is highlighted. A data-src that points at
 * nothing fails the build: a demo whose config block silently stays empty would
 * look finished and be broken.
 */
function codeFigures(root: HTMLElement, page: string, lang: Lang): void {
  for (const pre of root.querySelectorAll("pre[data-src], pre[data-lang]")) {
    const src = pre.getAttribute("data-src");
    const needles = (pre.getAttribute("data-emphasise") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let label: string;
    let code: string;
    let lang_: string;
    if (src) {
      const file = r(`../public${src}`);
      if (!existsSync(file)) throw new Error(`${page}: <pre data-src="${src}"> — no such file under site/public/`);
      label = pre.getAttribute("data-label") ?? src.split("/").pop() ?? src;
      code = readFileSync(file, "utf8").trimEnd();
      lang_ = pre.getAttribute("data-lang") ?? "json";
    } else {
      label = pre.getAttribute("data-label") ?? "snippet";
      code = dedent(pre.textContent); // decoded: the source writes &lt;script&gt;
      lang_ = pre.getAttribute("data-lang") ?? "html";
    }
    pre.replaceWith(figureHtml(label, code, lang_, { needles, copyLabel: STR[lang].copy }));
  }
  /* figures rendered by an earlier (English) pass keep their code; only the button text is language */
  for (const button of root.querySelectorAll("figure.code [data-copy]")) button.set_content(STR[lang].copy);
}

/* ---------------------------------- entry --------------------------------- */

export function renderStatic(root: HTMLElement, page: string, lang: Lang): void {
  const gallery = root.querySelector("[data-gallery]");
  if (gallery) gallery.set_content(galleryHtml(lang));

  const id = root.querySelector("body")?.getAttribute("data-demo");
  const current = id ? DEMOS.find((d) => d.id === id) : undefined;
  if (current) {
    const html = pagerHtml(current, lang);
    const existing = root.querySelector("[data-pager]");
    if (existing) existing.replaceWith(html);
    else root.querySelector("main")?.insertAdjacentHTML("beforeend", html);
  }

  quickStart(root, lang);
  codeFigures(root, page, lang);
}
