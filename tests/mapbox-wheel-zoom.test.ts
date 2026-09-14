import assert from "node:assert/strict";
import { it, type TestContext } from "node:test";
import type { Map as MapboxMap } from "mapbox-gl";
import { installMapboxWheelZoom } from "../packages/map/src/mapbox-wheel-zoom";

function harness(t: TestContext) {
  let now = performance.now();
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const caf = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.assign(globalThis, {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    },
    cancelAnimationFrame: (handle: number) => frames.delete(handle),
  });
  const element = Object.assign(new EventTarget(), {
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  });
  const moves = new Set<() => void>();
  let zoom = 5;
  let enabled = true;
  const values: number[] = [];
  const anchors: unknown[] = [];
  const map = {
    getCanvasContainer: () => element,
    getZoom: () => zoom,
    getMinZoom: () => 0,
    getMaxZoom: () => 6,
    getCooperativeGestures: () => false,
    scrollZoom: { isEnabled: () => enabled },
    unproject: (point: number[]) => point,
    stop: () => {},
    easeTo: (options: { zoom: number; around: unknown }) => {
      moves.forEach((callback) => callback());
      zoom = options.zoom;
      values.push(zoom);
      anchors.push(options.around);
    },
    on: (_event: string, callback: () => void) => moves.add(callback),
    off: (_event: string, callback: () => void) => moves.delete(callback),
  };
  const dispose = installMapboxWheelZoom(map as unknown as MapboxMap);
  t.after(() => {
    dispose();
    if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (caf) Object.defineProperty(globalThis, "cancelAnimationFrame", caf);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  });
  return {
    values,
    anchors,
    frames,
    dispose,
    disable: () => {
      enabled = false;
    },
    interrupt: () => moves.forEach((callback) => callback()),
    wheel: (deltaY: number, extra = {}) => {
      const event = Object.assign(new Event("wheel", { cancelable: true }), {
        deltaY,
        deltaMode: 0,
        clientX: 110,
        clientY: 220,
        ctrlKey: false,
        shiftKey: false,
        ...extra,
      });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    },
    step: (elapsed = 16) => {
      now += elapsed;
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(now));
    },
  };
}

it("keeps advancing on frames after successive mouse-wheel ticks", (t) => {
  const h = harness(t);
  assert.equal(h.wheel(-120), true);
  for (let i = 0; i < 24; i++) {
    if (i > 0 && i % 4 === 0) h.wheel(-120);
    h.step();
  }
  assert.equal(h.values.length, 24);
  for (let i = 1; i < h.values.length; i++) {
    assert.ok(
      h.values[i] - h.values[i - 1] > 0.002,
      "wheel ticks must not restart at a stationary frame",
    );
  }
  assert.deepEqual(h.anchors[0], [100, 200]);
  for (let i = 0; i < 100; i++) h.step();
  assert.equal(h.frames.size, 0);
  assert.ok(h.values.at(-1)! <= 6);
});

it("reverses direction immediately and clamps to the zoom limit", (t) => {
  const h = harness(t);
  h.wheel(-100000);
  h.step();
  const before = h.values.at(-1)!;
  h.wheel(120);
  h.step();
  assert.ok(h.values.at(-1)! < before);
  for (let i = 0; i < 10; i++) h.wheel(-100000);
  for (let i = 0; i < 100; i++) h.step();
  assert.equal(h.values.at(-1), 6);
});

it("leaves pinch, small trackpad deltas, and disabled scroll zoom to Mapbox", (t) => {
  const h = harness(t);
  assert.equal(h.wheel(-120, { ctrlKey: true }), false);
  assert.equal(h.wheel(-2), false);
  h.disable();
  assert.equal(h.wheel(-120), false);
  assert.equal(h.frames.size, 0);
});

it("cancels for another camera interaction and removes the listener on disposal", (t) => {
  const h = harness(t);
  h.wheel(-120);
  h.interrupt();
  h.step();
  assert.equal(h.values.length, 0);
  h.wheel(-120);
  h.dispose();
  h.step();
  assert.equal(h.values.length, 0);
  assert.equal(h.wheel(-120), false);
});

it("keeps the loop alive when the first frame timestamp precedes the wheel event", (t) => {
  const h = harness(t);
  h.wheel(-120);
  h.step(-1000);
  assert.equal(h.values.length, 0);
  assert.equal(h.frames.size, 1);
  h.step(1016);
  assert.ok(h.values[0] > 5);
});
