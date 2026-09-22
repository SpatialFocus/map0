import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadOgcClient } from "@map0/core";
import { validateConfig } from "@map0/schema";
import { detectService } from "./detect.js";
import { AUSTRIA_CENTER, unionBbox, type BBox } from "./geo.js";
import { analyzeOgcApi } from "./ogcapi.js";
import { renderText, type FullReport } from "./report.js";
import { finding, type Level, type Options, type ServiceReport } from "./types.js";
import { analyzeWfs } from "./wfs.js";
import { analyzeWms } from "./wms.js";
import { analyzeWmts } from "./wmts.js";

export const TOOL = "map0-check";
/** one version, the package's — read next to this file whether it runs from src/ or dist/ */
export const VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }
).version;

const HELP = `${TOOL} ${VERSION} — can map0 show this OGC service?

Usage: map0-check <url> [options]

  <url>                 a WMS/WFS endpoint or GetCapabilities URL, a WMTS capabilities
                        URL, an OGC API landing page or collection URL

Options:
  -l, --layer <name>    probe this layer / feature type / collection (repeatable)
      --all             list and probe every layer (default: the first 3 plus problems)
      --probe-limit <n> how many layers to probe live without --layer (default 3)
      --config          print a complete map0 config instead of bare layer snippets
      --json            machine-readable report on stdout
      --origin <url>    Origin header for the CORS checks (default https://map0.net)
      --timeout <ms>    per-request timeout (default 15000)
      --no-color        plain text
  -h, --help            this text
  -v, --version         version

Exit codes: 0 usable · 1 the service (or a probed layer) cannot be used by map0 · 2 no OGC service found / bad usage
`;

const BASEMAP_GREY = {
  id: "grau",
  title: "basemap.at Grau",
  type: "raster",
  url: "https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png",
  attribution: "© basemap.at",
  maxZoom: 19,
};

/** a complete, loadable map0 config around the probed layers */
export function buildConfig(service: ServiceReport, snippets: Array<Record<string, unknown>>): Record<string, unknown> {
  const bounds = unionBbox(snippets.map((s) => (Array.isArray(s.bounds) ? (s.bounds as BBox) : undefined)));
  return {
    $schema: "https://map0.net/schema/v1.json",
    version: 1,
    meta: { title: service.title ?? service.url },
    map: bounds ? { bounds } : { center: AUSTRIA_CENTER, zoom: 7 },
    basemaps: [BASEMAP_GREY],
    layers: snippets,
  };
}

function overallVerdict(service: ServiceReport): Level {
  if (service.findings.some((f) => f.level === "fail")) return "fail";
  const probed = service.layers.filter((l) => l.probed);
  if (probed.length > 0) {
    if (probed.some((l) => l.verdict === "fail")) return "fail";
  } else if (service.layers.length > 0 && service.layers.every((l) => l.verdict === "fail")) {
    return "fail";
  }
  const pool = probed.length ? probed : service.layers;
  if (service.findings.some((f) => f.level === "warn") || pool.some((l) => l.verdict !== "ok")) return "warn";
  return "ok";
}

export async function main(argv: string[]): Promise<number> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        layer: { type: "string", short: "l", multiple: true },
        all: { type: "boolean" },
        "probe-limit": { type: "string" },
        config: { type: "boolean" },
        json: { type: "boolean" },
        origin: { type: "string" },
        timeout: { type: "string" },
        "no-color": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : e}\n\n${HELP}`);
    return 2;
  }
  const v = parsed.values as Record<string, string | boolean | string[] | undefined>;
  if (v.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  const input = parsed.positionals[0];
  if (v.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (!input) {
    process.stderr.write(HELP);
    return 2;
  }
  try {
    new URL(input);
  } catch {
    process.stderr.write(`not a URL: ${input}\n`);
    return 2;
  }

  const opts: Options = {
    origin: typeof v.origin === "string" ? v.origin : "https://map0.net",
    timeoutMs: Number(v.timeout ?? 15000) || 15000,
    probeLimit: Number(v["probe-limit"] ?? 3) || 3,
    layers: Array.isArray(v.layer) ? v.layer : [],
    all: Boolean(v.all),
  };
  const asJson = Boolean(v.json);
  const color = !v["no-color"] && Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

  /* no Web Worker in Node — ogc-client parses on the main thread */
  (await loadOgcClient()).enableFallbackWithoutWorker();

  const detection = await detectService(input, { origin: opts.origin, timeoutMs: opts.timeoutMs });
  if ("error" in detection) {
    if (asJson) {
      const body = { tool: TOOL, version: VERSION, input, error: detection.error, attempts: detection.attempts };
      process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      process.stderr.write(
        `${TOOL}: ${detection.error}\n  tried:\n${detection.attempts.map((a) => `    ${a}`).join("\n")}\n`,
      );
    }
    return 2;
  }

  let service: ServiceReport;
  try {
    switch (detection.kind) {
      case "wms":
        service = await analyzeWms(detection, opts);
        break;
      case "wmts":
        service = await analyzeWmts(detection, opts);
        break;
      case "wfs":
        service = await analyzeWfs(detection, opts);
        break;
      case "ogcapi-features":
        service = await analyzeOgcApi(detection, opts);
        break;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (asJson) {
      const body = { tool: TOOL, version: VERSION, input, kind: detection.kind, error: msg };
      process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    } else {
      process.stderr.write(
        `${TOOL}: ${detection.kind.toUpperCase()} detected at ${detection.capabilitiesUrl}, but the capabilities could not be parsed: ${msg}\n`,
      );
    }
    return 2;
  }

  const snippets = service.layers.filter((l) => l.probed && l.snippet).map((l) => l.snippet as Record<string, unknown>);
  const config = buildConfig(service, snippets);
  /* the snippets are built by map0's own functions — this catches the day that stops being true */
  if (snippets.length > 0) {
    const validation = validateConfig(config);
    service.findings.push(
      validation.valid
        ? finding("ok", "schema", `${snippets.length === 1 ? "the layer definition validates" : `all ${snippets.length} layer definitions validate`} against map0's config schema`)
        : finding(
            "fail",
            "schema",
            `the generated config fails map0's validator: ${validation.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`,
          ),
    );
  }

  const verdict = overallVerdict(service);
  const report: FullReport = {
    tool: TOOL,
    version: VERSION,
    input,
    attempts: detection.attempts,
    service,
    ...(v.config ? { config } : {}),
    verdict,
    exitCode: verdict === "fail" ? 1 : 0,
  };
  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${renderText(report, { color, all: opts.all })}\n`);
  return report.exitCode;
}
