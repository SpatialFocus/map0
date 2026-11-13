/**
 * Vector-tile fixtures for the unit tests and the browser smoke test: a Mapbox
 * Vector Tile encoder and a PMTiles v3 writer — just enough of each to build
 * the tiles and archives map0 reads back. Plain JS, so `e2e/smoke.mjs` can use
 * it under Node without a build step.
 */
import { PbfWriter } from "pbf";
import { zxyToTileId } from "pmtiles";

/**
 * @typedef {string | number | boolean} TileValue
 * @typedef {object} FeatureSpec
 * @property {number} [id]
 * @property {1 | 2 | 3} type point, line, polygon
 * @property {Record<string, TileValue>} [properties]
 * @property {Array<Array<[number, number]>>} rings tile coordinates (0 … extent, y down);
 *   polygon rings open (ClosePath closes them), points all in the first ring
 * @typedef {{ name: string, extent?: number, features: FeatureSpec[] }} LayerSpec
 */

/** encode one Mapbox Vector Tile (spec 2.1) */
export function encodeMvt(/** @type {LayerSpec[]} */ layers) {
  const pbf = new PbfWriter();
  for (const layer of layers) pbf.writeMessage(3, writeLayer, layer);
  return pbf.finish();
}

/** a square polygon over a whole tile — its geometry decodes to exactly the tile's bounds */
export const wholeTile = (extent = 4096) => [[[0, 0], [extent, 0], [extent, extent], [0, extent]]];

function writeLayer(/** @type {LayerSpec} */ layer, /** @type {PbfWriter} */ pbf) {
  /** @type {string[]} */ const keys = [];
  /** @type {TileValue[]} */ const values = [];
  const indexOf = (list, value) => {
    let i = list.indexOf(value);
    if (i < 0) i = list.push(value) - 1;
    return i;
  };
  pbf.writeVarintField(15, 2);
  pbf.writeStringField(1, layer.name);
  for (const feature of layer.features) {
    pbf.writeMessage(2, writeFeature, {
      feature,
      tags: Object.entries(feature.properties ?? {}).flatMap(([k, v]) => [indexOf(keys, k), indexOf(values, v)]),
    });
  }
  for (const key of keys) pbf.writeStringField(3, key);
  for (const value of values) pbf.writeMessage(4, writeValue, value);
  pbf.writeVarintField(5, layer.extent ?? 4096);
}

function writeFeature({ feature, tags }, /** @type {PbfWriter} */ pbf) {
  if (feature.id !== undefined) pbf.writeVarintField(1, feature.id);
  pbf.writePackedVarint(2, tags);
  pbf.writeVarintField(3, feature.type);
  pbf.writePackedVarint(4, encodeGeometry(feature.type, feature.rings));
}

function writeValue(/** @type {TileValue} */ value, /** @type {PbfWriter} */ pbf) {
  if (typeof value === "string") pbf.writeStringField(1, value);
  else if (typeof value === "boolean") pbf.writeBooleanField(7, value);
  else if (!Number.isInteger(value)) pbf.writeDoubleField(3, value);
  else if (value >= 0) pbf.writeVarintField(5, value);
  else pbf.writeSVarintField(6, value);
}

const zigzag = (n) => (n << 1) ^ (n >> 31);
const command = (id, count) => (id & 7) | (count << 3);

function encodeGeometry(type, rings) {
  const out = [];
  let cx = 0;
  let cy = 0;
  const moveBy = ([x, y]) => {
    out.push(zigzag(x - cx), zigzag(y - cy));
    cx = x;
    cy = y;
  };
  if (type === 1) {
    out.push(command(1, rings[0].length));
    rings[0].forEach(moveBy);
    return out;
  }
  for (const ring of rings) {
    out.push(command(1, 1));
    moveBy(ring[0]);
    out.push(command(2, ring.length - 1));
    ring.slice(1).forEach(moveBy);
    if (type === 3) out.push(command(7, 1));
  }
  return out;
}

/**
 * A PMTiles v3 archive: one root directory, nothing compressed.
 * @param {Record<string, Uint8Array>} tiles keyed "z/x/y"
 * @param {{ minZoom: number, maxZoom: number, tileType?: number }} meta tileType 1 = MVT
 */
export function writePmtiles(tiles, { minZoom, maxZoom, tileType = 1 }) {
  const entries = Object.entries(tiles)
    .map(([key, data]) => {
      const [z, x, y] = key.split("/").map(Number);
      return { tileId: zxyToTileId(z, x, y), data };
    })
    .sort((a, b) => a.tileId - b.tileId);
  let dataLength = 0;
  const placed = entries.map((e) => {
    const entry = { tileId: e.tileId, offset: dataLength, length: e.data.length, runLength: 1 };
    dataLength += e.data.length;
    return entry;
  });
  const directory = serializeDirectory(placed);
  const metadata = new TextEncoder().encode("{}");

  const HEADER = 127;
  const metadataOffset = HEADER + directory.length;
  const dataOffset = metadataOffset + metadata.length;
  const archive = new Uint8Array(dataOffset + dataLength);
  const view = new DataView(archive.buffer);
  const u64 = (at, value) => view.setBigUint64(at, BigInt(value), true);
  archive.set(new TextEncoder().encode("PMTiles"), 0);
  archive[7] = 3;
  u64(8, HEADER); // root directory
  u64(16, directory.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, dataOffset); // leaf directories: none
  u64(48, 0);
  u64(56, dataOffset);
  u64(64, dataLength);
  u64(72, entries.length); // addressed tiles
  u64(80, entries.length); // tile entries
  u64(88, entries.length); // tile contents
  archive[96] = 1; // clustered
  archive[97] = 1; // internal compression: none
  archive[98] = 1; // tile compression: none
  archive[99] = tileType;
  archive[100] = minZoom;
  archive[101] = maxZoom;
  view.setInt32(102, -180e7, true);
  view.setInt32(106, -85e7, true);
  view.setInt32(110, 180e7, true);
  view.setInt32(114, 85e7, true);
  archive[118] = minZoom;
  archive.set(directory, HEADER);
  archive.set(metadata, metadataOffset);
  entries.forEach((e, i) => archive.set(e.data, dataOffset + placed[i].offset));
  return archive;
}

function serializeDirectory(entries) {
  const out = [];
  const varint = (n) => {
    while (n >= 0x80) {
      out.push((n % 0x80) | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  };
  varint(entries.length);
  let last = 0;
  for (const e of entries) {
    varint(e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(e.runLength);
  for (const e of entries) varint(e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return Uint8Array.from(out);
}

/**
 * Answer an HTTP Range request from an in-memory archive the way a static file
 * server does: 206 with the slice, Content-Range, Content-Length.
 * @returns {{ status: number, headers: Record<string, string>, body: Uint8Array }}
 */
export function rangeResponse(/** @type {Uint8Array} */ archive, /** @type {string | null} */ range) {
  const match = /bytes=(\d+)-(\d+)?/.exec(range ?? "");
  if (!match) {
    return { status: 200, headers: { "content-length": String(archive.length) }, body: archive };
  }
  const start = Number(match[1]);
  const end = Math.min(match[2] === undefined ? archive.length - 1 : Number(match[2]), archive.length - 1);
  const body = archive.slice(start, end + 1);
  return {
    status: 206,
    headers: {
      "content-range": `bytes ${start}-${end}/${archive.length}`,
      "content-length": String(body.length),
      "accept-ranges": "bytes",
    },
    body,
  };
}
