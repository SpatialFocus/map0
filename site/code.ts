/**
 * Code blocks for the demo pages and the landing page: a tiny highlighter, a
 * copy button, and the rule that a snippet is FETCHED from the very file the
 * map loads wherever possible — so a snippet can never drift from what runs.
 */
import { LANG } from "./lang.js";

const STR =
  LANG === "de" ? { copy: "Kopieren", copied: "Kopiert" } : { copy: "Copy", copied: "Copied" };

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

/** build the dark <figure class="code"> for a snippet (highlighted, with a copy button) */
export function codeFigure(
  label: string,
  code: string,
  lang: string,
  needles: string[] = [],
): HTMLElement {
  const highlighter =
    lang === "json"
      ? highlightJson
      : lang === "js"
        ? highlightJs
        : lang === "html"
          ? highlightMarkup
          : escapeHtml; // css, text, anything else: escaped but unstyled

  const figure = document.createElement("figure");
  figure.className = "code";
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  const copy = document.createElement("button");
  copy.className = "copy";
  copy.type = "button";
  copy.textContent = STR.copy;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(code).then(() => {
      copy.textContent = STR.copied;
      setTimeout(() => (copy.textContent = STR.copy), 1600);
    });
  });
  caption.appendChild(copy);
  const target = document.createElement("pre");
  target.innerHTML = emphasise(highlighter(code), needles);
  figure.append(caption, target);
  return figure;
}

function renderCode(pre: HTMLPreElement, label: string, code: string, lang: string): void {
  const needles = (pre.dataset.emphasise ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  pre.replaceWith(codeFigure(label, code, lang, needles));
}

/** strip the shared leading indentation of an inline snippet */
export function dedent(raw: string): string {
  const body = raw.replace(/^\n/, "").trimEnd();
  const indent = Math.min(
    ...body
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => l.match(/^ */)![0].length),
  );
  return body
    .split("\n")
    .map((l) => l.slice(indent))
    .join("\n");
}

/** turn every <pre data-src> / <pre data-lang> on the page into a code figure */
export async function enhanceCode(): Promise<void> {
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
          pre.textContent = LANG === "de" ? `${src} konnte nicht geladen werden` : `could not load ${src}`;
        }
        return;
      }
      renderCode(
        pre,
        pre.dataset.label ?? "snippet",
        dedent(pre.textContent ?? ""),
        pre.dataset.lang ?? "html",
      );
    }),
  );
}
