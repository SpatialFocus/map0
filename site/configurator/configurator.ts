/**
 * The configurator page: mounts `<map0-configurator>`, hands it the config a
 * link carried (`?config=<same-site path>` or `?c=<json>`, like the
 * playground), and keeps its colour scheme in step with the topbar toggle —
 * the chrome script only reaches viewers in the light DOM, and the preview
 * lives inside the configurator's shadow root.
 */
import "@map0/configurator";
import type { Map0Config } from "@map0/schema";
import type { Map0Configurator } from "@map0/configurator";
import { LANG, LANG_PREFIX } from "../lang.js";
import pkg from "../../packages/map0/package.json";

const host = document.querySelector<HTMLElement>("[data-configurator]");
if (!host) throw new Error("configurator markup missing");

/** the published bundle, pinned — the same line the landing page's quick start shows */
const CDN_URL = `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/dist/map0.js`;

/** the config a link carried: ?config=<path> | ?c=<json> | nothing */
async function linkedConfig(): Promise<Map0Config | undefined> {
  const params = new URLSearchParams(location.search);
  const src = params.get("config");
  if (src && src.startsWith("/") && !src.startsWith("//")) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Map0Config;
    } catch {
      return undefined;
    }
  }
  const inline = params.get("c");
  if (inline) {
    try {
      return JSON.parse(inline) as Map0Config;
    } catch {
      /* mangled URL — the draft or the example it is */
    }
  }
  return undefined;
}

function currentTheme(): "light" | "dark" {
  const d = document.documentElement;
  if (d.classList.contains("dark")) return "dark";
  if (d.classList.contains("light")) return "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

void linkedConfig().then((config) => {
  const el = document.createElement("map0-configurator") as Map0Configurator;
  el.lang = LANG;
  el.scriptUrl = CDN_URL;
  el.playgroundHref = `${LANG_PREFIX}/playground/`;
  el.theme = currentTheme();
  if (config) {
    el.config = config;
    /* a linked config is a starting point, not the draft — and the URL should
       not re-load it over the user's edits on refresh */
    history.replaceState(null, "", location.pathname);
  }
  host.replaceWith(el);

  /* follow the topbar toggle and the OS setting */
  const chrome = (window as unknown as { __map0?: { theme?: () => void } }).__map0;
  if (chrome?.theme) {
    const original = chrome.theme;
    chrome.theme = () => {
      original();
      el.theme = currentTheme();
    };
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => (el.theme = currentTheme()));
});
