/**
 * Landing page. The map is the product, so it loads eagerly and everything else
 * is built around it: the quick-start snippet is generated FROM the element
 * running next to it, and the demo grid comes from the demo registry — neither
 * can go stale by being edited in the wrong place.
 */
import "@map0/ui";
import { codeFigure, dedent, enhanceCode } from "./code.js";
import pkg from "../packages/map0/package.json";

/* ------------------------------- quick start ------------------------------ */

/** The published bundle, pinned — read from the package so it cannot drift. */
const CDN_URL = `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/dist/map0.js`;

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

  /* One snippet, one Copy button, a page that runs: the CDN line belongs in it.
     Self-hosting only swaps this src for your own folder — that is a developer
     concern and lives in the README, not on the landing page. */
  const snippet = [
    `<script type="module"`,
    `        src="${CDN_URL}">`,
    `</script>`,
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

/* ------------------------------- countdown ------------------------------- */

/* The three zeros are the pitch, so they arrive as a countdown — every other
   landing page counts up. A number spins down to the zero that was in the
   markup all along: the digits live in an injected, aria-hidden overlay, so the
   HTML itself only ever says "0" and a crawler, a reader without JavaScript and
   a screen reader all get the promise instead of the animation. */
const COUNT_MS = 1100;

function countdown(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  /* A second digit grows into the space left of the zero: 19 rather than a
     wider start, because the narrow leading 1 keeps the overlay inside the
     column gap. That gap only exists from tablet up — narrower screens count
     from a single digit. */
  const from = matchMedia("(min-width: 700px)").matches ? 19 : 9;

  document.querySelectorAll<HTMLElement>(".zeros b").forEach((zero, i) => {
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.setAttribute("aria-hidden", "true");
    tick.textContent = String(from);
    zero.classList.add("counting");
    zero.append(tick);

    const delay = i * 130; // one stagger step per zero: the three read as a sequence
    const start = performance.now() + delay;
    const finish = (): void => {
      tick.remove();
      zero.classList.remove("counting");
    };
    const step = (now: number): void => {
      const t = Math.min(Math.max((now - start) / COUNT_MS, 0), 1);
      if (t === 1) return finish();
      tick.textContent = String(Math.round(from * (1 - t) ** 3)); // fast, then settling
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    /* A hidden tab gets no frames at all, so the overlay would sit there on its
       first number. The timer is the guarantee that the markup ends up back at
       the plain 0 whatever the browser did with the animation. */
    setTimeout(finish, delay + COUNT_MS + 200);
  });
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

/* -------------------------------- scroll spy ------------------------------ */

/* The topbar marks "Demos" as current on demo pages (set at build time). On the
   landing page, the section links get the same treatment while their section is
   on screen, so the highlight logic feels consistent across the site. */
function scrollSpy(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.topbar nav a[href^="/#"]')]
    .map((a) => ({ a, section: document.getElementById(new URL(a.href).hash.slice(1)) }))
    .filter((x): x is { a: HTMLAnchorElement; section: HTMLElement } => x.section !== null);
  if (links.length === 0) return;

  const update = (): void => {
    /* current = the section spanning the line just below the sticky topbar */
    for (const { a, section } of links) {
      const r = section.getBoundingClientRect();
      if (r.top <= 96 && r.bottom > 96) a.setAttribute("aria-current", "location");
      else a.removeAttribute("aria-current");
    }
  };
  addEventListener("scroll", update, { passive: true });
  update();
}

/* ---------------------------------- boot ---------------------------------- */

quickStart();
countdown();
reveal();
scrollSpy();
void enhanceCode();
