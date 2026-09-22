import { describe, expect, it } from "vitest";
import {
  MERC_MAX,
  chooseZoom,
  firstCoordinate,
  isWgs84Crs,
  lonLatBbox,
  lonLatToTile,
  looksAxisSwapped,
  tileBbox3857,
  unionBbox,
  wmtsTileIndex,
} from "./geo.js";

describe("CRS spelling", () => {
  it("isWgs84Crs covers EPSG:4326 URNs and CRS84 URIs", () => {
    for (const c of ["EPSG:4326", "urn:ogc:def:crs:EPSG::4326", "CRS:84", "http://www.opengis.net/def/crs/OGC/1.3/CRS84"]) {
      expect(isWgs84Crs(c), c).toBe(true);
    }
    expect(isWgs84Crs("EPSG:31256")).toBe(false);
    expect(isWgs84Crs("EPSG:43260")).toBe(false);
  });
});

describe("tile arithmetic", () => {
  it("finds the XYZ tile and its EPSG:3857 extent", () => {
    expect(lonLatToTile([0, 0], 1)).toEqual({ x: 1, y: 1 });
    expect(lonLatToTile([13.35, 47.6], 8)).toEqual({ x: 137, y: 89 });
    expect(tileBbox3857(0, 0, 0)).toEqual([-MERC_MAX, -MERC_MAX, MERC_MAX, MERC_MAX]);
    const nw = tileBbox3857(1, 0, 0);
    expect(nw[0]).toBe(-MERC_MAX);
    expect(nw[2]).toBe(0);
    expect(nw[1]).toBe(0);
    expect(nw[3]).toBe(MERC_MAX);
  });

  it("wmtsTileIndex finds the Austrian centre at level 7 and tolerates a swapped TopLeftCorner", () => {
    const tm = {
      identifier: "7",
      scaleDenominator: 559082264.028 / 128,
      topLeft: [-MERC_MAX, MERC_MAX] as [number, number],
      tileWidth: 256,
      tileHeight: 256,
      matrixWidth: 128,
      matrixHeight: 128,
    };
    expect(wmtsTileIndex([13.35, 47.6], tm)).toEqual({ col: 68, row: 44 });
    expect(wmtsTileIndex([13.35, 47.6], { ...tm, topLeft: [MERC_MAX, -MERC_MAX] })).toEqual({ col: 68, row: 44 });
  });

  it("chooseZoom stays inside the layer's range", () => {
    expect(chooseZoom(12, undefined, 8)).toBe(12);
    expect(chooseZoom(undefined, 5, 8)).toBe(5);
    expect(chooseZoom(undefined, undefined, 8)).toBe(8);
  });
});

describe("bounds", () => {
  it("lonLatBbox coerces ogc-client's string numbers and rejects what is not WGS84", () => {
    expect(lonLatBbox(["16.18", "48.12", "16.55", "48.32"])).toEqual([16.18, 48.12, 16.55, 48.32]);
    expect(lonLatBbox([16.18, 48.12, 16.55, 48.32])).toEqual([16.18, 48.12, 16.55, 48.32]);
    expect(lonLatBbox([1, 2, 3])).toBeUndefined();
    expect(lonLatBbox([-11009, 331584, 15824, 353191])).toBeUndefined(); // EPSG:31256 metres
    expect(lonLatBbox(["a", "b", "c", "d"])).toBeUndefined();
    expect(lonLatBbox(undefined)).toBeUndefined();
  });

  it("unionBbox skips unusable boxes", () => {
    expect(unionBbox([[16, 48, 17, 49], undefined, [15, 47.5, 16.5, 48.5]])).toEqual([15, 47.5, 17, 49]);
    expect(unionBbox([undefined])).toBeUndefined();
  });
});

describe("axis order", () => {
  const vienna: [number, number, number, number] = [16.1, 48.1, 16.6, 48.4];

  it("looksAxisSwapped spots lat/lon answers", () => {
    expect(looksAxisSwapped([48.2, 16.3], vienna)).toBe(true);
    expect(looksAxisSwapped([16.3, 48.2], vienna)).toBe(false);
    expect(looksAxisSwapped([0, 0], vienna)).toBe(false);
  });

  it("firstCoordinate digs into any geometry", () => {
    expect(firstCoordinate({ type: "Point", coordinates: [16.3, 48.2] })).toEqual([16.3, 48.2]);
    expect(firstCoordinate({ type: "MultiPolygon", coordinates: [[[[1, 2], [3, 4], [5, 6], [1, 2]]]] })).toEqual([1, 2]);
    expect(firstCoordinate({ type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [7, 8] }] })).toEqual([7, 8]);
    expect(firstCoordinate(null)).toBeUndefined();
    expect(firstCoordinate({ type: "Point", coordinates: [] })).toBeUndefined();
  });
});
