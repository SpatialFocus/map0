import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoParquetLayerDef, LayerCrs, NormalizedLayer } from "@map0/schema";
import {
  isWgs84Code,
  layerCrs,
  normalizeCrsCode,
  projectorToWgs84,
  reprojectGeoJson,
  type Projector,
} from "../reproject.js";
import { GeoJsonAdapter, type NormalizedGeoJson } from "./geojson.js";

type NormalizedGeoParquet = GeoParquetLayerDef & NormalizedLayer & { type: "geoparquet" };

/** the "geo" file-metadata block of the GeoParquet spec — only the fields read here */
export interface GeoMetadata {
  primary_column?: string;
  columns?: Record<
    string,
    {
      bbox?: number[];
      /** PROJJSON; omitted = OGC:CRS84 per spec */
      crs?: { name?: string; id?: { authority?: string; code?: string | number } } | null;
    }
  >;
}

/**
 * Forward transform for a geometry column, or null when its coordinates are
 * WGS84 already (OGC:CRS84 is the spec default; MapLibre takes nothing else).
 * A `crs` from the config wins. Otherwise the file's PROJJSON decides: a code
 * the built-in registry knows uses the registry definition — it carries the
 * datum shift GDAL's PROJJSON usually lacks — and anything else is handed to
 * proj4 as PROJJSON. Throws, naming the CRS and the fix, when neither works.
 */
export async function geoParquetProjector(
  column: string,
  geo: GeoMetadata,
  configured?: LayerCrs,
): Promise<Projector | null> {
  const fromConfig = layerCrs(configured);
  if (fromConfig) return projectorToWgs84(fromConfig);
  const crs = geo.columns?.[column]?.crs;
  if (crs == null) return null;
  const code = crs.id ? normalizeCrsCode(`${crs.id.authority}:${crs.id.code}`) : "";
  const name = (crs.name ?? "").trim();
  if (code ? isWgs84Code(code) : /^WGS[ _]?84(?:\s*\(CRS84\))?$/i.test(name)) return null;
  const label = name || code || "unknown CRS";
  try {
    if (code) {
      try {
        return await projectorToWgs84({ code });
      } catch {
        /* not in the built-in registry — try the file's own definition */
      }
    }
    return await projectorToWgs84({ code: code || `PROJJSON:${name || "unnamed"}`, def: crs });
  } catch (e) {
    throw new Error(
      `coordinates are in "${label}" and its definition could not be resolved — set ` +
        `"crs": { "code": "${code || "EPSG:…"}", "def": "+proj=…" } on the layer, or reproject ` +
        `the file (ogr2ogr -t_srs EPSG:4326). ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Rows (as hyparquet returns them, geometry columns already decoded to GeoJSON
 * geometries) → FeatureCollection. Non-primary geometry columns are dropped
 * from the properties: their values are geometry objects, useless in a popup.
 */
export function featureCollectionFromRows(
  rows: Array<Record<string, unknown>>,
  geo: GeoMetadata,
): FeatureCollection {
  const primary = geo.primary_column ?? "geometry";
  const geometryColumns = new Set(Object.keys(geo.columns ?? {}));
  geometryColumns.add(primary);

  const features = rows.map((row): Feature => {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (geometryColumns.has(key)) continue;
      // Keep small integers numeric and preserve larger identifiers as exact decimal strings.
      if (typeof value === "bigint") {
        const number = Number(value);
        properties[key] = Number.isSafeInteger(number) ? number : value.toString();
      } else {
        properties[key] = value;
      }
    }
    return { type: "Feature", geometry: (row[primary] ?? null) as Geometry, properties };
  });
  return { type: "FeatureCollection", features };
}

/**
 * Fetch and decode a GeoParquet file. One plain GET (no range requests needed —
 * the whole file is read anyway), then hyparquet parses the footer and decodes
 * the WKB geometry column to GeoJSON geometries. The decoder is imported here,
 * lazily: configs without a geoparquet layer never load it.
 */
async function loadGeoParquet(
  url: string,
  crs: LayerCrs | undefined,
): Promise<{ fc: FeatureCollection; bounds: [number, number, number, number] | null }> {
  const [{ parquetMetadataAsync, parquetReadObjects }, buffer] = await Promise.all([
    import("hyparquet"),
    fetch(url).then((res) => {
      if (!res.ok) throw new Error(`fetching ${url} failed: ${res.status} ${res.statusText}`);
      return res.arrayBuffer();
    }),
  ]);
  const file = {
    byteLength: buffer.byteLength,
    slice: (start: number, end?: number) => buffer.slice(start, end),
  };

  const metadata = await parquetMetadataAsync(file);

  /* hyparquet decodes uncompressed and snappy (the overwhelming default) by
     itself — the extra-codec bundle (gzip/brotli/zstd/lz4, ~76 KB) is only
     fetched when this file actually uses one of those */
  const codecs = metadata.row_groups.flatMap((rg) =>
    rg.columns.map((column) => column.meta_data?.codec),
  );
  const needsExtraCodecs = codecs.some((c) => c && c !== "UNCOMPRESSED" && c !== "SNAPPY");
  const compressors = needsExtraCodecs
    ? (await import("hyparquet-compressors")).compressors
    : undefined;
  const geoKv = metadata.key_value_metadata?.find((kv) => kv.key === "geo");
  if (!geoKv?.value) {
    throw new Error(
      `${url} has no "geo" file metadata — plain parquet is not GeoParquet; ` +
        `convert it, e.g. with GDAL (ogr2ogr -f Parquet) or DuckDB spatial`,
    );
  }
  const geo = JSON.parse(geoKv.value) as GeoMetadata;
  const primary = geo.primary_column ?? "geometry";
  const project = await geoParquetProjector(primary, geo, crs);

  const rows = (await parquetReadObjects({ file, metadata, compressors })) as Array<
    Record<string, unknown>
  >;

  /* hyparquet decodes WKB to GeoJSON geometries by itself — guard against a
     file whose geometry column it did not recognise, instead of rendering
     nothing without a word */
  const sample = rows.find((row) => row[primary] != null)?.[primary];
  if (sample !== undefined && (typeof sample !== "object" || !("type" in (sample as object)))) {
    throw new Error(`the geometry column "${primary}" of ${url} could not be decoded`);
  }

  const fc = featureCollectionFromRows(rows, geo);
  if (project) {
    /* the metadata bbox is in the file's CRS too — bounds() scans the features instead */
    return { fc: reprojectGeoJson(fc, project), bounds: null };
  }
  const bbox = geo.columns?.[primary]?.bbox;
  return {
    fc,
    bounds: bbox && bbox.length === 4 ? (bbox as [number, number, number, number]) : null,
  };
}

/**
 * GeoParquet layer: fetch + decode in the browser, then everything — styling,
 * clustering, popups, hover, legend, zoom-to-layer — is the geojson pipeline.
 * Same trade-off as a geojson URL (the whole file is loaded), at a fraction of
 * the transfer size.
 */
export class GeoParquetAdapter extends GeoJsonAdapter {
  private readonly url: string;
  private readonly crs: LayerCrs | undefined;

  constructor(def: NormalizedGeoParquet) {
    /* crs is resolved here against the file metadata, not by the geojson base */
    const { url, crs, ...common } = def;
    super({
      ...common,
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    } as NormalizedGeoJson);
    this.url = url;
    this.crs = crs;
  }

  protected override async addToMap(): Promise<void> {
    const { fc, bounds } = await loadGeoParquet(this.url, this.crs);
    (this.def as { data: unknown }).data = fc;
    /* the spec-level bbox saves the coordinate scan in bounds() (F2.2) */
    if (!this.def.bounds && bounds) this.def.bounds = bounds;
    await super.addToMap();
  }
}
