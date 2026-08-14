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
    return Array.isArray(parsed.v) && parsed.v.length >= 3 ? parsed : null;
  } catch {
    return null;
  }
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
