/**
 * Layer-tree helpers shared by normalization, the core and the layer panel:
 * which layers a node holds, and what an exclusive (radio) group implies (F2.3).
 *
 * They live in the schema package because it is the one module both the core
 * and the element may import values from (docs/09 §2, invariant 1) — but they
 * are panel semantics, not config schema, so they stay out of the package's
 * index and the published declarations: `@map0/schema/toc` is a workspace-only
 * subpath (package.json "exports", plus the aliases in vitest.config.ts and
 * site/vite.config.ts).
 */
import type { TocNode } from "./defaults.js";

/** ids of every layer below a node, in tree order */
export function tocLeafIds(node: TocNode): string[] {
  return node.kind === "layer" ? [node.layerId] : node.children.flatMap(tocLeafIds);
}

/**
 * For every layer inside an exclusive group: the layers that go dark when it is
 * switched on — the layers of the group's other children. A child group counts
 * as one option; exclusive groups nested in it add their own rivals.
 */
export function exclusiveRivals(toc: readonly TocNode[]): Map<string, string[]> {
  const rivals = new Map<string, string[]>();
  const visit = (nodes: readonly TocNode[]): void => {
    for (const node of nodes) {
      if (node.kind !== "group") continue;
      if (node.exclusive) {
        const options = node.children.map(tocLeafIds);
        options.forEach((ids, i) => {
          const others = options.filter((_, j) => j !== i).flat();
          for (const id of ids) rivals.set(id, [...(rivals.get(id) ?? []), ...others]);
        });
      }
      visit(node.children);
    }
  };
  visit(toc);
  return rivals;
}

export type TocVisibility = "on" | "off" | "mixed";

/** how much of a node is switched on — the state of a group's toggle-all box */
export function tocVisibility(node: TocNode, isVisible: (id: string) => boolean): TocVisibility {
  if (node.kind === "layer") return isVisible(node.layerId) ? "on" : "off";
  const states = node.children.map((c) => tocVisibility(c, isVisible));
  if (node.exclusive) {
    const lit = states.filter((s) => s !== "off");
    if (lit.length === 0) return "off";
    return lit.length === 1 && lit[0] === "on" ? "on" : "mixed";
  }
  if (states.length > 0 && states.every((s) => s === "on")) return "on";
  return states.every((s) => s === "off") ? "off" : "mixed";
}

/**
 * The layers "switch the group on" stands for: all of a plain group, one option
 * of an exclusive group — the one that is already (partly) on, else the first.
 */
export function tocShowIds(node: TocNode, isVisible: (id: string) => boolean): string[] {
  if (node.kind === "layer") return [node.layerId];
  if (node.exclusive) {
    const chosen =
      node.children.find((c) => tocVisibility(c, isVisible) !== "off") ?? node.children[0];
    return chosen ? tocShowIds(chosen, isVisible) : [];
  }
  return node.children.flatMap((c) => tocShowIds(c, isVisible));
}
