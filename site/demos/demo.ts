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

/* ---------------------------------- boot --------------------------------- */

const id = document.body.dataset.demo;
const current = DEMOS.find((d) => d.id === id);

const galleryHost = document.querySelector("[data-gallery]");
if (galleryHost) galleryHost.innerHTML = gallery();

if (current) {
  const main = document.querySelector("main");
  main?.insertAdjacentHTML("beforeend", pager(current));
}

void enhanceCode();
