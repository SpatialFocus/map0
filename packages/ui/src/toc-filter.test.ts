import { describe, expect, it } from "vitest";
import { filterTerms, highlightSegments, matchesAll, unmatchedTerms } from "./toc-filter.js";

describe("layer filter (F2.7)", () => {
  it("splits and folds the query", () => {
    expect(filterTerms("  Lärm  STRASSE ")).toEqual(["larm", "strasse"]);
    expect(filterTerms("")).toEqual([]);
  });

  it("matches without case, accents or ß", () => {
    expect(matchesAll("Straßenlärm 2024", filterTerms("strassen lar"))).toBe(true);
    expect(matchesAll("Straßenlärm 2024", filterTerms("Lärm"))).toBe(true);
    expect(matchesAll("Straßenlärm 2024", filterTerms("lärm bahn"))).toBe(false);
    expect(matchesAll("anything", [])).toBe(true);
  });

  it("leaves the terms a group title does not cover to its children", () => {
    expect(unmatchedTerms("Umwelt", filterTerms("umwelt lärm"))).toEqual(["larm"]);
  });

  it("highlights the source characters, also where folding changed the length", () => {
    expect(highlightSegments("Straßenlärm", filterTerms("strasse"))).toEqual([
      { text: "Straße", hit: true },
      { text: "nlärm", hit: false },
    ]);
    expect(highlightSegments("Lärm und Lärmschutz", filterTerms("larm"))).toEqual([
      { text: "Lärm", hit: true },
      { text: " und ", hit: false },
      { text: "Lärm", hit: true },
      { text: "schutz", hit: false },
    ]);
    expect(highlightSegments("Parks", [])).toEqual([{ text: "Parks", hit: false }]);
  });

  it("merges overlapping hits", () => {
    expect(highlightSegments("Waterways", filterTerms("water terw"))).toEqual([
      { text: "Waterw", hit: true },
      { text: "ays", hit: false },
    ]);
  });
});
