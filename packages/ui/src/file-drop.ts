/**
 * Drop zone for local feature files (F3.2). Listens on the host element, so a
 * drag anywhere over the viewer — map canvas, panels, the overlay itself —
 * counts, and nothing in the shadow tree needs listeners of its own.
 *
 * `dragenter`/`dragleave` fire for every element the pointer crosses, in
 * enter-then-leave order, so a depth counter tells "left the viewer" from
 * "moved onto a child". A watchdog on `dragover` — which keeps firing while
 * the drag hovers — covers the one case the counter cannot: a drag that ends
 * outside the window without a final `dragleave`.
 *
 * Deliberately free of imports: the viewer loads this with the page tier.
 */
export interface DropZoneHandlers {
  /** false → the drag is not ours (no map yet, `allowAdd` off): browser default, no overlay */
  accepts: () => boolean;
  onActive: (active: boolean) => void;
  onFiles: (files: File[]) => void;
}

/** browsers repeat `dragover` every ~350 ms while a drag hovers in place */
const WATCHDOG_MS = 800;

export function attachDropZone(host: HTMLElement, handlers: DropZoneHandlers): () => void {
  let depth = 0;
  let active = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const setActive = (next: boolean): void => {
    if (next === active) return;
    active = next;
    handlers.onActive(next);
  };
  const reset = (): void => {
    depth = 0;
    clearTimeout(watchdog);
    setActive(false);
  };
  /* text or links dragged from another window are not ours either */
  const ours = (e: DragEvent): boolean =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files") && handlers.accepts();

  const onEnter = (e: DragEvent): void => {
    if (!ours(e)) return;
    e.preventDefault();
    depth++;
    setActive(true);
  };
  const onOver = (e: DragEvent): void => {
    if (!ours(e)) return;
    e.preventDefault(); // without this the browser refuses the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    setActive(true);
    clearTimeout(watchdog);
    watchdog = setTimeout(reset, WATCHDOG_MS);
  };
  const onLeave = (): void => {
    if (!active) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) reset();
  };
  const onDrop = (e: DragEvent): void => {
    if (!ours(e)) return;
    e.preventDefault(); // …or the browser navigates to the file
    const files = Array.from(e.dataTransfer?.files ?? []);
    reset();
    if (files.length > 0) handlers.onFiles(files);
  };

  host.addEventListener("dragenter", onEnter);
  host.addEventListener("dragover", onOver);
  host.addEventListener("dragleave", onLeave);
  host.addEventListener("drop", onDrop);
  return () => {
    reset();
    host.removeEventListener("dragenter", onEnter);
    host.removeEventListener("dragover", onOver);
    host.removeEventListener("dragleave", onLeave);
    host.removeEventListener("drop", onDrop);
  };
}
