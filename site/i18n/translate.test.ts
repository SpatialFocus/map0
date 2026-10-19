import { describe, expect, it } from "vitest";
import { pageForPath, prettyPath, translatePage } from "./translate.js";

describe("prettyPath", () => {
  it("drops .html and index.html — the URLs the host serves", () => {
    expect(prettyPath("index.html")).toBe("/");
    expect(prettyPath("demos/index.html")).toBe("/demos/");
    expect(prettyPath("demos/wms.html")).toBe("/demos/wms");
    expect(prettyPath("imprint.html")).toBe("/imprint");
  });
});

describe("pageForPath", () => {
  it("is the inverse of prettyPath and still accepts the long form", () => {
    for (const page of ["index.html", "demos/index.html", "demos/wms.html", "imprint.html"])
      expect(pageForPath(prettyPath(page))).toBe(page);
    expect(pageForPath("/demos/wms.html")).toBe("demos/wms.html");
    expect(pageForPath("relative")).toBeUndefined();
  });
});

describe("translatePage", () => {
  const pages = new Set(["index.html", "demos/index.html", "demos/wms.html", "playground/index.html"]);
  const html = `<!doctype html><html lang="en"><head><title data-i18n="title">T</title></head><body>
    <a href="/">home</a><a href="/#start">start</a><a href="/demos/">demos</a><a href="/demos/wms">wms</a>
    <a href="/demos/wms.html">legacy</a><a href="/playground/?c=%7B%7D">pg</a><a href="/configs/x.json">cfg</a>
    <a href="https://example.com/a.html">ext</a><a href="/de/demos/">already</a><a data-lang="en" href="/">EN</a>
    <p data-i18n="p">English</p></body></html>`;

  it("localizes page links, keeps assets, external URLs and query strings, reports keys", () => {
    const { html: out, missing, stale } = translatePage(
      html,
      "index.html",
      { title: "Titel", p: "Deutsch", unused: "x" },
      pages,
    );
    expect(out).toContain('lang="de"');
    expect(out).toContain('href="/de/"');
    expect(out).toContain('href="/de/#start"');
    expect(out).toContain('href="/de/demos/"');
    expect(out).toContain('href="/de/demos/wms"');
    expect(out).toContain('href="/de/demos/wms.html"');
    expect(out).toContain('href="/de/playground/?c=%7B%7D"');
    expect(out).toContain('href="/configs/x.json"');
    expect(out).toContain('href="https://example.com/a.html"');
    expect(out).not.toContain("/de/de/");
    expect(out).toMatch(/data-lang="en"[^>]*href="\/"/); // the switcher crosses languages
    expect(out).toContain('<p data-i18n="p">Deutsch</p>');
    expect(missing).toEqual([]);
    expect(stale).toEqual(["unused"]);
  });
});
