/**
 * Geocoding (F8.1, F8.2) with pluggable providers.
 *
 * Two services ship built in — Photon for type-ahead search and Nominatim for
 * the classic OSM endpoint — but the point of the abstraction is the third
 * option: an SDI pointing the client at its own gazetteer with a URL template.
 * Nothing here knows about the map; the UI decides what to do with a result.
 */
import type { CustomGeocoderDef, NormalizedConfig } from "@map0/schema";

export interface SearchResult {
  /** primary line, e.g. a street with house number */
  label: string;
  /** secondary line, e.g. postcode, city, country */
  detail?: string;
  center: [number, number];
  /** [west, south, east, north] when the service knows the extent */
  bbox?: [number, number, number, number];
  /** true for a parsed coordinate rather than a service hit */
  isCoordinate?: boolean;
}

export interface SearchContext {
  /** current map centre, for result bias */
  center?: [number, number];
  /** UI locale, passed to services that localise names */
  lang?: string;
  signal?: AbortSignal;
}

export type SearchConfig = Exclude<NormalizedConfig["search"], false>;

/* ------------------------------ coordinates ------------------------------ */

const COORD = /^\s*(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/;

/**
 * Parse "48.2083, 16.3725" (latitude first, the convention every Austrian
 * authority writes in). Returns null when the input is not a coordinate pair or
 * the numbers are out of range.
 */
export function parseCoordinates(input: string): SearchResult | null {
  const match = COORD.exec(input);
  if (!match) return null;
  const lat = Number(match[1]!.replace(",", "."));
  const lng = Number(match[2]!.replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    detail: "WGS 84",
    center: [lng, lat],
    isCoordinate: true,
  };
}

/* -------------------------------- providers ------------------------------- */

const DEFAULT_URLS = {
  photon: "https://photon.komoot.io/api",
  nominatim: "https://nominatim.openstreetmap.org/search",
} as const;

interface PhotonProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  [k: string]: unknown;
}

function photonLabel(p: PhotonProperties): { label: string; detail?: string } {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const label = p.name || street || p.city || p.postcode || "?";
  const detail = [street && street !== label ? street : "", p.postcode, p.city ?? p.district, p.country]
    .filter(Boolean)
    .join(" · ");
  return { label, detail: detail || undefined };
}

/** Feature collection of points — Photon's shape, and the sane default for custom services. */
function fromGeoJson(body: unknown, labelField?: string, country?: string): SearchResult[] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];
  const results: SearchResult[] = [];
  for (const raw of features) {
    const f = raw as { properties?: PhotonProperties; geometry?: { coordinates?: number[] } };
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const props = f.properties ?? {};
    if (country && props.countrycode && String(props.countrycode).toUpperCase() !== country) continue;
    const custom = labelField ? props[labelField] : undefined;
    const { label, detail } = photonLabel(props);
    const extent = (f as { properties?: { extent?: number[] } }).properties?.extent;
    results.push({
      label: typeof custom === "string" && custom ? custom : label,
      detail,
      center: [coords[0]!, coords[1]!],
      /* Photon's extent is [west, north, east, south] — not the usual order */
      ...(extent?.length === 4
        ? { bbox: [extent[0]!, extent[3]!, extent[2]!, extent[1]!] as [number, number, number, number] }
        : {}),
    });
  }
  return results;
}

interface NominatimResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
}

function fromNominatim(body: unknown): SearchResult[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw: NominatimResult) => {
    const lat = Number(raw.lat);
    const lng = Number(raw.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const [first, ...rest] = (raw.display_name ?? "").split(", ");
    const bb = raw.boundingbox?.map(Number);
    return [
      {
        label: first || "?",
        detail: rest.join(", ") || undefined,
        center: [lng, lat] as [number, number],
        /* Nominatim: [south, north, west, east] */
        ...(bb?.length === 4 && bb.every(Number.isFinite)
          ? { bbox: [bb[2]!, bb[0]!, bb[3]!, bb[1]!] as [number, number, number, number] }
          : {}),
      },
    ];
  });
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => encodeURIComponent(values[key] ?? ""));
}

/** Build the request URL for the configured provider. */
export function buildSearchUrl(
  config: SearchConfig,
  query: string,
  ctx: SearchContext = {},
): string {
  const limit = String(config.limit);
  const lang = ctx.lang ?? "en";
  const [lng, lat] = ctx.center ?? [];

  if (typeof config.provider === "object") {
    return fillTemplate(config.provider.url, {
      query,
      limit,
      lang,
      lng: lng !== undefined ? String(lng) : "",
      lat: lat !== undefined ? String(lat) : "",
    });
  }

  const base = config.url ?? DEFAULT_URLS[config.provider];
  const url = new URL(base);
  if (config.provider === "photon") {
    url.searchParams.set("q", query);
    url.searchParams.set("limit", limit);
    url.searchParams.set("lang", ["de", "en", "fr", "it"].includes(lang) ? lang : "en");
    if (config.bias && lng !== undefined && lat !== undefined) {
      url.searchParams.set("lon", lng.toFixed(4));
      url.searchParams.set("lat", lat.toFixed(4));
    }
  } else {
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", limit);
    url.searchParams.set("accept-language", lang);
    if (config.country) url.searchParams.set("countrycodes", config.country.toLowerCase());
  }
  return url.toString();
}

/** Run a query against the configured geocoder. Coordinate input short-circuits. */
export async function search(
  config: SearchConfig,
  query: string,
  ctx: SearchContext = {},
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (config.coordinates) {
    const coordinate = parseCoordinates(trimmed);
    if (coordinate) return [coordinate];
  }
  if (trimmed.length < config.minLength) return [];

  const res = await fetch(buildSearchUrl(config, trimmed, ctx), { signal: ctx.signal });
  if (!res.ok) throw new Error(`geocoder responded with HTTP ${res.status}`);
  const body: unknown = await res.json();

  const format =
    typeof config.provider === "object"
      ? (config.provider.format ?? "geojson")
      : config.provider === "nominatim"
        ? "nominatim"
        : "geojson";
  const labelField =
    typeof config.provider === "object" ? config.provider.labelField : undefined;

  const results =
    format === "nominatim" ? fromNominatim(body) : fromGeoJson(body, labelField, config.country);
  return results.slice(0, config.limit);
}

export type { CustomGeocoderDef };
