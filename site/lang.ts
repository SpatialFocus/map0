/**
 * Page language, as stamped by the i18n build: the generated /de/… pages carry
 * <html lang="de"> (site/i18n/translate.ts), everything else is English. The
 * few strings scripts render at runtime (gallery, pager, buttons) key off this.
 */
export const LANG: "en" | "de" = document.documentElement.lang === "de" ? "de" : "en";

/** prefix for root-relative page links, so scripts keep the reader's language */
export const LANG_PREFIX = LANG === "de" ? "/de" : "";
