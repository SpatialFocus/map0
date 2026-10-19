/**
 * Lit's css`` literals reach the bundle exactly as written: esbuild minifies
 * the code around them, never the string inside. By volume, styles.ts is
 * mostly comments and indentation — about 3 KB of the page tier's gzip — so
 * this strips both from every css`` literal in packages/ui/src before the
 * build sees it.
 *
 * Deliberately simple: comments go, white space collapses to one space, and
 * the spaces around { } ; , and > go. Spaces around ":" stay — ".a :hover"
 * and ".a:hover" are different selectors. A literal with an interpolation
 * fails the build instead of being half-minified.
 */
export function minifyCssLiterals() {
  return {
    name: "map0:minify-css-literals",
    enforce: "pre",
    transform(code, id) {
      if (!/\/packages\/ui\/src\/[^/]+\.ts$/.test(id.replace(/\\/g, "/")) || !code.includes("css`")) {
        return null;
      }
      const out = code.replace(/css`([^`]*)`/g, (_, body) => {
        if (body.includes("${")) {
          throw new Error(`${id}: a css\`\` literal with an interpolation — teach scripts/minify-css-literals.mjs first`);
        }
        const min = body
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\s+/g, " ")
          .replace(/\s*([{};,>])\s*/g, "$1")
          .trim();
        return `css\`${min}\``;
      });
      /* map: null keeps the incoming mappings — off within styles.ts only,
         which is nothing but this literal */
      return { code: out, map: null };
    },
  };
}
