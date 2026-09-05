/**
 * docs/config-reference.md — the key-by-key config reference, generated from
 * packages/schema/v1.json (N12 in docs/03-requirements.md).
 *
 * v1.json is hand-written because its `description` texts ARE the documentation;
 * this script only rearranges them into one Markdown page: a section per object
 * definition, a table row per key, `$ref`s cross-linked. Nothing here knows the
 * config format — a key added to v1.json appears on the next run, and
 * packages/schema/src/config-reference.test.ts fails until the committed Markdown
 * is regenerated. Output is a pure function of the schema, so running it twice
 * changes nothing.
 *
 * What it understands: `properties`, `required`, `$ref`, `const`, `enum`,
 * `default`, `oneOf`/`anyOf`, arrays (`items`, tuples, min/maxItems), inline
 * objects (nested rows), `additionalProperties`, numeric/string constraints, and
 * the `if`/`then`/`else` + object-level `oneOf` idioms v1.json uses for
 * conditional keys. Every `description` in the schema ends up on the page — the
 * generator throws if a definition is neither a section nor referenced.
 *
 * Usage: node scripts/config-reference.mjs           # writes docs/config-reference.md
 *        node scripts/config-reference.mjs --check   # exit 1 when the file is stale
 * `pnpm docs:reference` runs the first form.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
export const SCHEMA_PATH = fileURLToPath(new URL("../packages/schema/v1.json", import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL("../docs/config-reference.md", import.meta.url));

/* ------------------------------------------------------------------------------------ */
/* Section order and titles                                                              */
/* ------------------------------------------------------------------------------------ */

const ROOT = "<root>"; // the schema itself
const COMMON = "<common layer keys>"; // synthetic: keys every leaf layer type shares
const LAYER_TYPES = "<layer types>"; // placeholder: the branches of the layer oneOf, in schema order

/**
 * Sections are grouped for the table of contents. A definition that is not listed
 * here still gets a section — under "Other", in schema order — so nothing added to
 * v1.json can silently disappear from the reference.
 */
const GROUPS = [
  { title: "Top level", sections: [ROOT, "meta", "map", "basemap"] },
  { title: "Layers", sections: ["layer", COMMON, LAYER_TYPES] },
  {
    title: "Layer sub-objects",
    sections: [
      "metadata",
      "legendEntry",
      "popup",
      "wmsInfo",
      "field",
      "hover",
      "clusterOptions",
      "styleLayer",
      "cogColor",
      "cogColorClass",
      "hillshadeOptions",
    ],
  },
  {
    title: "Controls",
    sections: [
      "controls",
      "scaleOptions",
      "geolocateOptions",
      "attributionOptions",
      "layerSwitcherOptions",
      "basemapSwitcherOptions",
      "legendControlOptions",
      "coordinatesOptions",
    ],
  },
  {
    title: "Search, print, theme, i18n, permalink",
    sections: ["search", "customGeocoder", "print", "theme", "i18n", "permalinkOptions"],
  },
  { title: "Coordinate reference systems", sections: ["layerCrs", "crs"] },
];

/** Markdown heading text per definition; anything else falls back to `fallbackTitle()`. */
const TITLES = {
  [ROOT]: "Top level",
  [COMMON]: "Common layer keys",
  /* array items read as nouns ("array of basemap"), single-key objects as their key */
  layer: "layer",
  basemap: "basemap",
  legendEntry: "legend entry",
  wmsInfo: "`info` (WMS GetFeatureInfo)",
  field: "field",
  clusterOptions: "`cluster` options",
  styleLayer: "MapLibre style layer",
  cogColor: "`color` (COG)",
  cogColorClass: "color class (COG)",
  hillshadeOptions: "`hillshade` options",
  scaleOptions: "`scale` options",
  geolocateOptions: "`geolocate` options",
  attributionOptions: "`attribution` options",
  layerSwitcherOptions: "`layerSwitcher` options",
  basemapSwitcherOptions: "`basemapSwitcher` options",
  legendControlOptions: "`legend` options (control)",
  coordinatesOptions: "`coordinates` options",
  customGeocoder: "`provider` (custom geocoder)",
  permalinkOptions: "`permalink` options",
  layerCrs: "`crs` (layer)",
  crs: "`crs` (coordinates control)",
};

/* ------------------------------------------------------------------------------------ */
/* Markdown helpers                                                                      */
/* ------------------------------------------------------------------------------------ */

const code = (s) => "`" + s + "`";

/** GitHub-style heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (title) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/ +/g, "-");

/**
 * Prose for a table cell: pipes, emphasis markers and angle brackets are escaped
 * outside code spans (a description like "circle-*, line-*" must not italicise
 * half a sentence), newlines become <br>.
 */
function cell(text) {
  return String(text)
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\|/g, "&#124;")
            .replace(/\*/g, "&#42;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\r?\n/g, "<br>"),
    )
    .join("");
}

/** JSON value as it would be written in a config, with a space after commas. */
function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${literal(v)}`);
    return `{ ${entries.join(", ")} }`;
  }
  return JSON.stringify(value);
}

const list = (items) =>
  items.length <= 1
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function table(header, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

/* ------------------------------------------------------------------------------------ */
/* The generator                                                                         */
/* ------------------------------------------------------------------------------------ */

/**
 * Render the reference for a parsed JSON Schema (defaults to v1.json on disk).
 * @param {Record<string, any>} [schema]
 * @returns {string} Markdown, LF line endings, trailing newline
 */
export function generateConfigReference(schema = readSchema()) {
  const defs = schema.definitions ?? {};
  const refName = ($ref) => {
    const m = /^#\/definitions\/([^/]+)$/.exec($ref);
    if (!m || !(m[1] in defs)) throw new Error(`config-reference: unresolvable $ref ${$ref}`);
    return m[1];
  };
  const schemaOf = (name) => (name === ROOT ? schema : defs[name]);
  const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /* Which definitions become sections: objects with keys, and oneOf dispatchers
     whose branches are all such objects. Everything else (string aliases like
     layerId, the legend union) is inlined where it is referenced. */
  const isObjectDef = (s) => !!s && typeof s.properties === "object";
  const isDispatch = (s) =>
    !!s &&
    !s.properties &&
    Array.isArray(s.oneOf) &&
    s.oneOf.length > 0 &&
    s.oneOf.every((b) => b.$ref && isObjectDef(defs[refName(b.$ref)]));
  const sectionNames = new Set([
    ROOT,
    ...Object.keys(defs).filter((n) => isObjectDef(defs[n]) || isDispatch(defs[n])),
  ]);

  /* the layer dispatch, its container branches (groups) and the keys its leaf
     branches share — those become the synthetic "Common layer keys" section */
  const dispatchNames = [...sectionNames].filter((n) => n !== ROOT && isDispatch(defs[n]));
  const layerBranches = dispatchNames.flatMap((n) => defs[n].oneOf.map((b) => refName(b.$ref)));
  const isContainer = (name, dispatch) =>
    Object.values(defs[name].properties).some(
      (p) => p.$ref === `#/definitions/${dispatch}` || p.items?.$ref === `#/definitions/${dispatch}`,
    );
  const containers = new Set();
  const leaves = [];
  for (const dispatch of dispatchNames) {
    for (const b of defs[dispatch].oneOf) {
      const name = refName(b.$ref);
      if (isContainer(name, dispatch)) containers.add(name);
      else leaves.push(name);
    }
  }
  const commonKeys =
    leaves.length > 1
      ? Object.keys(defs[leaves[0]].properties).filter((k) =>
          leaves.every(
            (l) => k in defs[l].properties && deepEqual(defs[l].properties[k], defs[leaves[0]].properties[k]),
          ),
        )
      : [];
  const hasCommon = commonKeys.length > 0;
  if (hasCommon) sectionNames.add(COMMON);

  /* titles and anchors, checked for collisions */
  const titleOf = (name) => {
    if (TITLES[name]) return TITLES[name];
    const s = schemaOf(name);
    const type = s?.properties?.type?.const;
    if (layerBranches.includes(name) && typeof type === "string") return `${code(type)} layer`;
    if (isObjectDef(s) && /^[a-z0-9]+$/.test(name)) return code(name);
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  };
  const anchors = new Map();
  for (const name of sectionNames) {
    const anchor = slug(titleOf(name));
    const clash = [...anchors].find(([, a]) => a === anchor);
    if (clash) throw new Error(`config-reference: "${name}" and "${clash[0]}" share the anchor #${anchor}`);
    anchors.set(name, anchor);
  }
  const link = (name) => `[${titleOf(name)}](#${anchors.get(name)})`;

  /* usage back-references: section → [{ from, key }] */
  const usedBy = new Map();
  const noteUse = (target, from, key) => {
    if (from === null || from === target) return;
    const arr = usedBy.get(target) ?? [];
    if (!arr.some((u) => u.from === from && u.key === key)) arr.push({ from, key });
    usedBy.set(target, arr);
  };

  /* -------------------------------- type rendering -------------------------------- */

  const num = (n) => String(n).replace("-", "−");
  const range = (s) => {
    const parts = [];
    if (s.minimum !== undefined && s.maximum !== undefined) {
      /* "0–24", but "−360 to 360": a minus next to an en dash is unreadable */
      parts.push(s.minimum < 0 ? `${num(s.minimum)} to ${num(s.maximum)}` : `${s.minimum}–${s.maximum}`);
    } else if (s.minimum !== undefined) parts.push(`≥ ${num(s.minimum)}`);
    else if (s.maximum !== undefined) parts.push(`≤ ${num(s.maximum)}`);
    if (s.minLength !== undefined && s.minLength > 0) parts.push("non-empty");
    if (s.pattern) parts.push(`pattern ${code(s.pattern.replace(/\|/g, "\\|"))}`); // GFM tables need pipes escaped even in code
    if (s.format) parts.push(s.format);
    return parts.length ? ` (${parts.join(", ")})` : "";
  };
  const count = (s) => {
    if (s.minItems !== undefined && s.minItems === s.maxItems) return ` (${s.minItems} items)`;
    const parts = [];
    if (s.minItems !== undefined) parts.push(`at least ${s.minItems}`);
    if (s.maxItems !== undefined) parts.push(`at most ${s.maxItems}`);
    return parts.length ? ` (${parts.join(", ")})` : "";
  };

  /** plain (code-span-safe) text for a schema, or null when it needs Markdown (links) */
  function plainType(s) {
    if (s.$ref) {
      const name = refName(s.$ref);
      return sectionNames.has(name) ? null : plainType(defs[name]);
    }
    if (s.const !== undefined) return JSON.stringify(s.const);
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" · ");
    if (s.oneOf || s.anyOf) {
      const parts = (s.oneOf ?? s.anyOf).map(plainType);
      return parts.includes(null) ? null : parts.join(" | ");
    }
    if (Array.isArray(s.items)) {
      const parts = s.items.map(plainType);
      return parts.includes(null) ? null : `[${parts.join(", ")}]`;
    }
    if (s.type === "array" || s.items) {
      const item = s.items ? plainType(s.items) : "any";
      return item === null ? null : /^[a-z]+$/.test(item) ? `${item}[]` : `(${item})[]`;
    }
    if (s.properties) return "object";
    if (s.additionalProperties && typeof s.additionalProperties === "object") {
      const value = plainType(s.additionalProperties);
      return value === null ? null : `{ "…": ${value} }`;
    }
    if (Array.isArray(s.type)) return s.type.join(" | ");
    return s.type ?? "any";
  }

  /**
   * Markdown for the type cell, plus the description/default inherited from an
   * inlined `$ref` target (a property `{ "$ref": "#/definitions/layerVisible" }`
   * carries no text of its own).
   * @returns {{ type: string, description?: string, default?: unknown }}
   */
  function render(s, from, key) {
    if (s.$ref) {
      const name = refName(s.$ref);
      noteUse(name, from, key);
      const target = defs[name];
      if (sectionNames.has(name)) return { type: link(name), description: target.description, default: target.default };
      const inner = render(target, from, key);
      return { type: inner.type, description: inner.description, default: inner.default };
    }
    if (s.const !== undefined) return { type: code(JSON.stringify(s.const)), description: s.description, default: s.default };
    if (s.enum) {
      return { type: s.enum.map((v) => code(JSON.stringify(v))).join(" · "), description: s.description, default: s.default };
    }
    if (s.oneOf || s.anyOf) {
      const branches = (s.oneOf ?? s.anyOf).map((b) => render(b, from, key));
      return {
        type: branches.map((b) => b.type).join(" or "),
        description: s.description ?? branches.find((b) => b.description)?.description,
        default: s.default ?? branches.find((b) => b.default !== undefined)?.default,
      };
    }
    if (Array.isArray(s.items)) {
      const plain = plainType(s);
      const type = plain !== null ? code(plain) : `[${s.items.map((i) => render(i, from, key).type).join(", ")}]`;
      const fixed = s.minItems === s.items.length && s.maxItems === s.items.length; // the tuple says it already
      return { type: fixed ? type : type + count(s), description: s.description, default: s.default };
    }
    if (s.type === "array" || s.items) {
      const plain = plainType(s);
      let type;
      if (plain !== null && /^[a-z]+\[\]$/.test(plain)) type = code(plain) + range(s.items ?? {});
      else if (s.items) type = `array of ${render(s.items, from, key).type}`;
      else type = code("any[]");
      return { type: type + count(s), description: s.description, default: s.default };
    }
    if (s.type === "object" || s.properties || s.additionalProperties) {
      const plain = plainType(s);
      const type =
        plain !== null && plain !== "object"
          ? code(plain)
          : s.additionalProperties && typeof s.additionalProperties === "object"
            ? `object of ${render(s.additionalProperties, from, key).type}`
            : code("object");
      return { type, description: s.description, default: s.default };
    }
    if (Array.isArray(s.type)) return { type: s.type.map(code).join(" or "), description: s.description, default: s.default };
    return { type: code(s.type ?? "any") + range(s), description: s.description, default: s.default };
  }

  /* --------------------------- conditional keys (if/then/else) --------------------------- */

  const condition = (cond) => {
    const parts = Object.entries(cond?.properties ?? {})
      .filter(([, v]) => v.const !== undefined)
      .map(([k, v]) => `${code(k)} is ${code(JSON.stringify(v.const))}`);
    if (!parts.length) for (const k of cond?.required ?? []) parts.push(`${code(k)} is set`);
    return parts.join(" and ");
  };
  const forbidden = (branch) => {
    const not = branch?.not;
    if (!not) return [];
    const clauses = not.anyOf ?? not.allOf ?? not.oneOf ?? [not];
    return clauses.flatMap((c) => c.required ?? []);
  };

  /**
   * @returns {{ conditional: Map<string, string>, notes: string[] }} per-key
   * required-ness text and object-level notes
   */
  function conditionals(s) {
    const conditional = new Map();
    const notes = [];
    if (s.if) {
      const cond = condition(s.if);
      for (const k of s.then?.required ?? []) conditional.set(k, `required when ${cond}`);
      for (const k of s.else?.required ?? []) conditional.set(k, `required unless ${cond}`);
      const thenNot = forbidden(s.then);
      if (thenNot.length) notes.push(`When ${cond}, ${list(thenNot.map(code))} cannot be set.`);
      const elseNot = forbidden(s.else);
      if (elseNot.length) notes.push(`Unless ${cond}, ${list(elseNot.map(code))} cannot be set.`);
    }
    if (Array.isArray(s.oneOf) && s.properties && s.oneOf.every((b) => Array.isArray(b.required))) {
      const sets = s.oneOf.map((b) => b.required.map(code).join(" + "));
      notes.push(`Exactly one of these must be set: ${sets.join(" · ")}.`);
    }
    if (s.additionalProperties === undefined || s.additionalProperties === true) {
      notes.push("Other keys are allowed here (not checked by the schema).");
    } else if (typeof s.additionalProperties === "object") {
      notes.push(`Other keys are allowed here; their values are ${render(s.additionalProperties, null, null).type}.`);
    }
    return { conditional, notes };
  }

  /* ----------------------------------- sections ----------------------------------- */

  /**
   * Table rows for an object's properties; inline objects and arrays of inline
   * objects produce nested rows (`parent.child`, `parent[].child`).
   */
  function rows(s, from, prefix = "", omit = new Set()) {
    const required = new Set(s.required ?? []);
    const { conditional } = conditionals(s);
    const out = [];
    for (const [key, prop] of Object.entries(s.properties ?? {})) {
      if (omit.has(key)) continue;
      const path = prefix + key;
      const r = render(prop, from, key);
      let req;
      if (required.has(key)) req = "**required**";
      else if (conditional.has(key)) req = conditional.get(key);
      else if (r.default !== undefined) req = code(literal(r.default));
      else req = "—";
      const description = r.description ?? "";
      out.push([code(path), r.type, req, cell(description)]);
      /* nested inline objects */
      const inline = prop.properties ? prop : prop.items?.properties ? prop.items : undefined;
      if (inline) out.push(...rows(inline, from, prop.properties ? `${path}.` : `${path}[].`));
    }
    return out;
  }

  const KEY_HEADER = ["Key", "Type", "Required · default", "Description"];

  /** @returns {string[]} Markdown blocks for one section (heading excluded) */
  function sectionBody(name) {
    const blocks = [];
    if (name === COMMON) {
      const others = [...containers].map((c) => code(defs[c].properties.type?.const ?? c));
      blocks.push(
        `Keys every layer type accepts${others.length ? ` (except ${list(others)}, which is a container node)` : ""}. ` +
          "The per-type sections below list only what comes on top.",
      );
      const first = defs[leaves[0]];
      const subset = { ...first, properties: Object.fromEntries(commonKeys.map((k) => [k, first.properties[k]])), required: [] };
      blocks.push(table(KEY_HEADER, rows(subset, COMMON)));
      return blocks;
    }
    const s = schemaOf(name);
    if (s.description && name !== ROOT) blocks.push(cell(s.description).replace(/<br>/g, "\n")); // the root's is in the intro
    if (isDispatch(s)) {
      const branches = s.oneOf.map((b) => refName(b.$ref));
      const discriminator = Object.keys(defs[branches[0]].properties).find((k) =>
        branches.every((b) => defs[b].properties[k]?.const !== undefined),
      );
      blocks.push(
        table(
          [discriminator ? code(discriminator) : "Variant", "Section", "Description"],
          branches.map((b) => [
            discriminator ? code(JSON.stringify(defs[b].properties[discriminator].const)) : "",
            link(b),
            cell(defs[b].description ?? ""),
          ]),
        ),
      );
      return blocks;
    }
    const isLeaf = hasCommon && leaves.includes(name);
    if (isLeaf) blocks.push(`All ${link(COMMON)} apply. Specific to this type:`);
    const omit = new Set(isLeaf ? commonKeys : []);
    const body = rows(s, name, "", omit);
    if (body.length) blocks.push(table(KEY_HEADER, body));
    const { notes } = conditionals(s);
    for (const note of notes) blocks.push(note);
    return blocks;
  }

  /* section order: the groups above, then anything unlisted under "Other" */
  const placed = new Set();
  const groups = [];
  for (const g of GROUPS) {
    const sections = [];
    for (const n of g.sections.flatMap((n) => (n === LAYER_TYPES ? layerBranches : [n]))) {
      if (!sectionNames.has(n) || placed.has(n)) continue;
      placed.add(n);
      sections.push(n);
    }
    if (sections.length) groups.push({ title: g.title, sections });
  }
  const other = [...sectionNames].filter((n) => !placed.has(n));
  if (other.length) groups.push({ title: "Other", sections: other });

  /* render every section body first — that is what fills the usage map */
  const bodies = new Map(groups.flatMap((g) => g.sections.map((n) => [n, sectionBody(n)])));

  /* every definition must have made it onto the page, one way or the other */
  for (const name of Object.keys(defs)) {
    if (!sectionNames.has(name) && !usedBy.has(name)) {
      throw new Error(`config-reference: definition "${name}" is neither a section nor referenced — it would be lost`);
    }
  }

  /* ------------------------------------ page ------------------------------------ */

  const out = [];
  out.push(`# ${schema.title ?? "Config"} reference`);
  out.push(
    "<!-- GENERATED FILE — do not edit. Source: packages/schema/v1.json; generator: scripts/config-reference.mjs; regenerate with `pnpm docs:reference`. -->",
  );
  out.push(
    "> Generated from [`packages/schema/v1.json`](../packages/schema/v1.json) by " +
      "`scripts/config-reference.mjs` — **do not edit this file**. Improve a text in the schema's " +
      "`description`, then run `pnpm docs:reference`; `config-reference.test.ts` fails while this " +
      "page is stale. The concept, an annotated example and the layer-type matrix are in " +
      "[04-configuration.md](04-configuration.md).",
  );
  if (schema.description) out.push(cell(schema.description).replace(/<br>/g, "\n"));
  const version = schema.properties?.version?.const;
  out.push(
    [
      `Schema: \`${schema.$id ?? "v1.json"}\`${version !== undefined ? ` · config format version ${version}` : ""}.`,
      "Every key is optional unless marked **required**; the third column shows the default a missing key gets.",
      "Objects reject unknown keys in the schema (that is the editor squiggle) — the runtime validator only warns about them, so a config written for a newer map0 still opens.",
      "The schema checks structure; the runtime validator additionally enforces the https-URL policy, id uniqueness and cross-field rules.",
      "Types read as follows: `T[]` and \"array of X\" are arrays, `a` or `b` accepts either shape, `\"a\"` · `\"b\"` is one of the listed values, `{ \"…\": T }` is an object with arbitrary keys and `T` values.",
    ].join("\n"),
  );

  out.push("## Contents");
  out.push(
    groups
      .map((g) => [`- ${g.title}`, ...g.sections.map((n) => `  - ${link(n)}`)].join("\n"))
      .join("\n"),
  );

  for (const g of groups) {
    for (const name of g.sections) {
      out.push(`## ${titleOf(name)}`);
      const uses = usedBy.get(name);
      if (uses?.length) {
        out.push(`Used by: ${uses.map((u) => `${link(u.from)} ${code(u.key)}`).join(" · ")}`);
      }
      out.push(...bodies.get(name));
    }
  }

  return out.join("\n\n") + "\n";
}

function readSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
}

/** the committed page, LF-normalised (the repo stores LF; a stray CRLF checkout is not staleness) */
export function readCommitted() {
  try {
    return readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}

function main() {
  const markdown = generateConfigReference();
  const rel = relative(root, OUTPUT_PATH).replace(/\\/g, "/");
  if (process.argv.includes("--check")) {
    if (readCommitted() === markdown) {
      console.log(`  ${rel} is up to date`);
      return;
    }
    console.error(`✗ ${rel} is stale — run pnpm docs:reference`);
    process.exit(1);
  }
  if (readCommitted() === markdown) {
    console.log(`  ${rel}: unchanged`);
    return;
  }
  writeFileSync(OUTPUT_PATH, markdown);
  console.log(`  ${rel}: written`);
}

/* CLI only when run directly — the freshness test imports generateConfigReference() */
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
