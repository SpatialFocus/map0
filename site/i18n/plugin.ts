/**
 * The i18n plugin: emits every page a second time under /de/ (dev middleware +
 * build step), injects the hreflang alternates, and puts the one-time
 * browser-language redirect on the English start page. The transformation
 * itself lives in translate.ts; the catalogues in i18n/de/.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { SITE_URL, catalogFor, prettyPath, sitePages, translatePage } from "./translate.js";
import { DEMOS } from "../demos/demos.js";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/* If no language was ever chosen, a German browser starts on /de/. localStorage
   (not a cookie: nothing here is sent to a server) remembers the choice the
   switcher makes — the same redirect-on-root behaviour as spatial-focus.net. */
const REDIRECT_SRC =
  `(function(){try{var l=localStorage.getItem("map0-lang");` +
  `if(l==="de"||(!l&&/^de/i.test(navigator.language||"")))location.replace("/de/"+location.hash)}catch(e){}})()`;

/* Elements marked data-demo-count show the size of the demo registry — filled
   here so prose can never lag behind a new demo again. The marker must wrap
   only the number itself. Runs on the final HTML of BOTH language variants
   (the German catalogue may carry the marker inside a translated heading). */
function fillDemoCount(html: string): string {
  return html.replace(
    /(<([a-z0-9]+)[^>]*\bdata-demo-count\b[^>]*>)\s*\d*\s*(<\/\2>)/g,
    `$1${DEMOS.length}$3`,
  );
}

function translateBuilt(html: string, page: string, pages: Set<string>, warnings: string[]): string {
  const { catalog, found } = catalogFor(page);
  if (!found) warnings.push(`${page}: no catalogue under site/i18n/de/ — emitted in English`);
  const { html: out, missing, stale } = translatePage(html, page, catalog, pages);
  if (missing.length > 0) warnings.push(`${page}: missing keys → ${missing.join(", ")}`);
  if (stale.length > 0) warnings.push(`${page}: stale keys (nothing asks for them) → ${stale.join(", ")}`);
  return fillDemoCount(out);
}

export function i18n(outDir: string): Plugin {
  return {
    name: "map0:i18n",

    /* hreflang on both variants (the /de/ copy inherits these), redirect on / */
    transformIndexHtml: {
      order: "post",
      handler: (html, ctx) => {
        const page = ctx.path.replace(/^\//, "");
        const counted = fillDemoCount(html);
        if (page === "404.html") return { html: counted, tags: [] }; // noindex — no alternates, no redirect
        const en = `${SITE_URL}${prettyPath(page)}`;
        const de = `${SITE_URL}/de${prettyPath(page)}`;
        return {
          html: counted,
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
       pipeline (chrome, analytics, this plugin's tags) and then translated */
    configureServer(server) {
      server.watcher.add(r("de"));
      server.watcher.on("change", (file) => {
        if (file.includes("i18n")) server.ws.send({ type: "full-reload" });
      });
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0]!;
        if (!url.startsWith("/de/")) return next();
        const enUrl = url.slice(3) === "/" ? "/index.html" : url.slice(3);
        const page = enUrl.endsWith("/") ? `${enUrl.slice(1)}index.html` : enUrl.slice(1);
        if (!page.endsWith(".html") || !sitePages().has(page)) return next();
        void (async () => {
          try {
            const raw = readFileSync(r(`../${page}`), "utf8");
            const transformed = await server.transformIndexHtml(`/${page}`, raw);
            const warnings: string[] = [];
            const out = translateBuilt(transformed, page, sitePages(), warnings);
            for (const w of warnings) server.config.logger.warn(`[i18n] ${w}`);
            res.setHeader("Content-Type", "text/html");
            res.end(out);
          } catch (e) {
            next(e);
          }
        })();
      });
    },

    /* build: read every emitted page back and write its /de/ twin */
    closeBundle() {
      const pages = sitePages();
      const warnings: string[] = [];
      const files = readdirSync(outDir, { recursive: true }) as string[];
      for (const file of files) {
        const page = relative(outDir, join(outDir, file)).replaceAll("\\", "/");
        if (!page.endsWith(".html") || page.startsWith("de/") || !pages.has(page)) continue;
        const html = readFileSync(join(outDir, page), "utf8");
        const target = join(outDir, "de", page);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, translateBuilt(html, page, pages, warnings));
      }
      for (const w of warnings) console.warn(`[i18n] ${w}`);
    },
  };
}
