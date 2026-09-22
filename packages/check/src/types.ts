/** Severity of a finding. `info` never degrades a verdict. */
export type Level = "ok" | "info" | "warn" | "fail";

export interface Finding {
  level: Level;
  /** stable, machine-readable code such as "https", "cors", "crs-3857" */
  code: string;
  message: string;
}

export type ServiceKind = "wms" | "wmts" | "wfs" | "ogcapi-features";

/** one live request made against the service (a tile, a GetFeature, an items page) */
export interface ProbeResult {
  url: string;
  status?: number;
  ms?: number;
  bytes?: number;
  contentType?: string;
  /** Access-Control-Allow-Origin header value, null when absent */
  cors?: string | null;
  error?: string;
}

export interface LayerReport {
  name: string;
  title: string;
  verdict: Level;
  /** short facts for the table row, e.g. "EPSG:3857", "queryable", "zoom ≥ 12" */
  facts: string[];
  findings: Finding[];
  probed: boolean;
  probe?: ProbeResult;
  /** a map0 layer definition, ready to paste into "layers" */
  snippet?: Record<string, unknown>;
}

export interface ServiceReport {
  kind: ServiceKind;
  version?: string;
  title?: string;
  provider?: string;
  /** the URL a map0 layer definition carries for this service */
  url: string;
  capabilitiesUrl: string;
  /** one-line facts shown under the header */
  summary: string[];
  findings: Finding[];
  layerCount: number;
  layers: LayerReport[];
}

export interface Options {
  /** Origin header sent with every request, so CORS answers are realistic */
  origin: string;
  timeoutMs: number;
  /** how many layers get live probes when --layer is not given */
  probeLimit: number;
  /** layer names picked with --layer */
  layers: string[];
  /** list (and probe) every layer */
  all: boolean;
}

const RANK: Record<Level, number> = { ok: 0, info: 0, warn: 1, fail: 2 };

/** fail beats warn beats ok; info counts as ok */
export function verdictOf(findings: Finding[]): Level {
  let worst: Level = "ok";
  for (const f of findings) {
    if (RANK[f.level] > RANK[worst]) worst = f.level;
  }
  return worst;
}

export function finding(level: Level, code: string, message: string): Finding {
  return { level, code, message };
}

/** which layers get live probes: the --layer picks, or the first `probeLimit` */
export function probeTargets(names: string[], opts: Options): { targets: Set<string>; missing: string[] } {
  if (opts.layers.length > 0) {
    const known = new Set(names);
    return {
      targets: new Set(opts.layers.filter((n) => known.has(n))),
      missing: opts.layers.filter((n) => !known.has(n)),
    };
  }
  const count = opts.all ? names.length : opts.probeLimit;
  return { targets: new Set(names.slice(0, count)), missing: [] };
}
