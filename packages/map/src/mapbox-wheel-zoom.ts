import type { Map as MapboxMap, LngLat } from "mapbox-gl";

/**
 * Blend mouse-wheel ticks into one continuously advancing zoom target.
 * Restarting Mapbox's wheel easing on every tick can produce a nearly stationary
 * frame each time. A single frame loop avoids restarting that animation clock.
 * Small trackpad deltas and pinch gestures stay with Mapbox's native handler.
 */
export function installMapboxWheelZoom(map: MapboxMap): () => void {
  const container = map.getCanvasContainer();
  let frame = 0;
  let target = map.getZoom();
  let lastTime = 0;
  let direction = 0;
  let around: LngLat;
  let applying = false;

  const cancel = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const onMoveStart = () => {
    if (!applying) cancel();
  };
  const tick = (now: number) => {
    const elapsed = Math.min(64, Math.max(0, now - lastTime));
    // A wheel event can arrive after this frame's RAF timestamp. Wait for the
    // next frame rather than treating a zero time step as a constrained camera.
    if (elapsed === 0) {
      frame = requestAnimationFrame(tick);
      return;
    }
    lastTime = now;
    const current = map.getZoom();
    const remaining = target - current;
    const zoom =
      Math.abs(remaining) < 0.001 ? target : current + remaining * (1 - Math.exp(-elapsed / 80));
    applying = true;
    try {
      // duration: 0 applies this frame's camera around the cursor; interpolation
      // belongs to this loop, rather than a new easing for each wheel event.
      map.easeTo({ zoom, around, duration: 0 });
    } finally {
      applying = false;
    }
    frame =
      zoom === target || Math.abs(map.getZoom() - current) < 1e-10
        ? 0
        : requestAnimationFrame(tick);
  };
  const onWheel = (event: WheelEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      map.getCooperativeGestures() ||
      !map.scrollZoom.isEnabled() ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0 ||
      (event.deltaMode === 0 && Math.abs(event.deltaY) < 40)
    ) {
      cancel();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    const delta =
      event.deltaY *
      (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? container.clientHeight : 1) *
      (event.shiftKey ? 0.25 : 1);
    const nextDirection = -Math.sign(delta);
    // Match the native wheel's scale response while retaining unfinished ticks.
    const step = Math.log2(2 / (1 + Math.exp(-Math.abs(delta) / 450))) * nextDirection;
    if (!frame || nextDirection !== direction) target = map.getZoom();
    direction = nextDirection;
    target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target + step));
    const bounds = container.getBoundingClientRect();
    around = map.unproject([event.clientX - bounds.left, event.clientY - bounds.top]);
    if (!frame) {
      map.stop();
      lastTime = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };

  container.addEventListener("wheel", onWheel, { capture: true, passive: false });
  container.addEventListener("pointerdown", cancel, true);
  container.addEventListener("keydown", cancel, true);
  map.on("movestart", onMoveStart);
  return () => {
    cancel();
    container.removeEventListener("wheel", onWheel, { capture: true });
    container.removeEventListener("pointerdown", cancel, true);
    container.removeEventListener("keydown", cancel, true);
    map.off("movestart", onMoveStart);
  };
}
