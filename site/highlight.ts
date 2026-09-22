/**
 * Syntax highlighting for the site's code blocks: pure string functions with no
 * DOM, so the build (site/seo/render.ts, where every figure is rendered) and
 * the browser (site/code.ts, which only wires up the Copy buttons) share one
 * implementation and a snippet reads the same however it got onto the page.
 */

export const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** attribute value: what escapeHtml does, plus the quotes */
export const escapeAttr = (s: string): string => escapeHtml(s).replaceAll('"', "&quot;");

export function highlightJson(src: string): string {
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

export function highlightMarkup(src: string): string {
  return escapeHtml(src).replace(
    /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?)([a-zA-Z][\w-]*)((?:[^&]|&(?!gt;))*?)(\/?&gt;)/g,
    (match, comment: string, lt: string, tag: string, attrs: string, gt: string) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (!tag) return match;
      const highlightedAttrs = attrs.replace(
        /([\w-]+)(=)(&quot;[^&]*?&quot;|"[^"]*"|'[^']*')/g,
        (_, name: string, eq: string, value: string) =>
          `<span class="tok-attr">${name}</span>${eq}<span class="tok-str">${value}</span>`,
      );
      return `<span class="tok-punct">${lt}</span><span class="tok-tag">${tag}</span>${highlightedAttrs}<span class="tok-punct">${gt}</span>`;
    },
  );
}

const JS_KEYWORDS = /^(const|let|await|async|function|return|import|export|from|new|if|else|for|of)$/;

export function highlightJs(src: string): string {
  return escapeHtml(src).replace(
    /(\/\/[^\n]*)|('[^']*'|"[^"]*"|`[^`]*`)|\b([A-Za-z_$][\w$]*)\b/g,
    (match, comment: string, str: string, word: string) => {
      if (comment) return `<span class="tok-comment">${comment}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (word && JS_KEYWORDS.test(word)) return `<span class="tok-bool">${word}</span>`;
      return match;
    },
  );
}

/** highlighted, escaped HTML for a snippet; unknown languages come back escaped but unstyled */
export function highlight(code: string, lang: string): string {
  switch (lang) {
    case "json":
      return highlightJson(code);
    case "js":
      return highlightJs(code);
    case "html":
      return highlightMarkup(code);
    default:
      return escapeHtml(code); // css, text, bash, sql, …
  }
}

/** wrap lines containing any of the given needles in a highlight marker */
export function emphasise(html: string, needles: string[]): string {
  if (needles.length === 0) return html;
  return html
    .split("\n")
    .map((line) => {
      const plain = line.replace(/<[^>]+>/g, "");
      return needles.some((n) => plain.includes(n)) ? `<mark class="line">${line}</mark>` : line;
    })
    .join("\n");
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

export interface FigureOptions {
  /** lines containing any of these are marked (see emphasise) */
  needles?: string[];
  /** label of the Copy button, in the page's language */
  copyLabel?: string;
  /** extra classes on the <figure>, e.g. "full" */
  className?: string;
  /** extra attributes on the <figure>, verbatim, e.g. `data-quickstart` */
  attrs?: string;
}

/**
 * The markup of a code figure: a caption with the file name and a Copy button,
 * then the highlighted code. `data-copy` is what the browser binds the click
 * to; `data-lang` is kept for the plain-text rendering (site/seo/llms.ts).
 */
export function figureHtml(label: string, code: string, lang: string, options: FigureOptions = {}): string {
  const { needles = [], copyLabel = "Copy", className = "", attrs = "" } = options;
  const classes = className ? `code ${className}` : "code";
  return (
    `<figure class="${classes}" data-lang="${escapeAttr(lang)}"${attrs ? ` ${attrs}` : ""}>` +
    `<figcaption>${escapeHtml(label)}<button class="copy" type="button" data-copy>${escapeHtml(copyLabel)}</button></figcaption>` +
    `<pre>${emphasise(highlight(code, lang), needles)}</pre>` +
    `</figure>`
  );
}
