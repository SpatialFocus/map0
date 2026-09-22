/**
 * What every page of map0.net gets on its way out of the build, for the sake of
 * crawlers — search engines and AI systems alike:
 *
 *   render.ts   gallery, pager, quick start and every code figure rendered into
 *               the HTML, so a fetch without JavaScript sees the whole page
 *   head.ts     description, canonical, Open Graph, Twitter card, JSON-LD
 *   sitemap.ts  sitemap.xml (both languages, hreflang alternates), robots.txt
 *   llms.ts     llms.txt and llms-full.txt
 *
 * `finishPage` is called by the i18n plugin for the English and the German
 * variant of every page (build: on the emitted files, dev: on the fly), so it
 * must be idempotent — every step replaces what an earlier pass rendered.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "node-html-parser";
import { applyHead } from "./head.js";
import { llmsFullTxt, llmsTxt } from "./llms.js";
import { renderStatic, type Lang } from "./render.js";
import { robotsTxt, sitemapXml } from "./sitemap.js";

export type { Lang } from "./render.js";
export { llmsTxt, robotsTxt, sitemapXml };

export function finishPage(html: string, page: string, lang: Lang): string {
  const root = parse(html, { comment: true });
  renderStatic(root, page, lang);
  applyHead(root, page, lang);
  const out = root.toString();
  return out.startsWith("<!") ? out : `<!doctype html>\n${out}`;
}

/** the pages a sitemap may list: everything emitted that is not marked noindex (the 404) */
export function indexablePages(outDir: string, pages: Iterable<string>): string[] {
  return [...pages].filter((page) => {
    const file = join(outDir, page);
    return existsSync(file) && !/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(readFileSync(file, "utf8"));
  });
}

/** sitemap.xml, robots.txt, llms.txt, llms-full.txt — after every page has been finished */
export function writeSiteFiles(outDir: string, pages: Set<string>): void {
  writeFileSync(join(outDir, "sitemap.xml"), sitemapXml(indexablePages(outDir, pages)));
  writeFileSync(join(outDir, "robots.txt"), robotsTxt());
  writeFileSync(join(outDir, "llms.txt"), llmsTxt());
  writeFileSync(join(outDir, "llms-full.txt"), llmsFullTxt(outDir));
}
