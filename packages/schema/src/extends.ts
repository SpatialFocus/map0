/**
 * Config inheritance via `extends` (C6): a map config can point to a shared
 * base config (org-wide basemaps, theming, catalog patterns) and only carry
 * its deltas. Merge semantics: objects merge recursively, the child wins on
 * scalars, and ARRAYS REPLACE as a whole (a layer list is an ordered statement,
 * not a set to be merged). Chains are allowed up to depth 3; cycles abort.
 */

export interface ExtendsOptions {
  /** URL the child config was loaded from — base for relative `extends` URLs */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxDepth?: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** child wins; objects deep-merge; arrays and scalars replace */
export function mergeConfigs(
  base: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(child)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeConfigs(out[key] as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve an `extends` chain and return the merged config (the `extends` key
 * itself is removed). Throws on unreachable bases, cycles, or chains > maxDepth.
 */
export async function resolveConfigExtends(
  raw: unknown,
  opts: ExtendsOptions = {},
): Promise<unknown> {
  if (!isPlainObject(raw) || typeof raw.extends !== "string") return raw;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxDepth = opts.maxDepth ?? 3;
  const seen = new Set<string>();

  let merged = { ...raw };
  let baseUrl = opts.baseUrl;
  let depth = 0;

  while (typeof merged.extends === "string") {
    if (++depth > maxDepth) {
      throw new Error(`config "extends" chain exceeds ${maxDepth} levels`);
    }
    const resolved = new URL(
      merged.extends,
      baseUrl ?? (typeof location !== "undefined" ? location.href : undefined),
    ).toString();
    if (seen.has(resolved)) {
      throw new Error(`config "extends" cycle detected at ${resolved}`);
    }
    seen.add(resolved);
    const res = await fetchImpl(resolved);
    if (!res.ok) {
      throw new Error(`could not fetch base config: HTTP ${res.status} (${resolved})`);
    }
    const base = (await res.json()) as unknown;
    if (!isPlainObject(base)) {
      throw new Error(`base config is not a JSON object (${resolved})`);
    }
    delete merged.extends;
    /* base may extend further — its own extends key survives the merge and is
       resolved in the next iteration, relative to the base's URL */
    merged = mergeConfigs(base, merged);
    baseUrl = resolved;
  }
  return merged;
}
