/**
 * What the section renderers see of the element: the current config, the
 * translator, and the handful of state transitions they trigger. An interface
 * rather than the class, so the sections do not know about Lit's update cycle
 * and the class cannot leak internals into them by accident.
 */
import type { Map0Config } from "@map0/schema";
import type { ServiceKind, ServiceProbe, UrlLayerType } from "./services.js";
import type { LayerPath } from "./state.js";
import type { SampleFeature } from "./style-presets.js";

export type Lang = "en" | "de";

export type T = (key: string, vars?: Record<string, string | number>) => string;

export type SectionId =
  | "general"
  | "basemaps"
  | "layers"
  | "controls"
  | "search"
  | "print"
  | "theme"
  | "export";

export const SECTIONS: SectionId[] = [
  "general",
  "basemaps",
  "layers",
  "controls",
  "search",
  "print",
  "theme",
  "export",
];

export type AddPanel = "service" | "url" | null;

export interface AddServiceState {
  kind: ServiceKind;
  url: string;
  loading: boolean;
  error: string;
  probe: ServiceProbe | null;
  /** candidate names ticked for adding */
  selected: ReadonlySet<string>;
  filter: string;
}

export interface AddUrlState {
  type: UrlLayerType;
  url: string;
  title: string;
  error: string;
}

export type DropPosition = "before" | "after" | "into";

/** the tree's drag-and-drop in flight: what is dragged, and where it would land */
export interface DragState {
  from: LayerPath | null;
  over: LayerPath | null;
  position: DropPosition | null;
}

export const NO_DRAG: DragState = { from: null, over: null, position: null };

export interface View {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

export interface Host {
  readonly cfg: Map0Config;
  readonly t: T;

  /** replace the config (recorded for undo, validated, previewed) */
  commit(next: Map0Config): void;
  /** patch one top-level object key; return undefined to remove the key */
  patchTop<K extends keyof Map0Config>(
    key: K,
    fn: (current: NonNullable<Map0Config[K]> | undefined) => Map0Config[K] | undefined,
  ): void;

  /* layers */
  readonly selectedPath: LayerPath | null;
  selectLayer(path: LayerPath | null): void;
  readonly addPanel: AddPanel;
  setAddPanel(panel: AddPanel): void;
  readonly addService: AddServiceState;
  setAddService(patch: Partial<AddServiceState>): void;
  loadService(): void;
  addSelectedCandidates(): void;
  readonly addUrl: AddUrlState;
  setAddUrl(patch: Partial<AddUrlState>): void;
  addUrlLayer(): void;
  addGroup(): void;
  readonly drag: DragState;
  setDrag(state: DragState): void;
  /** drop the dragged node at `index` of the list `parent` addresses */
  dropLayer(parent: LayerPath, index: number): void;
  /** features of a layer as the preview has them loaded — null while the map is not ready */
  sampleFeatures(path: LayerPath): SampleFeature[] | null;

  /* basemaps */
  readonly selectedBasemap: number | null;
  selectBasemap(index: number | null): void;

  /* preview */
  currentView(): View | null;

  /** a short transient message in the status bar (copied, parse error …) */
  notify(message: string): void;
}
