/**
 * sitemap.xml and robots.txt, written into the build. The sitemap lists every
 * indexable page in both languages, each entry carrying the hreflang
 * alternates the pages themselves carry; robots.txt allows everything, states
 * the content signals (see contentsignals.org) and points at the sitemap.
 * No lastmod: the deploy is a shallow checkout, and a wrong date is worse than
 * none.
 */
import { SITE_URL, prettyPath } from "../i18n/translate.js";

const escapeXml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** canonical URL of a page in a language: "demos/wms.html" → https://map0.net/de/demos/wms */
export const pageUrl = (page: string, lang: "en" | "de"): string =>
  `${SITE_URL}${lang === "de" ? "/de" : ""}${prettyPath(page)}`;

/** the start page first, then the rest alphabetically: a stable, readable file */
function ordered(pages: Iterable<string>): string[] {
  return [...pages].sort((a, b) =>
    a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b, "en"),
  );
}

export function sitemapXml(pages: Iterable<string>): string {
  const entries = ordered(pages).flatMap((page) => {
    const en = pageUrl(page, "en");
    const de = pageUrl(page, "de");
    const alternates =
      `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(en)}"/>\n` +
      `    <xhtml:link rel="alternate" hreflang="de" href="${escapeXml(de)}"/>\n` +
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(en)}"/>\n`;
    return [en, de].map((loc) => `  <url>\n    <loc>${escapeXml(loc)}</loc>\n${alternates}  </url>\n`);
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    entries.join("") +
    `</urlset>\n`
  );
}

export function robotsTxt(): string {
  return [
    `# map0.net — everything here is public and meant to be found, by search engines`,
    `# and AI systems alike. Cloudflare prepends its Content Signals Policy text; the`,
    `# signals below say the same thing in the file itself.`,
    ``,
    `User-agent: *`,
    `Content-Signal: search=yes, ai-input=yes, ai-train=yes`,
    `Allow: /`,
    `# a playground permalink carries a whole config in its query string: one page,`,
    `# endless URL variants — the canonical /playground/ is what gets indexed`,
    `Disallow: /playground/?`,
    `Disallow: /de/playground/?`,
    ``,
    `Sitemap: ${SITE_URL}/sitemap.xml`,
    ``,
  ].join("\n");
}
