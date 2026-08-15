/**
 * Modal focus management (N4/WCAG 2.1 AA): while a dialog is open, Tab must not
 * wander into the page behind it, Escape must close it, and closing must return
 * focus to whatever opened it.
 *
 * The dialogs live inside the viewer's shadow root, so the currently focused node
 * is read from that root — `document.activeElement` only ever reports the host.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function activeIn(node: Node): Element | null {
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.activeElement : document.activeElement;
}

/** Trap focus inside `container` until the returned dispose function is called. */
export function trapFocus(container: HTMLElement, onEscape: () => void): () => void {
  const restoreTo = activeIn(container);

  const focusable = (): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
    );

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const current = activeIn(container);
    if (event.shiftKey && (current === first || !container.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", onKeydown);
  /* let Lit finish its first render before reaching for a field */
  queueMicrotask(() => focusable()[0]?.focus());

  return () => {
    container.removeEventListener("keydown", onKeydown);
    if (restoreTo instanceof HTMLElement) restoreTo.focus();
  };
}
