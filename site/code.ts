/**
 * Code blocks are rendered into the HTML at build time (site/seo/render.ts) —
 * the browser only wires up their Copy buttons. What gets copied is the
 * figure's own text: the highlight spans and emphasis marks fall away with
 * textContent, leaving exactly the snippet that was rendered.
 */
import { LANG } from "./lang.js";

const STR =
  LANG === "de" ? { copy: "Kopieren", copied: "Kopiert" } : { copy: "Copy", copied: "Copied" };

export function bindCopyButtons(root: ParentNode = document): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("figure.code [data-copy]")) {
    if (button.dataset.bound) continue;
    button.dataset.bound = "true";
    const pre = button.closest("figure")?.querySelector("pre");
    if (!pre) continue;
    button.addEventListener("click", () => {
      void navigator.clipboard.writeText(pre.textContent ?? "").then(() => {
        button.textContent = STR.copied;
        setTimeout(() => (button.textContent = STR.copy), 1600);
      });
    });
  }
}
