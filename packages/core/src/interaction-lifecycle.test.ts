import { afterEach, expect, it, vi } from "vitest";
import { attachLongPress } from "./long-press.js";
import { MeasureController } from "./measure.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function touchCanvas() {
  vi.useFakeTimers();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 10, top: 20 }) });
  const press = vi.fn();
  const dispose = attachLongPress(canvas as never, press);
  const pointer = (type: string, id: number, x = 30, y = 40) => canvas.dispatchEvent(
    Object.assign(new Event(type), { pointerType: "touch", pointerId: id, clientX: x, clientY: y }),
  );
  return { press, dispose, pointer };
}

it("reports one stationary touch relative to the canvas", () => {
  const h = touchCanvas();
  h.pointer("pointerdown", 1);
  vi.advanceTimersByTime(600);
  expect(h.press).toHaveBeenCalledExactlyOnceWith([20, 20]);
  h.dispose();
});

it("does not leave an older long-press timer running after a pinch gesture", () => {
  const h = touchCanvas();
  h.pointer("pointerdown", 1);
  vi.advanceTimersByTime(100);
  h.pointer("pointerdown", 2);
  h.pointer("pointerup", 2);
  h.pointer("pointerup", 1);
  vi.advanceTimersByTime(1000);
  expect(h.press).not.toHaveBeenCalled();
  h.dispose();
});

it.each(["move", "release", "dispose"])("cancels the coordinate timer on %s", action => {
  const h = touchCanvas();
  h.pointer("pointerdown", 1);
  if (action === "move") h.pointer("pointermove", 1, 60, 60);
  if (action === "release") h.pointer("pointerup", 1);
  if (action === "dispose") h.dispose();
  vi.advanceTimersByTime(1000);
  expect(h.press).not.toHaveBeenCalled();
  h.dispose();
});

it("stopping a vertex drag restores panning and removes its release listener", () => {
  vi.stubGlobal("window", new EventTarget());
  const handlers = new Map<string, Set<Function>>();
  const interaction = (enabled = true) => ({ isEnabled: () => enabled, enable: () => { enabled = true; }, disable: () => { enabled = false; } });
  const map = {
    on: (type: string, fn: Function) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type)!.add(fn); },
    off: (type: string, fn: Function) => handlers.get(type)?.delete(fn),
    getSource: () => ({ setData: vi.fn() }), getCanvas: () => ({ style: {} }),
    queryRenderedFeatures: () => [{ properties: { index: 0 } }],
    doubleClickZoom: interaction(false), dragPan: interaction(),
  };
  const controller = new MeasureController(map as never, "#123456", "en");
  controller.start("distance");
  for (const fn of handlers.get("mousedown") ?? []) fn({ point: { x: 0, y: 0 }, preventDefault: vi.fn() });
  expect(map.dragPan.isEnabled()).toBe(false);
  controller.stop();
  expect(map.dragPan.isEnabled()).toBe(true);
  expect(handlers.get("mouseup")?.size ?? 0).toBe(0);
  expect(map.doubleClickZoom.isEnabled()).toBe(false);
  controller.start("distance");
  expect(controller.state.value?.points).toEqual([]);
  controller.destroy();
});
