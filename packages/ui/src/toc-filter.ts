/**
 * The layer panel's filter box (F2.7): case- and accent-insensitive matching of
 * layer and group titles — "strasse" finds "Straße", "lar" finds "Lärm" — and
 * the matched stretches of a title for highlighting.
 */

/** one character as the filter compares it: lower case, accents dropped, ß as ss */
function foldChar(ch: string): string {
  return ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss");
}

/** the folded text, and for every folded position the index of its source character */
function fold(text: string): { folded: string; source: number[] } {
  let folded = "";
  const source: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) source.push(i);
    folded += f;
    i += ch.length;
  }
  source.push(i);
  return { folded, source };
}

/** the terms of a filter query — folded, split at white space */
export function filterTerms(query: string): string[] {
  return fold(query).folded.split(/\s+/).filter(Boolean);
}

/** every term occurs in the text */
export function matchesAll(text: string, terms: readonly string[]): boolean {
  const { folded } = fold(text);
  return terms.every((t) => folded.includes(t));
}

/** the terms the text does not contain — what a group's children still have to match */
export function unmatchedTerms(text: string, terms: readonly string[]): string[] {
  const { folded } = fold(text);
  return terms.filter((t) => !folded.includes(t));
}

/** the text cut into plain and matched stretches, in order */
export function highlightSegments(
  text: string,
  terms: readonly string[],
): Array<{ text: string; hit: boolean }> {
  if (terms.length === 0) return [{ text, hit: false }];
  const { folded, source } = fold(text);
  const hit = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      for (let i = source[at]!; i < source[at + term.length]!; i++) hit[i] = true;
    }
  }
  const segments: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const last = segments[segments.length - 1];
    if (last && last.hit === hit[i]) last.text += text[i];
    else segments.push({ text: text[i]!, hit: hit[i]! });
  }
  return segments;
}
