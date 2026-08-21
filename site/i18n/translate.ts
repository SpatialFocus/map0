/**
 * Build-time page translation. The English page is the single source of truth:
 * elements carry `data-i18n="key"` (inner HTML) or `data-i18n-attrs="attr:key"`
 * (attribute values) and keep their English content inline as the default. One
 * JSON catalogue per page under i18n/de/ supplies the German values, and every
 * page is emitted twice — `/…` and `/de/…` — by the i18n plugin in
 * vite.config.ts. No framework, no runtime cost: the same pattern as the other
 * hand-rolled plugins of this site.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const SITE_URL = "https://map0.net";

/** every page of the site as "index.html" | "demos/wms.html" … (source scan) */
export function sitePages(): Set<string> {
  const pages = new Set<string>();
  for (const f of readdirSync(r(".."))) if (f.endsWith(".html")) pages.add(f);
  for (const f of readdirSync(r("../demos"))) if (f.endsWith(".html")) pages.add(`demos/${f}`);
  return pages;
}

/** "index.html" → "/", "demos/index.html" → "/demos/", "demos/wms.html" → "/demos/wms.html" */
export function prettyPath(page: string): string {
  const p = `/${page}`;
  return p.endsWith("/index.html") ? p.slice(0, -"index.html".length) : p === "/index.html" ? "/" : p;
}

/** merged catalogue for a page: chrome keys (every page) + the page's own file */
export function catalogFor(page: string): { catalog: Record<string, string>; found: boolean } {
  const catalog: Record<string, string> = {};
  const files = [r("de/_chrome.json"), r(`de/${page.replace(/\.html$/, ".json")}`)];
  let found = false;
  for (const file of files) {
    if (!existsSync(file)) continue;
    found = true;
    Object.assign(catalog, JSON.parse(readFileSync(file, "utf8")) as Record<string, string>);
  }
  return { catalog, found };
}

/** root-relative page links get the /de prefix; assets and external URLs do not */
function localizeHref(href: string, pages: Set<string>): string | undefined {
  if (!href.startsWith("/") || href.startsWith("/de/")) return undefined;
  const [path, hash] = href.split("#", 2) as [string, string?];
  const page = path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1);
  if (!pages.has(page === "" ? "index.html" : page)) return undefined;
  return `/de${path}${hash !== undefined ? `#${hash}` : ""}`;
}

export interface TranslateResult {
  html: string;
  /** keys the page asks for that the catalogue does not define (page stays English there) */
  missing: string[];
  /** catalogue keys no element on the page asks for (stale after an English edit) */
  stale: string[];
}

/** turn one built English page into its /de/ variant */
export function translatePage(
  html: string,
  page: string,
  catalog: Record<string, string>,
  pages: Set<string>,
): TranslateResult {
  const root = parse(html, { comment: true });
  const missing: string[] = [];
  const used = new Set<string>();

  root.querySelector("html")?.setAttribute("lang", "de");

  for (const el of root.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n")!;
    const value = catalog[key];
    if (value === undefined) missing.push(key);
    else {
      el.set_content(value);
      used.add(key);
    }
  }

  for (const el of root.querySelectorAll("[data-i18n-attrs]")) {
    for (const pair of el.getAttribute("data-i18n-attrs")!.split(",")) {
      const [attr, key] = pair.split(":").map((s) => s.trim()) as [string, string];
      const value = catalog[key];
      if (value === undefined) missing.push(key);
      else {
        el.setAttribute(attr, value);
        used.add(key);
      }
    }
  }

  /* parts that only make sense on the English variant (the browser-language redirect) */
  for (const el of root.querySelectorAll("[data-en-only]")) el.remove();

  /* internal page links follow the reader into /de/ — assets stay where they are */
  for (const a of root.querySelectorAll("a[href]")) {
    if (a.hasAttribute("data-lang")) continue; // the switcher always crosses languages
    const localized = localizeHref(a.getAttribute("href")!, pages);
    if (localized) a.setAttribute("href", localized);
  }

  /* the language switcher marks German as current here */
  for (const a of root.querySelectorAll("[data-lang]")) {
    if (a.getAttribute("data-lang") === "de") a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }

  const out = root.toString();
  return {
    html: out.startsWith("<!") ? out : `<!doctype html>\n${out}`,
    missing,
    stale: Object.keys(catalog).filter((k) => !used.has(k)),
  };
}
