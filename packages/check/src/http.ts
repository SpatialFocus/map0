import { finding, type Finding } from "./types.js";

export interface HttpResult {
  url: string;
  /** after redirects */
  finalUrl: string;
  status: number;
  ok: boolean;
  ms: number;
  bytes: number;
  contentType: string;
  /** Access-Control-Allow-Origin header, null when absent */
  cors: string | null;
  /** decoded body for textual responses (XML, JSON, HTML, text) */
  text?: string;
  error?: string;
}

export interface FetchOptions {
  origin: string;
  timeoutMs: number;
  accept?: string;
}

const USER_AGENT = "map0-check (+https://map0.net)";

/** one timed GET with an Origin header, never throws */
export async function timedFetch(url: string, opts: FetchOptions): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      headers: {
        Origin: opts.origin,
        Accept: opts.accept ?? "*/*",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      ms: Math.round(performance.now() - t0),
      bytes: buf.byteLength,
      contentType,
      cors: res.headers.get("access-control-allow-origin"),
      text: isTextual(contentType, buf) ? new TextDecoder("utf-8").decode(buf) : undefined,
    };
  } catch (e) {
    return {
      url,
      finalUrl: url,
      status: 0,
      ok: false,
      ms: Math.round(performance.now() - t0),
      bytes: 0,
      contentType: "",
      cors: null,
      error: errorMessage(e, opts.timeoutMs),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isTextual(contentType: string, buf: Uint8Array): boolean {
  if (/xml|json|text|html|javascript/i.test(contentType)) return true;
  if (contentType) return false;
  const first = buf.find(
    (b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf,
  );
  return first === 0x3c || first === 0x7b || first === 0x5b; // "<", "{", "["
}

function errorMessage(e: unknown, timeoutMs: number): string {
  if (e instanceof Error) {
    if (e.name === "AbortError") return `no answer within ${timeoutMs} ms`;
    const cause = (e as { cause?: { code?: string; message?: string } }).cause;
    const detail = cause?.code ?? cause?.message;
    return detail ? `${e.message} (${detail})` : e.message;
  }
  return String(e);
}

export function shortType(contentType: string): string {
  return contentType.split(";")[0]?.trim() || "no content-type";
}

export function isImageType(contentType: string): boolean {
  return /^image\//i.test(contentType.trim());
}

export function isJsonType(contentType: string): boolean {
  return /json/i.test(contentType);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "200 in 457 ms (1.2 MB, text/xml)" */
export function describeResponse(r: HttpResult): string {
  if (r.error) return r.error;
  return `${r.status} in ${r.ms} ms (${fmtBytes(r.bytes)}, ${shortType(r.contentType)})`;
}

/**
 * Error text from an OGC exception body: WMS ServiceException, OWS ExceptionText,
 * or an OGC API problem document. Undefined when the body is not an error report.
 */
export function exceptionText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const xml =
    /<(?:[\w.-]+:)?ServiceException\b[^>]*>([\s\S]*?)<\//.exec(text) ??
    /<(?:[\w.-]+:)?ExceptionText\b[^>]*>([\s\S]*?)<\//.exec(text);
  if (xml?.[1] !== undefined) return squash(xml[1]);
  if (/<(?:[\w.-]+:)?(ServiceExceptionReport|ExceptionReport)\b/.test(text)) {
    const code = /exceptionCode="([^"]+)"|code="([^"]+)"/.exec(text);
    const name = code?.[1] ?? code?.[2];
    return `OGC exception report${name ? ` (${name})` : ""}`;
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      const msg = [o.title, o.description ?? o.detail ?? o.message].filter((v) => typeof v === "string").join(": ");
      if (msg && o.type !== "FeatureCollection") return squash(msg);
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

function squash(s: string): string {
  const one = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return one.length > 220 ? `${one.slice(0, 217)}…` : one;
}

/** map0's URL policy: http is blocked as mixed content on https pages */
export function httpsFinding(url: string): Finding {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase();
  if (scheme === "https") return finding("ok", "https", "URL uses https");
  if (scheme === "http") {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep empty */
    }
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
      return finding("info", "https", "http on loopback — fine for local development only");
    }
    return finding(
      "fail",
      "https",
      "http URL: blocked as mixed content on an https page — map0's validator rejects it; use https",
    );
  }
  return finding("warn", "https", `unusual URL scheme "${scheme ?? "none"}"`);
}

/**
 * Browsers (and so MapLibre, which fetches tiles with fetch()) only read a
 * cross-origin response when it carries Access-Control-Allow-Origin.
 */
export function corsFinding(res: HttpResult, what: string, origin: string): Finding {
  if (res.error) return finding("info", "cors", `${what}: not checked (request failed)`);
  if (res.cors === null) {
    return finding(
      "fail",
      "cors",
      `${what}: no Access-Control-Allow-Origin header — browsers block the response, map0 cannot read it`,
    );
  }
  if (res.cors === "*" || res.cors.toLowerCase() === origin.toLowerCase()) {
    return finding("ok", "cors", `${what}: Access-Control-Allow-Origin: ${res.cors}`);
  }
  return finding(
    "warn",
    "cors",
    `${what}: Access-Control-Allow-Origin is "${res.cors}", not "*" — only that origin may embed the service`,
  );
}

/** set query parameters, replacing existing keys case-insensitively */
export function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    for (const existing of [...u.searchParams.keys()]) {
      if (existing.toLowerCase() === key.toLowerCase()) u.searchParams.delete(existing);
    }
    u.searchParams.set(key, value);
  }
  return u.toString();
}

/** drop query parameters by name, case-insensitively; a trailing "?" goes too */
export function withoutParams(url: string, keys: string[]): string {
  const u = new URL(url);
  const drop = new Set(keys.map((k) => k.toLowerCase()));
  for (const existing of [...u.searchParams.keys()]) {
    if (drop.has(existing.toLowerCase())) u.searchParams.delete(existing);
  }
  return u.toString().replace(/\?$/, "");
}
