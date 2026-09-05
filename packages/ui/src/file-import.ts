/**
 * Local feature files → geojson layers (F3.2): the pipeline behind the drop
 * zone and the dialog's file picker. Reads each File, hands its text to the
 * core's parser, adds one layer per file and fits the map to what arrived.
 * Loaded on first use, together with the parser it pulls in.
 */
import { loadGeoFile, type Map0Core, type Translate } from "@map0/core";
import type { GeoJsonLayerDef } from "@map0/schema";

export interface ImportOutcome {
  /** ids of the layers added, in file order */
  added: string[];
  /** one user-facing message per file that could not be added */
  errors: string[];
}

export async function importGeoFiles(
  core: Map0Core,
  files: readonly File[],
  t: Translate,
): Promise<ImportOutcome> {
  const geo = await loadGeoFile();
  const outcome: ImportOutcome = { added: [], errors: [] };
  for (const file of files) {
    const fail = (why: string): void => {
      outcome.errors.push(`${t("addLayer.fileFailed")}: ${why}`);
    };
    try {
      /* the extension says nothing (.xml, .txt, none): look at the first bytes
         before reading the whole thing — a dropped video should not be read
         into memory to find out it is not KML */
      if (!geo.formatFromFileName(file.name)) {
        const head = await file.slice(0, geo.SNIFF_BYTES).text();
        if (!geo.sniffGeoFormat(file.name, head)) {
          fail(`${file.name}: ${t("addLayer.notGeoFile")}`);
          continue;
        }
      }
      const data = await geo.parseGeoFile(file.name, await file.text());
      if (data.features.length === 0) {
        fail(`${file.name}: ${t("addLayer.noFeatures")}`);
        continue;
      }
      const style = geo.simpleStyleFor(data, core.config.theme.primary);
      const def: GeoJsonLayerDef = {
        type: "geojson",
        title: geo.titleFromFileName(file.name),
        data,
        ...(style ? { style } : {}),
      };
      /* null = the adapter refused it (an unresolvable crs, say) — it has logged why */
      const id = await core.addLayer(def);
      if (!id) {
        fail(`${file.name}: ${t("layers.error")}`);
        continue;
      }
      outcome.added.push(id);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }
  await fitToLayers(core, outcome.added);
  return outcome;
}

/** fit the map to everything that was just added — one file or a whole drop */
async function fitToLayers(core: Map0Core, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length === 1) {
    await core.zoomToLayer(ids[0]!);
    return;
  }
  let union: [number, number, number, number] | null = null;
  for (const id of ids) {
    const b = await core.layers.all.find((a) => a.def.id === id)?.bounds();
    if (!b) continue;
    union = union
      ? [
          Math.min(union[0], b[0]),
          Math.min(union[1], b[1]),
          Math.max(union[2], b[2]),
          Math.max(union[3], b[3]),
        ]
      : b;
  }
  if (union) core.map.fitBounds(union, { padding: 40, maxZoom: 17 });
}
