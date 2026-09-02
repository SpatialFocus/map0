import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoParquetLayerDef, NormalizedLayer } from "@map0/schema";
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
 * GeoParquet defaults to OGC:CRS84 (lon/lat WGS84), which is also the only CRS
 * MapLibre's geojson source understands. Anything else would render in the
 * wrong place, so fail fast with the CRS name — the COG adapter draws the same
 * line for non-3857 files (map0 does no client-side reprojection).
 */
export function assertWgs84(column: string, geo: GeoMetadata): void {
  const crs = geo.columns?.[column]?.crs;
  if (crs == null) return;
  const code = crs.id ? `${crs.id.authority}:${crs.id.code}` : "";
  if (code === "OGC:CRS84" || code === "EPSG:4326" || /\bWGS[ _]?84\b/i.test(crs.name ?? "")) {
    return;
  }
  throw new Error(
    `coordinates are in "${crs.name || code || "unknown CRS"}" — a geoparquet layer needs ` +
      `WGS84 (OGC:CRS84/EPSG:4326); reproject the file, e.g. ogr2ogr -t_srs EPSG:4326`,
  );
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
      /* int64 columns can decode to BigInt — JSON.stringify (popup de-dup,
         share state) throws on those */
      properties[key] = typeof value === "bigint" ? Number(value) : value;
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
  assertWgs84(primary, geo);

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

  const bbox = geo.columns?.[primary]?.bbox;
  return {
    fc: featureCollectionFromRows(rows, geo),
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

  constructor(def: NormalizedGeoParquet) {
    const { url, ...common } = def;
    super({
      ...common,
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    } as NormalizedGeoJson);
    this.url = url;
  }

  protected override async addToMap(): Promise<void> {
    const { fc, bounds } = await loadGeoParquet(this.url);
    (this.def as { data: unknown }).data = fc;
    /* the spec-level bbox saves the coordinate scan in bounds() (F2.2) */
    if (!this.def.bounds && bounds) this.def.bounds = bounds;
    super.addToMap();
  }
}
