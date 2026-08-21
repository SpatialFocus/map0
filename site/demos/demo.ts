/**
 * Shared shell for every demo page: gallery grid and prev/next pager (topbar
 * and footer are injected by vite.config.ts on every page of the site).
 * Code blocks come from ../code.ts, which the landing page uses as well.
 */
import { DEMOS, GROUPS, GROUP_LABELS_DE, type Demo } from "./demos.js";
import { enhanceCode } from "../code.js";
import { LANG, LANG_PREFIX } from "../lang.js";

/* The standalone demo ships the built bundle and registers the element itself.
   It must NOT fall back to the sources: a silent fallback would make a broken
   bundle look like a working page. Every other demo runs from source. */
if (document.body.dataset.client !== "bundle") await import("@map0/ui");

/* --------------------------------- chrome -------------------------------- */

const title = (d: Demo): string => (LANG === "de" && d.titleDe) || d.title;
const blurb = (d: Demo): string => (LANG === "de" ? d.blurbDe : d.blurb);
const href = (d: Demo): string => `${LANG_PREFIX}/demos/${d.id}.html`;

function pager(current: Demo): string {
  const i = DEMOS.findIndex((d) => d.id === current.id);
  const prev = DEMOS[i - 1];
  const next = DEMOS[i + 1];
  const [prevLabel, nextLabel] = LANG === "de" ? ["Zurück", "Weiter"] : ["Previous", "Next"];
  return `
    <div class="pager">
      ${prev ? `<a href="${href(prev)}"><small>${prevLabel}</small>${prev.icon} ${title(prev)}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="${href(next)}"><small>${nextLabel}</small>${next.icon} ${title(next)}</a>` : ""}
    </div>`;
}

function gallery(): string {
  return GROUPS.map((group) => {
    const cards = DEMOS.filter((d) => d.group === group)
      .map(
        (d) => `
        <a class="card" href="${href(d)}">
          <div class="icon">${d.icon}</div>
          <h3>${title(d)}</h3>
          <p>${blurb(d)}</p>
        </a>`,
      )
      .join("");
    const label = LANG === "de" ? GROUP_LABELS_DE[group] : group;
    return `<h2 class="group-title">${label}</h2><div class="grid">${cards}</div>`;
  }).join("");
}

/* ----------------------------- playground links --------------------------- */

/* Every map on a demo page gets an "Open in the playground" pill that carries
   its config over — as a `?config=` path where the config is a file, as `?c=`
   JSON where it is inline in the page (the minimal demo). The pill sits beside
   the heading the map belongs to: the page h1 for single-map demos, the
   section h2 above each map where a page has several (the COG demo). Injected
   here so a new demo gets its link without anyone remembering to add one. */
function playgroundLinks(): void {
  const label = LANG === "de" ? "Im Playground öffnen →" : "Open in the playground →";
  const taken = new Set<Element>();
  for (const viewer of document.querySelectorAll("map0-viewer")) {
    const src = viewer.getAttribute("config-src");
    const inline = viewer.querySelector(':scope > script[type="application/json"]')?.textContent;
    let query: string | null = src ? `config=${encodeURIComponent(src)}` : null;
    if (!query && inline?.trim()) {
      try {
        query = `c=${encodeURIComponent(JSON.stringify(JSON.parse(inline)))}`;
      } catch {
        continue; // a page demonstrating broken JSON has nothing to hand over
      }
    }
    if (!query) continue;
    const a = document.createElement("a");
    a.className = "try-playground";
    a.href = `${LANG_PREFIX}/playground/?${query}`;
    a.textContent = label;

    /* the nearest heading above the map, without crossing another map */
    let heading: Element | null = null;
    for (let sib = viewer.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.matches("map0-viewer")) break;
      heading = sib.matches("h1, h2, h3")
        ? sib
        : [...sib.querySelectorAll("h1, h2, h3")].at(-1) ?? null;
      if (heading) break;
    }
    if (heading && !taken.has(heading)) {
      taken.add(heading);
      heading.appendChild(a);
    } else {
      const p = document.createElement("p");
      p.className = "try-playground-row";
      p.appendChild(a);
      viewer.insertAdjacentElement("afterend", p);
    }
  }
}

/* ---------------------------------- boot --------------------------------- */

const id = document.body.dataset.demo;
const current = DEMOS.find((d) => d.id === id);

const galleryHost = document.querySelector("[data-gallery]");
if (galleryHost) galleryHost.innerHTML = gallery();

if (current) {
  const main = document.querySelector("main");
  main?.insertAdjacentHTML("beforeend", pager(current));
}

playgroundLinks();
void enhanceCode();
