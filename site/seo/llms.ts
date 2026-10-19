/**
 * llms.txt and llms-full.txt (llmstxt.org): a Markdown map of the site for
 * language models, and the full text behind it — every demo with its
 * explanation and the exact config it runs on, the integration README and the
 * FAQ. Both are generated from the registry and from the finished English
 * pages, so they say what the site says.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeType, parse, type HTMLElement, type Node, type TextNode } from "node-html-parser";
import { DEMOS, GROUPS, type Demo } from "../demos/demos.js";
import { SITE_URL } from "../i18n/translate.js";
import { GITHUB_URL, NPM_URL, SITE_DESCRIPTION } from "./head.js";
import { CDN_URL, PKG, demoBlurb, demoHref, demoTitle } from "./render.js";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const RAW = "https://raw.githubusercontent.com/SpatialFocus/map0/main";

const SUMMARY =
  `${SITE_DESCRIPTION.en} Open source under the MIT license, developed by Spatial Focus GmbH, Vienna.`;

const EMBED =
  "```html\n" +
  `<script type="module" src="${CDN_URL}"></script>\n` +
  `<map0-viewer config-src="/my-map.map0.json" style="height:520px"></map0-viewer>\n` +
  "```";

const VERSION_NOTE =
  `map0 is delivered as the web component \`<map0-viewer>\` in the npm package \`${PKG.name}\` ` +
  `(current version ${PKG.version}). The JavaScript API and the config format are drafts until 1.0: ` +
  `pin an exact version. A complete page:`;

const demoLine = (d: Demo): string => `- [${demoTitle(d, "en")}](${SITE_URL}${demoHref(d, "en")}): ${demoBlurb(d, "en")}`;

const LINKS = [
  `- [GitHub repository](${GITHUB_URL}): source code, issues, MIT license`,
  `- [npm package ${PKG.name}](${NPM_URL})`,
  `- [Integration README](${RAW}/packages/map0/README.md): install, embed, configure, JavaScript API`,
  `- [Config reference](${RAW}/docs/config-reference.md): every config key, generated from the schema`,
  `- [Config schema](${SITE_URL}/schema/v1.json): the JSON Schema every config is validated against`,
  `- [Configuration concepts](${RAW}/docs/04-configuration.md)`,
  `- [Architecture](${RAW}/docs/06-architecture.md)`,
  `- [Roadmap](${RAW}/docs/07-roadmap.md)`,
  `- [Changelog](${RAW}/CHANGELOG.md)`,
];

/* --------------------------------- llms.txt ------------------------------- */

export function llmsTxt(): string {
  const demos = GROUPS.map(
    (group) => `### ${group}\n\n${DEMOS.filter((d) => d.group === group).map(demoLine).join("\n")}`,
  );
  return [
    `# map0`,
    ``,
    `> ${SUMMARY}`,
    ``,
    VERSION_NOTE,
    ``,
    EMBED,
    ``,
    `## Start here`,
    ``,
    `- [Start page](${SITE_URL}/): what map0 is, quick start, features, FAQ`,
    `- [Quick start](${SITE_URL}/#start): a complete page with a basemap and a WMS layer`,
    `- [Playground](${SITE_URL}/playground/): edit a config in the browser and watch the map follow`,
    `- [Full text of this site](${SITE_URL}/llms-full.txt): the FAQ, the README and every demo with its explanation and config, in one file`,
    ``,
    `## Demos`,
    ``,
    `One topic per page, a live map against public services, and the exact JSON config it runs on.`,
    ``,
    demos.join("\n\n"),
    ``,
    `## Source, package and documentation`,
    ``,
    LINKS.join("\n"),
    ``,
    `## Optional`,
    ``,
    `- [German start page](${SITE_URL}/de/): the whole site is available in German under /de/`,
    `- [Imprint](${SITE_URL}/imprint), [Privacy](${SITE_URL}/privacy)`,
    ``,
  ].join("\n");
}

/* ------------------------------ HTML → Markdown --------------------------- */

interface Ctx {
  /** how many levels the page's headings move down under the file's own */
  shift: number;
  /** drop the page's h1 (printed by the caller) */
  skipH1: boolean;
}

/* elements that carry nothing a reader needs: controls, the map itself, chrome */
const SKIP_TAGS = new Set(["script", "style", "svg", "button", "nav", "map0-viewer", "textarea", "select", "input", "template", "noscript"]);
const SKIP_CLASSES = ["pager", "try-playground", "try-playground-row", "pg-shell", "topbar", "site"];

const isElement = (n: Node): n is HTMLElement => n.nodeType === NodeType.ELEMENT_NODE;
const tagOf = (el: HTMLElement): string => (el.rawTagName ?? "").toLowerCase();

const absolute = (href: string): string => (href.startsWith("/") ? `${SITE_URL}${href}` : href);

/** inline content of an element, whitespace collapsed */
function inline(el: HTMLElement | null, ctx: Ctx): string {
  if (!el) return "";
  return el.childNodes.map((c) => md(c, ctx)).join("").replace(/\s+/g, " ").trim();
}

function fence(code: string, lang: string): string {
  const ticks = code.includes("```") ? "````" : "```";
  return `\n\n${ticks}${lang}\n${code.trimEnd()}\n${ticks}\n\n`;
}

/** a rendered code figure: its caption (without the Copy button) and its code */
function codeFigure(el: HTMLElement): string {
  const caption = el.querySelector("figcaption");
  const label = (caption?.childNodes ?? [])
    .filter((n) => n.nodeType === NodeType.TEXT_NODE)
    .map((n) => (n as TextNode).text)
    .join("")
    .trim();
  const code = el.querySelector("pre")?.textContent ?? "";
  return `\n\n**${label}**${fence(code, el.getAttribute("data-lang") ?? "")}`;
}

function table(el: HTMLElement, ctx: Ctx): string {
  const rows = el.querySelectorAll("tr").map((tr) =>
    tr.childNodes.filter(isElement).filter((c) => tagOf(c) === "th" || tagOf(c) === "td").map((c) => inline(c, ctx)),
  );
  if (rows.length === 0) return "";
  const [head, ...body] = rows as [string[], ...string[][]];
  const line = (cells: string[]): string => `| ${cells.join(" | ")} |`;
  return `\n\n${line(head)}\n${line(head.map(() => "---"))}\n${body.map(line).join("\n")}\n\n`;
}

function md(node: Node, ctx: Ctx): string {
  if (node.nodeType === NodeType.TEXT_NODE) return (node as TextNode).text.replace(/\s+/g, " ");
  if (!isElement(node)) return "";
  const el = node;
  const tag = tagOf(el);
  if (SKIP_TAGS.has(tag) || SKIP_CLASSES.some((c) => el.classList.contains(c))) return "";
  const children = (): string => el.childNodes.map((c) => md(c, ctx)).join("");
  const heading = (level: number): string => `\n\n${"#".repeat(Math.min(level + ctx.shift, 6))} ${inline(el, ctx)}\n\n`;

  switch (tag) {
    case "h1":
      return ctx.skipH1 ? "" : heading(1);
    case "h2":
      return heading(2);
    case "h3":
      return heading(3);
    case "h4":
      return heading(4);
    case "p":
    case "figcaption":
      return `\n\n${inline(el, ctx)}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "ul":
    case "ol": {
      const items = el.childNodes.filter(isElement).filter((c) => tagOf(c) === "li");
      return `\n\n${items.map((li, i) => `${tag === "ol" ? `${i + 1}.` : "-"} ${inline(li, ctx)}`).join("\n")}\n\n`;
    }
    case "dl": {
      const out: string[] = [];
      for (const child of el.childNodes.filter(isElement)) {
        const parts = tagOf(child) === "div" ? child.childNodes.filter(isElement) : [child];
        for (const part of parts) {
          if (tagOf(part) === "dt") out.push(`- **${inline(part, ctx)}**`);
          else if (tagOf(part) === "dd" && out.length > 0) out[out.length - 1] += `: ${inline(part, ctx)}`;
        }
      }
      return `\n\n${out.join("\n")}\n\n`;
    }
    case "figure":
      return el.classList.contains("code") ? codeFigure(el) : children();
    case "pre":
      return fence(el.textContent, el.getAttribute("data-lang") ?? "");
    case "details": {
      const summary = el.querySelector("summary");
      const rest = el.childNodes
        .filter((n) => n !== summary)
        .map((n) => md(n, ctx))
        .join("");
      return `\n\n**${inline(summary, ctx)}**\n\n${rest.trim()}\n\n`;
    }
    case "summary":
      return "";
    case "table":
      return table(el, ctx);
    case "a": {
      const href = el.getAttribute("href") ?? "";
      const label = inline(el, ctx);
      return !href || href.startsWith("#") ? label : `[${label}](${absolute(href)})`;
    }
    case "code":
      return `\`${el.textContent.replace(/\s+/g, " ").trim()}\``;
    case "strong":
    case "b":
      return `**${inline(el, ctx)}**`;
    case "em":
    case "i":
      return `*${inline(el, ctx)}*`;
    case "img": {
      const alt = el.getAttribute("alt");
      return alt ? `![${alt}](${absolute(el.getAttribute("src") ?? "")})` : "";
    }
    default:
      return children();
  }
}

/** Markdown for one element's content; blank lines collapsed, edges trimmed */
export function toMarkdown(el: HTMLElement, ctx: Ctx): string {
  return el.childNodes
    .map((c) => md(c, ctx))
    .join("")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** move every heading of a Markdown document down by `by` levels (code fences untouched) */
export function shiftHeadings(markdown: string, by: number): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced || !/^#{1,6} /.test(line)) return line;
      const hashes = Math.min(line.indexOf(" ") + by, 6);
      return `${"#".repeat(hashes)}${line.slice(line.indexOf(" "))}`;
    })
    .join("\n");
}

/* ------------------------------ llms-full.txt ----------------------------- */

/** the full text, built from the finished English pages in `outDir` */
export function llmsFullTxt(outDir: string): string {
  const page = (file: string): HTMLElement => parse(readFileSync(join(outDir, file), "utf8"), { comment: true });

  const faqSection = page("index.html").querySelector("#faq .faq");
  const faq = faqSection ? toMarkdown(faqSection, { shift: 2, skipH1: false }) : "(none)";

  const readme = shiftHeadings(readFileSync(r("../../packages/map0/README.md"), "utf8"), 2);

  const demos = DEMOS.map((d) => {
    const main = page(`demos/${d.id}.html`).querySelector("main");
    const body = main ? toMarkdown(main, { shift: 2, skipH1: true }) : "";
    return `### ${demoTitle(d, "en")}\n\nURL: ${SITE_URL}${demoHref(d, "en")}\n\n${demoBlurb(d, "en")}\n\n${body}`;
  });

  return [
    `# map0 — the site in one file`,
    ``,
    `> ${SUMMARY}`,
    ``,
    VERSION_NOTE,
    ``,
    EMBED,
    ``,
    `This file is generated with every deploy of ${SITE_URL} and contains, in order: the FAQ, the`,
    `README of the npm package (embedding, configuration, JavaScript API), and every demo page`,
    `with its explanation and the exact JSON config the map on it runs on.`,
    ``,
    `## Frequently asked questions`,
    ``,
    faq,
    ``,
    `## Embedding and API — the README of ${PKG.name}`,
    ``,
    readme.trim(),
    ``,
    `## Demos`,
    ``,
    `One topic per page. Each map below is a live embed on the site; the config printed with it is the file that map loads.`,
    ``,
    demos.join("\n\n"),
    ``,
    `## Links`,
    ``,
    LINKS.join("\n"),
    ``,
  ].join("\n");
}
