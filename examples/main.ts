/**
 * Landing page. The map is the product, so it loads eagerly and everything else
 * is built around it: the quick-start snippet is generated FROM the element
 * running next to it, and the demo grid comes from the demo registry — neither
 * can go stale by being edited in the wrong place.
 */
import "@map0/ui";
import { codeFigure, dedent, enhanceCode } from "./code.js";

/* ------------------------------- quick start ------------------------------ */

function quickStart(): void {
  const host = document.querySelector<HTMLElement>("[data-quickstart]");
  const inline = document.querySelector<HTMLScriptElement>(
    '#quickstart > script[type="application/json"]',
  );
  if (!host || !inline) return;

  const config = dedent(inline.textContent ?? "")
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

  const snippet = [
    `<script type="module" src="/map0/map0.js"></script>`,
    ``,
    `<map0-viewer style="height:520px">`,
    `  <script type="application/json">`,
    config,
    `  </script>`,
    `</map0-viewer>`,
  ].join("\n");

  const figure = codeFigure("index.html", snippet, "html");
  figure.classList.add("full"); // a quick start nobody can read is not one
  host.replaceWith(figure);
}

/* ------------------------------ scroll reveal ----------------------------- */

function reveal(): void {
  document.body.classList.add("js"); // unhides .reveal — see landing.css
  const targets = [...document.querySelectorAll(".reveal")];
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    targets.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  /* stagger cards within a row so a grid does not pop in as one block */
  targets.forEach((el, i) => {
    (el as HTMLElement).style.transitionDelay = `${Math.min(i % 4, 3) * 60}ms`;
    io.observe(el);
  });
}

/* ---------------------------------- boot ---------------------------------- */

quickStart();
reveal();
void enhanceCode();
