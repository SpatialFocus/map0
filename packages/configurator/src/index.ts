import { Map0Configurator } from "./configurator.js";

/** Register `<map0-configurator>`; a no-op on a second call or without a DOM. */
export function defineMap0Configurator(tag = "map0-configurator"): void {
  if (typeof customElements === "undefined" || customElements.get(tag)) return;
  customElements.define(tag, Map0Configurator);
}

defineMap0Configurator();

export { Map0Configurator };
export type { Lang, SectionId } from "./host.js";
export {
  BASEMAP_PRESETS,
  BLANK_CONFIG,
  STARTER_CONFIG,
  cleanConfig,
  embedSnippet,
  playgroundUrl,
  serializeConfig,
} from "./state.js";
export { probeService, candidateToLayer, urlLayer, type ServiceCandidate, type ServiceKind, type ServiceProbe } from "./services.js";
