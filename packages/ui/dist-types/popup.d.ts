import { type FeatureInfoResult, type Translate } from "@map0/core";
/**
 * Render feature-info results into a sanitized DOM node for the MapLibre popup.
 * Everything passes DOMPurify — templates come from CMS configs, HTML may come
 * from third-party WMS GetFeatureInfo responses (N6 in docs/03-requirements.md).
 */
export declare function buildPopupContent(results: FeatureInfoResult[], t: Translate): HTMLElement;
//# sourceMappingURL=popup.d.ts.map