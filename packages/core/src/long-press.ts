/** A single stationary touch triggers the coordinate readout. Pinch gestures cancel it. */
export function attachLongPress(canvas: HTMLElement, onPress: (point: [number, number]) => void): () => void {
  const touches = new Set<number>();
  let start: { id: number; x: number; y: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = (): void => {
    clearTimeout(timer);
    start = undefined;
  };
  const down = (e: PointerEvent): void => {
    if (e.pointerType !== "touch") return;
    touches.add(e.pointerId);
    cancel();
    if (touches.size !== 1) return;
    const point = { id: e.pointerId, x: e.clientX, y: e.clientY };
    start = point;
    timer = setTimeout(() => {
      start = undefined;
      const rect = canvas.getBoundingClientRect();
      onPress([point.x - rect.left, point.y - rect.top]);
    }, 600);
  };
  const move = (e: PointerEvent): void => {
    if (start?.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 8) cancel();
  };
  const up = (e: PointerEvent): void => {
    touches.delete(e.pointerId);
    if (start?.id === e.pointerId) cancel();
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  return () => {
    cancel();
    touches.clear();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
  };
}
