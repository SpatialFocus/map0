/**
 * The single import site for @camptocamp/ogc-client.
 *
 * Capabilities parsing is needed in two places — the WMTS adapter and the
 * add-layer dialog — and every `import("@camptocamp/ogc-client")` statement in
 * the source becomes its own chunk at build time, so importing it twice ships
 * the library twice (~50 KB gzip each). Everything goes through here instead.
 */
export type OgcClient = typeof import("@camptocamp/ogc-client");

let pending: Promise<OgcClient> | undefined;

export function loadOgcClient(): Promise<OgcClient> {
  /* ogc-client parses XML in a base64-inlined blob worker — bundler-safe.
     (Do NOT call enableFallbackWithoutWorker: its handler module can be dropped
     by dep optimizers, leaving requests queued forever.) */
  pending ??= import("@camptocamp/ogc-client");
  return pending;
}
