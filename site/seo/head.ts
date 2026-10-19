/**
 * The head a crawler reads: description, canonical URL, Open Graph, Twitter
 * card and schema.org JSON-LD for every page, in the page's language. All of it
 * is derived from what is already on the page or in the repo — the title, the
 * translated description, the demo registry, the FAQ, the company data of the
 * imprint, the package version — so nothing here can drift from what it
 * describes. Runs after translation, so the German variant gets German values.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse, type HTMLElement } from "node-html-parser";
import { SITE_URL, prettyPath } from "../i18n/translate.js";
import { escapeAttr } from "../highlight.js";
import { PKG, demoFor, langPrefix, type Lang } from "./render.js";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const GITHUB_URL = "https://github.com/SpatialFocus/map0";
export const NPM_URL = "https://www.npmjs.com/package/map0-viewer";

/** width and height of a JPEG, from its start-of-frame marker */
function jpegSize(file: string): { width: number; height: number } | undefined {
  const b = readFileSync(file);
  let i = 2; // past the SOI marker
  while (i + 9 < b.length && b[i] === 0xff) {
    const marker = b[i + 1]!;
    const length = b.readUInt16BE(i + 2);
    /* SOF0…SOF15 carry the dimensions; C4, C8 and CC are other tables */
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + length;
  }
  return undefined;
}

/** the social image, when `pnpm og` has produced it (site/public/og.jpg) */
const OG_FILE = r("../public/og.jpg");
export const OG_IMAGE = existsSync(OG_FILE) ? { url: `${SITE_URL}/og.jpg`, ...jpegSize(OG_FILE) } : undefined;

/* The one-paragraph description of the product, from the start page — the
   English meta description and its German catalogue entry. */
export const SITE_DESCRIPTION: Record<Lang, string> = {
  en:
    parse(readFileSync(r("../index.html"), "utf8"))
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") ?? "",
  de:
    (JSON.parse(readFileSync(r("../i18n/de/index.json"), "utf8")) as Record<string, string>)["meta.description"] ??
    "",
};

/* the operator, as stated in the imprint */
const ORGANIZATION = {
  "@type": "Organization",
  "@id": "https://www.spatial-focus.net/#organization",
  name: "Spatial Focus GmbH",
  url: "https://www.spatial-focus.net",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Absberggasse 27/7/3",
    postalCode: "1100",
    addressLocality: "Vienna",
    addressCountry: "AT",
  },
};

const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

const STR = {
  en: { home: "Home", demos: "Demos", ogAlt: "The map0 wordmark and tagline over a live web map of Vienna" },
  de: { home: "Start", demos: "Demos", ogAlt: "map0-Wortmarke und Slogan über einer Webkarte von Wien" },
} as const;

/** whitespace-collapsed text of an element, entities decoded */
const text = (el: HTMLElement | null | undefined): string => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** the demo pages' description, from the registry — the pages themselves carry none */
function demoDescription(page: string, lang: Lang): string | undefined {
  const demo = demoFor(page);
  if (!demo) return undefined;
  return lang === "de"
    ? `${demo.blurbDe} Eine map0-Demo mit Live-Karte und der zugehörigen JSON-Konfiguration.`
    : `${demo.blurb} A map0 demo with a live map and the exact JSON configuration it runs on.`;
}

/* --------------------------------- JSON-LD -------------------------------- */

function software(lang: Lang): Record<string, unknown> {
  return {
    "@type": ["SoftwareApplication", "SoftwareSourceCode"],
    "@id": SOFTWARE_ID,
    name: "map0",
    alternateName: PKG.name,
    url: `${SITE_URL}/`,
    description: SITE_DESCRIPTION[lang],
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web browser",
    runtimePlatform: "Web browser",
    programmingLanguage: "TypeScript",
    softwareVersion: PKG.version,
    license: `${GITHUB_URL}/blob/main/LICENSE`,
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    codeRepository: GITHUB_URL,
    downloadUrl: NPM_URL,
    softwareHelp: { "@type": "CreativeWork", url: `${GITHUB_URL}#readme` },
    author: { "@id": ORGANIZATION["@id"] },
    publisher: { "@id": ORGANIZATION["@id"] },
    sameAs: [GITHUB_URL, NPM_URL],
    ...(OG_IMAGE ? { screenshot: OG_IMAGE.url } : {}),
  };
}

/** the FAQ on the start page, read back from its <details> so the two cannot disagree */
function faq(root: HTMLElement): Record<string, unknown> | undefined {
  const items = root.querySelectorAll("#faq details");
  if (items.length === 0) return undefined;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => {
      const summary = item.querySelector("summary");
      const answer = item.childNodes
        .filter((n) => n !== summary)
        .map((n) => (n as HTMLElement).textContent ?? "")
        .join(" ");
      return {
        "@type": "Question",
        name: text(summary),
        acceptedAnswer: { "@type": "Answer", text: answer.replace(/\s+/g, " ").trim() },
      };
    }),
  };
}

function breadcrumb(root: HTMLElement, page: string, lang: Lang, url: string): Record<string, unknown> | undefined {
  if (page === "index.html") return undefined;
  const home = `${SITE_URL}${langPrefix(lang)}/`;
  const trail: Array<{ name: string; item?: string }> = [{ name: STR[lang].home, item: home }];
  if (page.startsWith("demos/") && page !== "demos/index.html")
    trail.push({ name: STR[lang].demos, item: `${SITE_URL}${langPrefix(lang)}/demos/` });
  trail.push({ name: text(root.querySelector("h1")) || text(root.querySelector("title")), item: url });
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: step.name,
      item: step.item,
    })),
  };
}

/* ---------------------------------- entry --------------------------------- */

/**
 * Write the crawler-facing head of one page. Idempotent: everything this adds
 * carries `data-seo`, and a later pass (the German one) removes and rewrites it.
 * Pages marked noindex (the 404) get nothing.
 */
export function applyHead(root: HTMLElement, page: string, lang: Lang): void {
  const head = root.querySelector("head");
  if (!head) return;
  for (const el of root.querySelectorAll("[data-seo]")) el.remove();
  if (root.querySelector('meta[name="robots"][content*="noindex"]')) return;

  const title = text(root.querySelector("title")) || "map0";
  let description = root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
  if (!description) {
    description = demoDescription(page, lang);
    if (description) head.insertAdjacentHTML("beforeend", `<meta name="description" content="${escapeAttr(description)}" data-seo>`);
  }

  const url = `${SITE_URL}${langPrefix(lang)}${prettyPath(page)}`;
  const other: Lang = lang === "de" ? "en" : "de";
  const tags = [
    `<link rel="canonical" href="${url}" data-seo>`,
    `<meta property="og:type" content="website" data-seo>`,
    `<meta property="og:site_name" content="map0" data-seo>`,
    `<meta property="og:title" content="${escapeAttr(title)}" data-seo>`,
    description ? `<meta property="og:description" content="${escapeAttr(description)}" data-seo>` : "",
    `<meta property="og:url" content="${url}" data-seo>`,
    `<meta property="og:locale" content="${lang === "de" ? "de_DE" : "en_US"}" data-seo>`,
    `<meta property="og:locale:alternate" content="${other === "de" ? "de_DE" : "en_US"}" data-seo>`,
    ...(OG_IMAGE
      ? [
          `<meta property="og:image" content="${OG_IMAGE.url}" data-seo>`,
          ...(OG_IMAGE.width && OG_IMAGE.height
            ? [
                `<meta property="og:image:width" content="${OG_IMAGE.width}" data-seo>`,
                `<meta property="og:image:height" content="${OG_IMAGE.height}" data-seo>`,
              ]
            : []),
          `<meta property="og:image:alt" content="${escapeAttr(STR[lang].ogAlt)}" data-seo>`,
        ]
      : []),
    `<meta name="twitter:card" content="${OG_IMAGE ? "summary_large_image" : "summary"}" data-seo>`,
  ].filter(Boolean);
  head.insertAdjacentHTML("beforeend", `\n    ${tags.join("\n    ")}`);

  const graph: unknown[] = [
    ORGANIZATION,
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: `${SITE_URL}/`,
      name: "map0",
      inLanguage: ["en", "de"],
      publisher: { "@id": ORGANIZATION["@id"] },
    },
    {
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name: title,
      ...(description ? { description } : {}),
      inLanguage: lang,
      isPartOf: { "@id": WEBSITE_ID },
      about: { "@id": SOFTWARE_ID },
    },
  ];
  if (page === "index.html") graph.push(software(lang));
  const crumbs = breadcrumb(root, page, lang, url);
  if (crumbs) graph.push(crumbs);
  const questions = faq(root);
  if (questions) graph.push(questions);

  /* "<" escaped: a description could otherwise close the script element */
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
  head.insertAdjacentHTML("beforeend", `\n    <script type="application/ld+json" data-seo>${json}</script>\n  `);
}
