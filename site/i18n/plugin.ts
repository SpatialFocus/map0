/**
 * The i18n plugin: emits every page a second time under /de/ (dev middleware +
 * build step), injects the hreflang alternates, and puts the one-time
 * browser-language redirect on the English start page. On the way out, every
 * variant of every page is also finished for crawlers by site/seo/ — canonical,
 * Open Graph, JSON-LD, and the gallery, pager and code figures rendered into
 * the HTML — and the build writes sitemap.xml, robots.txt and llms.txt. The
 * transformation itself lives in translate.ts; the catalogues in i18n/de/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { SITE_URL, catalogFor, pageForPath, prettyPath, sitePages, translatePage } from "./translate.js";
import { DEMOS } from "../demos/demos.js";
import { measure } from "../../scripts/check-size.mjs";
import { finishPage, llmsTxt, robotsTxt, sitemapXml, writeSiteFiles } from "../seo/index.js";

type Sizes = ReturnType<typeof measure>;
type Lang = "en" | "de";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* If no language was ever chosen, a German browser starts on /de/. localStorage
   (not a cookie: nothing here is sent to a server) remembers the choice the
   switcher makes — the same redirect-on-root behaviour as spatial-focus.net. */
const REDIRECT_SRC =
  `(function(){try{var l=localStorage.getItem("map0-lang");` +
  `if(l==="de"||(!l&&/^de/i.test(navigator.language||"")))location.replace("/de/"+location.hash)}catch(e){}})()`;

/* Every number on this site that could drift from reality is filled in here
   rather than typed: the demo count from the registry, the config-key count
   from the published schema, the bundle tiers from the built package. A marker
   must wrap only the number itself — unit, tilde and wording stay in the copy
   (and in the catalogues, so a translated sentence can carry one too). Runs on
   the final HTML of BOTH language variants. */
const once = <T>(compute: () => T): (() => T) => {
  let cache: { value: T } | undefined;
  return () => (cache ??= { value: compute() }).value;
};

/** distinct key names in the published schema: the configurable surface */
const schemaKeys = once((): number => {
  const names = new Set<string>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const properties = record["properties"];
    if (typeof properties === "object" && properties !== null)
      for (const key of Object.keys(properties)) names.add(key);
    for (const value of Object.values(record)) walk(value);
  };
  walk(JSON.parse(readFileSync(r("../../packages/schema/v1.json"), "utf8")));
  return names.size;
});

/** The measured bundle tiers, or undefined when there is no dist to weigh: dev
    serves the package from source, and the copy then keeps its written number.
    `pnpm build:site` builds the package first, so a deploy always has real ones. */
const bundle = once((): Sizes | undefined => {
  try {
    return measure();
  } catch {
    return undefined;
  }
});

/** smallest to largest single deferred chunk, e.g. "0.2–136" ("0,2–136" in German) */
function deferredRange(sizes: Sizes, lang: Lang): string {
  const chunks = sizes.rows.filter((row) => row.tier === "deferred").map((row) => row.kb);
  const decimal = lang === "de" ? "," : ".";
  const round = (n: number): string =>
    n < 10 ? n.toFixed(1).replace(".", decimal) : String(Math.round(n));
  return `${round(Math.min(...chunks))}–${round(Math.max(...chunks))}`;
}

const fill = (html: string, marker: string, value: string): string =>
  html.replace(
    new RegExp(String.raw`(<([a-z0-9]+)[^>]*${marker}[^>]*>)[^<]*(</\2>)`, "g"),
    `$1${value}$3`,
  );

function fillNumbers(html: string, lang: Lang): string {
  let out = fill(html, "data-demo-count", String(DEMOS.length));
  out = fill(out, "data-config-key-count", String(schemaKeys()));
  const sizes = bundle();
  if (sizes) {
    out = fill(out, 'data-size="page"', String(Math.round(sizes.page)));
    out = fill(out, 'data-size="map"', String(Math.round(sizes.map)));
    out = fill(out, 'data-size="deferred"', deferredRange(sizes, lang));
  }
  return out;
}

/** the /de/ twin of a finished English page: translated, then finished again in German */
function translateBuilt(html: string, page: string, pages: Set<string>, warnings: string[]): string {
  const { catalog, found } = catalogFor(page);
  if (!found) warnings.push(`${page}: no catalogue under site/i18n/de/ — emitted in English`);
  const { html: translated, missing, stale } = translatePage(html, page, catalog, pages);
  if (missing.length > 0) warnings.push(`${page}: missing keys → ${missing.join(", ")}`);
  if (stale.length > 0) warnings.push(`${page}: stale keys (nothing asks for them) → ${stale.join(", ")}`);
  return fillNumbers(finishPage(translated, page, "de"), "de");
}

export function i18n(outDir: string): Plugin {
  return {
    name: "map0:i18n",

    /* hreflang on both variants (the /de/ copy inherits these), redirect on / */
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => {
        const page = ctx.path.replace(/^\//, "");
        let out = fillNumbers(html, "en");
        /* dev finishes pages on the fly; the build finishes the emitted files (closeBundle),
           after Vite has put the hashed asset names in */
        if (ctx.server && sitePages().has(page)) out = finishPage(out, page, "en");
        if (page === "404.html") return { html: out, tags: [] }; // noindex — no alternates, no redirect
        const en = `${SITE_URL}${prettyPath(page)}`;
        const de = `${SITE_URL}/de${prettyPath(page)}`;
        return {
          html: out,
          tags: [
            { tag: "link", attrs: { rel: "alternate", hreflang: "en", href: en }, injectTo: "head" },
            { tag: "link", attrs: { rel: "alternate", hreflang: "de", href: de }, injectTo: "head" },
            { tag: "link", attrs: { rel: "alternate", hreflang: "x-default", href: en }, injectTo: "head" },
            ...(page === "index.html"
              ? [{ tag: "script", attrs: { "data-en-only": true }, children: REDIRECT_SRC, injectTo: "head" as const }]
              : []),
          ],
        };
      },
    },

    /* dev: /de/… is the matching English source, run through Vite's own HTML
       pipeline (chrome, analytics, this plugin's tags) and then translated;
       sitemap, robots and llms.txt are generated on request */
    configureServer(server) {
      server.watcher.add(r("de"));
      server.watcher.on("change", (file) => {
        if (file.includes("i18n")) server.ws.send({ type: "full-reload" });
      });
      const text = (res: import("node:http").ServerResponse, type: string, body: string): void => {
        res.setHeader("Content-Type", type);
        res.end(body);
      };
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (url === "/sitemap.xml")
          return text(res, "application/xml", sitemapXml([...sitePages()].filter((p) => p !== "404.html")));
        if (url === "/robots.txt") return text(res, "text/plain; charset=utf-8", robotsTxt());
        if (url === "/llms.txt") return text(res, "text/plain; charset=utf-8", llmsTxt());
        if (url !== "/de" && !url.startsWith("/de/")) return next();
        const page = pageForPath(url === "/de" ? "/" : url.slice(3));
        if (!page || !sitePages().has(page)) return next();
        void (async () => {
          try {
            const raw = readFileSync(r(`../${page}`), "utf8");
            const transformed = await server.transformIndexHtml(`/${page}`, raw);
            const warnings: string[] = [];
            const out = translateBuilt(transformed, page, sitePages(), warnings);
            for (const w of warnings) server.config.logger.warn(`[i18n] ${w}`);
            text(res, "text/html", out);
          } catch (e) {
            next(e);
          }
        })();
      });
    },

    /* build: finish every emitted page in English, write its /de/ twin, then the site files */
    closeBundle() {
      const pages = sitePages();
      const warnings: string[] = [];
      for (const page of [...pages].sort()) {
        const file = join(outDir, page);
        if (!existsSync(file)) continue;
        const en = finishPage(readFileSync(file, "utf8"), page, "en");
        writeFileSync(file, en);
        const target = join(outDir, "de", page);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, translateBuilt(en, page, pages, warnings));
      }
      writeSiteFiles(outDir, pages);
      for (const w of warnings) console.warn(`[i18n] ${w}`);
    },
  };
}
