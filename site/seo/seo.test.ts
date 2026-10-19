import { describe, expect, it } from "vitest";
import { DEMOS } from "../demos/demos.js";
import { finishPage, llmsTxt, robotsTxt, sitemapXml } from "./index.js";

const demoPage = (id: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>WMS | map0 demos</title></head>
<body data-demo="${id}"><main><h1>WMS</h1>
<pre data-lang="html" data-label="page.html">
  &lt;script type="module" src="/map0.js"&gt;&lt;/script&gt;
  &lt;map0-viewer config-src="/x.json"&gt;&lt;/map0-viewer&gt;
</pre>
<pre data-src="/configs/wms.map0.json" data-label="wms.map0.json" data-emphasise="&quot;wms&quot;,info"></pre>
</main></body></html>`;

const ld = (html: string): { "@graph": Array<Record<string, unknown>> } =>
  JSON.parse(/<script type="application\/ld\+json" data-seo>(.*?)<\/script>/s.exec(html)![1]!);

describe("finishPage", () => {
  it("renders pager, code figures and the crawler head of a demo page", () => {
    const out = finishPage(demoPage("wms"), "demos/wms.html", "en");
    expect(out).toContain('<link rel="canonical" href="https://map0.net/demos/wms"');
    expect(out).toContain('<meta name="description" content="Raster map services');
    expect(out).toContain('property="og:url" content="https://map0.net/demos/wms"');
    expect(out).toMatch(/<nav class="pager"[^>]*>.*href="\/demos\/wmts".*<\/nav>/s); // wms is first: only a next
    expect(out).not.toContain("<pre data-src");
    expect(out).not.toContain("<pre data-lang");
    expect(out).toContain('<figure class="code" data-lang="html"');
    // the inline snippet: decoded from the source, re-escaped and highlighted
    expect(out).toContain('<span class="tok-punct">&lt;</span><span class="tok-tag">map0-viewer</span>');
    expect(out).not.toContain("&amp;lt;");
    expect(out).toContain('<span class="tok-str">"wms"</span>'); // the config file, highlighted
    expect(out).toContain('<mark class="line">'); // …and the emphasised lines marked
    expect(out).toContain(">Copy</button>");
    const graph = ld(out)["@graph"];
    expect(graph.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
    expect(graph.some((n) => n["@type"] === "Organization")).toBe(true);
  });

  it("is idempotent and switches language on the second pass", () => {
    const en = finishPage(demoPage("wms"), "demos/wms.html", "en");
    const de = finishPage(en, "demos/wms.html", "de");
    expect(de).toContain('<link rel="canonical" href="https://map0.net/de/demos/wms"');
    expect(de.match(/rel="canonical"/g)).toHaveLength(1);
    expect(de.match(/<nav class="pager"/g)).toHaveLength(1);
    expect(de.match(/<figure class="code"/g)).toHaveLength(2);
    expect(de).toContain('href="/de/demos/wmts"');
    expect(de).toContain(">Kopieren</button>");
    expect(de).not.toContain(">Copy</button>");
    expect(de).toContain("Raster-Kartendienste"); // the German description from the registry
    expect(de.match(/<script type="application\/ld\+json"/g)).toHaveLength(1);
  });

  it("renders the gallery with every demo and short URLs", () => {
    const out = finishPage(
      '<!doctype html><html><head><title>Demos</title></head><body><main><div data-gallery></div></main></body></html>',
      "demos/index.html",
      "en",
    );
    expect(out.match(/class="card"/g)).toHaveLength(DEMOS.length);
    expect(out).toContain('href="/demos/wms"');
    expect(out).not.toContain('.html"');
  });

  it("gives a noindex page neither canonical nor Open Graph", () => {
    const out = finishPage(
      '<!doctype html><html><head><title>404</title><meta name="robots" content="noindex" /></head><body></body></html>',
      "404.html",
      "en",
    );
    expect(out).not.toContain("canonical");
    expect(out).not.toContain("og:");
  });

  it("fails the build on a config block that points at nothing", () => {
    expect(() =>
      finishPage('<html><head></head><body><main><pre data-src="/configs/nope.json"></pre></main></body></html>', "demos/x.html", "en"),
    ).toThrow(/no such file/);
  });
});

describe("site files", () => {
  it("sitemap lists both languages with alternates; robots points at it", () => {
    const xml = sitemapXml(["demos/wms.html", "index.html"]);
    expect(xml.indexOf("<loc>https://map0.net/</loc>")).toBeLessThan(xml.indexOf("<loc>https://map0.net/demos/wms</loc>"));
    expect(xml).toContain("<loc>https://map0.net/de/demos/wms</loc>");
    expect(xml).toContain('hreflang="x-default" href="https://map0.net/demos/wms"');
    expect(xml).not.toContain(".html");
    expect(robotsTxt()).toContain("Sitemap: https://map0.net/sitemap.xml");
    expect(robotsTxt()).toContain("Content-Signal:");
  });

  it("llms.txt links every demo and the schema", () => {
    const txt = llmsTxt();
    for (const d of DEMOS) expect(txt).toContain(`https://map0.net/demos/${d.id}`);
    expect(txt).toContain("/schema/v1.json");
    expect(txt).not.toContain(".html)");
  });
});
