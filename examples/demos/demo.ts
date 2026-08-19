/**
 * Shared shell for every demo page: gallery grid and prev/next pager (topbar
 * and footer are injected by vite.config.ts on every page of the site).
 * Code blocks come from ../code.ts, which the landing page uses as well.
 */
import { DEMOS, GROUPS, type Demo } from "./demos.js";
import { enhanceCode } from "../code.js";

/* The standalone demo ships the built bundle and registers the element itself.
   It must NOT fall back to the sources: a silent fallback would make a broken
   bundle look like a working page. Every other demo runs from source. */
if (document.body.dataset.client !== "bundle") await import("@map0/ui");

/* --------------------------------- chrome -------------------------------- */

function pager(current: Demo): string {
  const i = DEMOS.findIndex((d) => d.id === current.id);
  const prev = DEMOS[i - 1];
  const next = DEMOS[i + 1];
  return `
    <div class="pager">
      ${prev ? `<a href="/demos/${prev.id}.html"><small>Previous</small>${prev.icon} ${prev.title}</a>` : "<span></span>"}
      ${next ? `<a class="next" href="/demos/${next.id}.html"><small>Next</small>${next.icon} ${next.title}</a>` : ""}
    </div>`;
}

function gallery(): string {
  return GROUPS.map((group) => {
    const cards = DEMOS.filter((d) => d.group === group)
      .map(
        (d) => `
        <a class="card" href="/demos/${d.id}.html">
          <div class="icon">${d.icon}</div>
          <h3>${d.title}</h3>
          <p>${d.blurb}</p>
        </a>`,
      )
      .join("");
    return `<h2 class="group-title">${group}</h2><div class="grid">${cards}</div>`;
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
