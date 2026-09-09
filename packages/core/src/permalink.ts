/**
 * Shareable map state in the URL (F10.1): view, basemap, layer visibility/
 * opacity and runtime-added layers, base64url-encoded in a single hash param
 * (default `#map0=…`). Opt-in via the `permalink` config key — the host page
 * may use its own hash routing.
 */
import type { LayerDef } from "@map0/schema";

export interface ShareState {
  /** [lng, lat, zoom, bearing?, pitch?] */
  v: number[];
  /** active basemap id */
  b?: string;
  /** layer runtime state: id → [visible 0|1, opacity 0..100] */
  l?: Record<string, [number, number]>;
  /** runtime-added layer definitions */
  u?: LayerDef[];
}

/**
 * The runtime-added layers a share link can carry (F3.5). A layer with inline
 * data — a dropped file — is left out: a link is a reference, and a local file
 * has no address the recipient could follow; even a small one would push the
 * URL past what browsers and chat clients tolerate. Layers added by URL travel.
 */
export function shareableLayerDefs<T extends { type: string }>(defs: readonly T[]): T[] {
  return defs.filter(
    (d) => !(d.type === "geojson" && typeof (d as { data?: unknown }).data !== "string"),
  );
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlDecode(s: string): string {
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShareState(state: ShareState): string {
  return base64UrlEncode(JSON.stringify(state));
}

export function decodeShareState(encoded: string): ShareState | null {
  try {
    const parsed = JSON.parse(base64UrlDecode(encoded)) as ShareState;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.v) || parsed.v.length < 3 || parsed.v.length > 5 ||
      !parsed.v.every(v => typeof v === "number" && Number.isFinite(v)) ||
      Math.abs(parsed.v[1]!) > 90 || parsed.v[2]! < 0 || parsed.v[2]! > 24 ||
      (parsed.v[4] !== undefined && (parsed.v[4] < 0 || parsed.v[4] > 85))) return null;
    if (parsed.b !== undefined && typeof parsed.b !== "string") return null;
    if (parsed.l !== undefined) {
      if (!parsed.l || typeof parsed.l !== "object" || Array.isArray(parsed.l)) return null;
      for (const value of Object.values(parsed.l)) {
        if (!Array.isArray(value) || value.length !== 2 || (value[0] !== 0 && value[0] !== 1) ||
          typeof value[1] !== "number" || !Number.isFinite(value[1]) || value[1] < 0 || value[1] > 100) return null;
      }
    }
    if (parsed.u !== undefined && !Array.isArray(parsed.u)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** hash parameters currently driven by a live viewer on this page */
const claimedParams = new Set<string>();

/**
 * Claim the hash parameter for one viewer. Two viewers writing the same
 * parameter would overwrite each other's state, and `map0` is the default for
 * every instance — so a second claim of a name becomes `map0-2`, `map0-3`, …
 * Share links stay stable as long as the page creates its viewers in a stable
 * order; give each viewer an explicit `permalink.param` when it does not.
 */
export function claimShareParam(param: string): { param: string; release: () => void } {
  let name = param;
  for (let n = 2; claimedParams.has(name); n++) name = `${param}-${n}`;
  if (name !== param) {
    console.warn(
      `[map0] permalink parameter "${param}" is already in use by another viewer on this page — ` +
        `this one uses "${name}". Give each viewer its own "permalink.param" for stable share links.`,
    );
  }
  claimedParams.add(name);
  return {
    param: name,
    release: () => {
      claimedParams.delete(name);
    },
  };
}

/** read the share param from a URL hash like `#map0=…&other=…` */
export function readShareParam(hash: string, param: string): string | null {
  const match = new RegExp(`(?:^#|[#&])${param}=([^&]+)`).exec(hash);
  return match?.[1] ?? null;
}

/** replace/insert the share param in a hash, preserving other hash content */
export function writeShareParam(hash: string, param: string, value: string): string {
  const cleaned = hash
    .replace(/^#/, "")
    .split("&")
    .filter((part) => part !== "" && !part.startsWith(`${param}=`));
  cleaned.push(`${param}=${value}`);
  return `#${cleaned.join("&")}`;
}
