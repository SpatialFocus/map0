import type { Finding, LayerReport, Level, ServiceReport } from "./types.js";

export interface FullReport {
  tool: string;
  version: string;
  input: string;
  attempts: string[];
  service: ServiceReport;
  /** a complete map0 config when --config was given */
  config?: Record<string, unknown>;
  /** "fail" when anything the tool checked rules the service out for map0 */
  verdict: Level;
  exitCode: number;
}

const SYMBOL: Record<Level, string> = { ok: "✓", info: "·", warn: "⚠", fail: "✗" };
const KIND_LABEL = { wms: "WMS", wmts: "WMTS", wfs: "WFS", "ogcapi-features": "OGC API Features" } as const;

interface Paint {
  level: (l: Level, s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
}

function paint(color: boolean): Paint {
  if (!color) return { level: (_l, s) => s, dim: (s) => s, bold: (s) => s };
  const codes: Record<Level, string> = { ok: "32", info: "2", warn: "33", fail: "31" };
  const esc = String.fromCharCode(27);
  return {
    level: (l, s) => `${esc}[${codes[l]}m${s}${esc}[0m`,
    dim: (s) => `${esc}[2m${s}${esc}[0m`,
    bold: (s) => `${esc}[1m${s}${esc}[0m`,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

const MAX_UNPROBED_PROBLEMS = 8;

/** which layers the text report lists: the probed ones first, then a handful of unprobed problem layers, or all */
export function listedLayers(
  layers: LayerReport[],
  all: boolean,
): { shown: LayerReport[]; hidden: number; hiddenProblems: number } {
  if (all) return { shown: layers, hidden: 0, hiddenProblems: 0 };
  const probed = layers.filter((l) => l.probed);
  const problems = layers.filter((l) => !l.probed && l.verdict !== "ok");
  const shown = [...probed, ...problems.slice(0, MAX_UNPROBED_PROBLEMS)];
  return {
    shown,
    hidden: layers.length - shown.length,
    hiddenProblems: Math.max(0, problems.length - MAX_UNPROBED_PROBLEMS),
  };
}

function renderFinding(f: Finding, p: Paint, indent: string): string {
  return `${indent}${p.level(f.level, SYMBOL[f.level])} ${p.dim(pad(f.code, 13))} ${f.message}`;
}

export function renderText(r: FullReport, opts: { color: boolean; all: boolean }): string {
  const p = paint(opts.color);
  const s = r.service;
  const out: string[] = [];

  out.push(`${p.bold(`${r.tool} ${r.version}`)} — ${r.input}`);
  out.push("");
  const head = [KIND_LABEL[s.kind], s.version].filter(Boolean).join(" ");
  out.push(`${pad("Service", 11)}${head}${s.title ? ` — ${s.title}` : ""}`);
  if (s.provider) out.push(`${pad("Provider", 11)}${s.provider}`);
  out.push(`${pad("URL", 11)}${s.url}`);
  if (s.capabilitiesUrl !== s.url) out.push(`${pad("", 11)}${p.dim(`capabilities: ${s.capabilitiesUrl}`)}`);
  for (const line of s.summary) out.push(`${pad("", 11)}${line}`);
  out.push("");

  out.push(p.bold("Checks"));
  for (const f of s.findings) out.push(renderFinding(f, p, "  "));
  out.push("");

  const probed = s.layers.filter((l) => l.probed);
  const { shown, hidden, hiddenProblems } = listedLayers(s.layers, opts.all);
  const layerWord = s.kind === "wfs" ? "feature types" : s.kind === "ogcapi-features" ? "collections" : "layers";
  const hintFlags =
    probed.length < s.layers.length ? p.dim(" — pick with --layer <name>, list everything with --all") : "";
  out.push(p.bold("Layers") + `  (${s.layerCount} ${layerWord}, ${probed.length} probed live)${hintFlags}`);
  const nameWidth = Math.min(40, Math.max(12, ...shown.map((l) => l.name.length)));
  for (const l of shown) {
    const title = l.title && l.title !== l.name ? truncate(l.title, 34) : "";
    const facts = l.facts.length ? p.dim(l.facts.join(" · ")) : "";
    out.push(
      `  ${p.level(l.verdict, SYMBOL[l.verdict])} ${pad(truncate(l.name, nameWidth), nameWidth)}  ${pad(title, 34)}  ${facts}`.trimEnd(),
    );
    const details = l.probed ? l.findings : l.findings.filter((f) => f.level === "warn" || f.level === "fail");
    for (const f of details) out.push(renderFinding(f, p, "      "));
    if (l.probe) out.push(p.dim(`      ${pad("probe", 15)}${l.probe.url}`));
  }
  if (hidden > 0) {
    const problems = hiddenProblems ? `, ${hiddenProblems} of them with warnings or failures` : "";
    out.push(p.dim(`  … ${hidden} more not probed${problems} (--all lists them)`));
  }
  out.push("");

  const counts = { ok: 0, warn: 0, fail: 0 };
  for (const l of s.layers) if (l.verdict !== "info") counts[l.verdict]++;
  const serviceFails = s.findings.filter((f) => f.level === "fail").length;
  const verdictLine =
    r.verdict === "fail"
      ? `${SYMBOL.fail} map0 cannot use this as configured` +
        (serviceFails ? ` (${serviceFails} service-level ${serviceFails === 1 ? "problem" : "problems"})` : "")
      : r.verdict === "warn"
        ? `${SYMBOL.warn} usable with caveats`
        : `${SYMBOL.ok} ready for map0`;
  out.push(
    `${p.bold(pad("Verdict", 11))}${p.level(r.verdict, verdictLine)}  ${p.dim(
      `layers: ${counts.ok} ok · ${counts.warn} warn · ${counts.fail} fail`,
    )}`,
  );
  out.push("");

  const snippets = probed.filter((l) => l.snippet).map((l) => l.snippet);
  if (r.config) {
    out.push(p.bold("map0 config") + p.dim("  (save as JSON and load it in the viewer, the configurator or the validator)"));
    out.push(JSON.stringify(r.config, null, 2));
  } else if (snippets.length) {
    out.push(
      p.bold("map0 layer definitions") + p.dim('  (paste into "layers"; --config wraps them into a complete config)'),
    );
    out.push(JSON.stringify(snippets, null, 2));
  }
  return out.join("\n");
}
