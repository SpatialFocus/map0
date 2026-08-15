/**
 * Coordinate readout in multiple CRS (F5.6). proj4 only knows 4326/3857 out of
 * the box — common Austrian SDI systems ship as built-in definitions, anything
 * else can be registered via config (controls.coordinates.crs[].def).
 */
import type Proj4 from "proj4";

/** proj4 is only needed once someone asks for coordinates — keep it out of the entry chunk */
type Proj4Module = typeof Proj4;
let proj4: Proj4Module | undefined;

export async function loadProj4(): Promise<Proj4Module> {
  proj4 ??= (await import("proj4")).default;
  return proj4;
}

export interface CrsDisplayDef {
  code: string;
  label?: string;
  /** proj4 definition string for CRS unknown to the built-in registry */
  def?: string;
}

export interface CoordinateEntry {
  code: string;
  label: string;
  text: string;
}

const MGI_TOWGS84 = "+towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +ellps=bessel";

const KNOWN: Record<string, { def: string; label: string; precision: number }> = {
  "EPSG:31254": {
    label: "MGI / GK M28",
    precision: 2,
    def: `+proj=tmerc +lat_0=0 +lon_0=10.3333333333333 +k=1 +x_0=0 +y_0=-5000000 ${MGI_TOWGS84} +units=m +no_defs`,
  },
  "EPSG:31255": {
    label: "MGI / GK M31",
    precision: 2,
    def: `+proj=tmerc +lat_0=0 +lon_0=13.3333333333333 +k=1 +x_0=0 +y_0=-5000000 ${MGI_TOWGS84} +units=m +no_defs`,
  },
  "EPSG:31256": {
    label: "MGI / GK M34",
    precision: 2,
    def: `+proj=tmerc +lat_0=0 +lon_0=16.3333333333333 +k=1 +x_0=0 +y_0=-5000000 ${MGI_TOWGS84} +units=m +no_defs`,
  },
  "EPSG:31287": {
    label: "MGI / Austria Lambert",
    precision: 2,
    def: `+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.3333333333333 +x_0=400000 +y_0=400000 ${MGI_TOWGS84} +units=m +no_defs`,
  },
  "EPSG:32632": { label: "UTM 32N", precision: 2, def: "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs" },
  "EPSG:32633": { label: "UTM 33N", precision: 2, def: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs" },
};

/** Austrian Gauß-Krüger zone by longitude (meridian strips M28/M31/M34). */
export function autoGkCode(lng: number): "EPSG:31254" | "EPSG:31255" | "EPSG:31256" {
  if (lng < 11.8333333) return "EPSG:31254";
  if (lng < 14.8333333) return "EPSG:31255";
  return "EPSG:31256";
}

/** UTM zone EPSG code (north/south hemisphere aware). */
export function autoUtmCode(lng: number, lat: number): string {
  const zone = Math.max(1, Math.min(60, Math.floor((lng + 180) / 6) + 1));
  return `EPSG:${lat >= 0 ? 326 : 327}${String(zone).padStart(2, "0")}`;
}

function ensureRegistered(p: Proj4Module, code: string, def?: string): boolean {
  try {
    p(code); // known already?
    return true;
  } catch {
    const known = def ?? KNOWN[code]?.def ?? (/^EPSG:326\d\d$/.test(code)
      ? `+proj=utm +zone=${Number(code.slice(-2))} +datum=WGS84 +units=m +no_defs`
      : /^EPSG:327\d\d$/.test(code)
        ? `+proj=utm +zone=${Number(code.slice(-2))} +south +datum=WGS84 +units=m +no_defs`
        : undefined);
    if (!known) return false;
    p.defs(code, known);
    return true;
  }
}

/** Load proj4 (once), then format — the entry point used by the map. */
export async function formatCoordinatesAsync(
  lng: number,
  lat: number,
  crsList?: CrsDisplayDef[],
): Promise<CoordinateEntry[]> {
  await loadProj4();
  return formatCoordinates(lng, lat, crsList);
}

/**
 * Format a WGS84 position in the display CRS list. Default (no config):
 * WGS 84 + the matching Austrian GK strip + the matching UTM zone.
 * Requires `loadProj4()` to have run — use `formatCoordinatesAsync` unless proj4
 * is known to be loaded already.
 */
export function formatCoordinates(
  lng: number,
  lat: number,
  crsList?: CrsDisplayDef[],
): CoordinateEntry[] {
  const list: CrsDisplayDef[] =
    crsList && crsList.length > 0
      ? crsList
      : [{ code: "EPSG:4326" }, { code: autoGkCode(lng) }, { code: autoUtmCode(lng, lat) }];

  const p = proj4;
  const entries: CoordinateEntry[] = [];
  for (const item of list) {
    if (item.code === "EPSG:4326") {
      entries.push({
        code: item.code,
        label: item.label ?? "WGS 84",
        text: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
      });
      continue;
    }
    if (!p) {
      console.warn("[map0] proj4 is not loaded yet — use formatCoordinatesAsync()");
      continue;
    }
    if (!ensureRegistered(p, item.code, item.def)) {
      console.warn(`[map0] unknown CRS "${item.code}" — provide a proj4 "def" in the config`);
      continue;
    }
    try {
      const [x, y] = p("EPSG:4326", item.code, [lng, lat]) as [number, number];
      const precision = KNOWN[item.code]?.precision ?? 2;
      entries.push({
        code: item.code,
        label: item.label ?? KNOWN[item.code]?.label ?? item.code,
        text: `${x.toFixed(precision)}, ${y.toFixed(precision)}`,
      });
    } catch (e) {
      console.warn(`[map0] coordinate transform to ${item.code} failed`, e);
    }
  }
  return entries;
}
