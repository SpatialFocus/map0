/**
 * Shared shell for every demo page: top bar, gallery grid, prev/next pager and
 * code blocks. Config snippets are FETCHED from the very file the map loads, so
 * a snippet can never drift from the running demo.
 */
import { DEMOS, GROUPS, type Demo } from "./demos.js";

/* The standalone demo ships the built bundle and registers the element itself.
   It must NOT fall back to the sources: a silent fallback would make a broken
   bundle look like a working page. Every other demo runs from source. */
if (document.body.dataset.client !== "bundle") await import("@map0/ui");

/* --------------------------------- chrome -------------------------------- */

function topbar(current?: Demo): string {
  return `
    <div class="topbar">
      <a class="brand" href="/">map<span>0</span></a>
      <nav>
        <a href="/demos/" ${current ? "" : 'aria-current="page"'}>All demos</a>
        ${current ? `<a href="/demos/${current.id}.html" aria-current="page">${current.title}</a>` : ""}
      </nav>
    </div>`;
}

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

/* ------------------------------ highlighting ----------------------------- */

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function highlightJson(src: string): string {
  return escapeHtml(src).replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|\b(-?\d+(?:\.\d+)?)\b/g,
    (match, str: string, colon: string, bool: string, num: string) => {
      if (str) {
        return colon
          ? `<span class="tok-key">${str}</span><span class="tok-punct">${colon}</span>`
          : `<span class="tok-str">${str}</span>`;
      }
      if (bool) return `<span class="tok-bool">${bool}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      return match;
    },
  );
}

/* Single pass, always: chained replaces would re-process the markup they just
   inserted and mangle it (a <span class="tok-tag"> read back as an attribute). */

function highlightMarkup(src: string): string {
  return escapeHtml(src).replace(
    /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([a-zA-Z][\w-]*)((?:[^&]|&(?!gt;))*?)(\/?&gt;)/g,
    (match, comment: string, lt: string, tag: string, attrs: string, gt: string) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (!tag) return match;
      const highlightedAttrs = attrs.replace(
        /([\w-]+)(=)(&quot;[^&]*?&quot;|'[^']*')/g,
        (_, name: string, eq: string, value: string) =>
          `<span class="tok-attr">${name}</span>${eq}<span class="tok-str">${value}</span>`,
      );
      return `<span class="tok-punct">${lt}</span><span class="tok-tag">${tag}</span>${highlightedAttrs}<span class="tok-punct">${gt}</span>`;
    },
  );
}

const JS_KEYWORDS = /^(const|let|await|async|function|return|import|export|from|new|if|else|for|of)$/;

function highlightJs(src: string): string {
  return escapeHtml(src).replace(
    /(\/\/[^\n]*)|('[^']*'|&quot;[^&]*?&quot;|`[^`]*`)|\b([A-Za-z_$][\w$]*)\b/g,
    (match, comment: string, str: string, word: string) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (word && JS_KEYWORDS.test(word)) return `<span class="tok-bool">${word}</span>`;
      return match;
    },
  );
}

/** wrap lines containing any of the given needles in a highlight marker */
function emphasise(html: string, needles: string[]): string {
  if (needles.length === 0) return html;
  return html
    .split("\n")
    .map((line) => {
      const plain = line.replace(/<[^>]+>/g, "");
      return needles.some((n) => plain.includes(n)) ? `<mark class="line">${line}</mark>` : line;
    })
    .join("\n");
}

function renderCode(pre: HTMLPreElement, label: string, code: string, lang: string): void {
  const highlighter =
    lang === "json"
      ? highlightJson
      : lang === "js"
        ? highlightJs
        : lang === "html"
          ? highlightMarkup
          : escapeHtml; // css, text, anything else: escaped but unstyled
  const highlighted = highlighter(code);
  const needles = (pre.dataset.emphasise ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const figure = document.createElement("figure");
  figure.className = "code";
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  const copy = document.createElement("button");
  copy.className = "copy";
  copy.type = "button";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(code).then(() => {
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1600);
    });
  });
  caption.appendChild(copy);
  const target = document.createElement("pre");
  target.innerHTML = emphasise(highlighted, needles);
  figure.append(caption, target);
  pre.replaceWith(figure);
}

async function enhanceCode(): Promise<void> {
  const blocks = [...document.querySelectorAll<HTMLPreElement>("pre[data-src], pre[data-lang]")];
  await Promise.all(
    blocks.map(async (pre) => {
      const src = pre.dataset.src;
      if (src) {
        const label = pre.dataset.label ?? src.split("/").pop() ?? src;
        try {
          const res = await fetch(src);
          const text = (await res.text()).trimEnd();
          renderCode(pre, label, text, pre.dataset.lang ?? "json");
        } catch {
          pre.textContent = `could not load ${src}`;
        }
        return;
      }
      /* inline snippet: de-indent to the shallowest line */
      const raw = (pre.textContent ?? "").replace(/^\n/, "").trimEnd();
      const indent = Math.min(
        ...raw
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => l.match(/^ */)![0].length),
      );
      const code = raw
        .split("\n")
        .map((l) => l.slice(indent))
        .join("\n");
      renderCode(pre, pre.dataset.label ?? "snippet", code, pre.dataset.lang ?? "html");
    }),
  );
}

/* ---------------------------------- boot --------------------------------- */

const id = document.body.dataset.demo;
const current = DEMOS.find((d) => d.id === id);
document.body.insertAdjacentHTML("afterbegin", topbar(current));

const galleryHost = document.querySelector("[data-gallery]");
if (galleryHost) galleryHost.innerHTML = gallery();

if (current) {
  const main = document.querySelector("main");
  main?.insertAdjacentHTML("beforeend", pager(current));
}

document.body.insertAdjacentHTML(
  "beforeend",
  `<footer class="site">map0 — working title · demo services: basemap.at, Stadt Wien OGD, MapLibre demo tiles</footer>`,
);

void enhanceCode();
