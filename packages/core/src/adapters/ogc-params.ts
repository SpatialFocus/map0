/** OGC KVP names are case-insensitive; values and vendor parameter names retain their spelling. */
export function setOgcParams(search: URLSearchParams, params: Record<string, string>): void {
  for (const [key, value] of Object.entries(params)) {
    for (const existing of [...search.keys()]) {
      if (existing.toUpperCase() === key.toUpperCase()) search.delete(existing);
    }
    search.set(key, value);
  }
}
