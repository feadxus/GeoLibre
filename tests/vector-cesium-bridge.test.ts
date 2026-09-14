import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { parseHTML } from "linkedom";
import { VectorControl } from "maplibre-gl-vector";
import { useAppStore } from "@geolibre/core";
import { bridgeVectorControlToCesium } from "../packages/plugins/src/plugins/vector-cesium-bridge";
import {
  syncVectorLayersToStore,
  unwireVectorStoreSync,
} from "../packages/plugins/src/plugins/vector-layer-sync";
import type { GeoLibreAppAPI } from "../packages/plugins/src/types";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

const original = Object.getOwnPropertyDescriptors(globalThis);
afterEach(() => {
  unwireVectorStoreSync();
  for (const key of ["window", "document", "HTMLElement", "requestAnimationFrame"]) {
    if (original[key]) Object.defineProperty(globalThis, key, original[key]);
    else Reflect.deleteProperty(globalThis, key);
  }
  useAppStore.setState({ layers: [] });
});

it("imports polygon geometry through the real vector control without MapLibre source calls", async () => {
  const { window, document } = parseHTML("<html><body><div id='map'></div></body></html>");
  Object.assign(globalThis, {
    window,
    document,
    HTMLElement: window.HTMLElement,
    requestAnimationFrame: () => 0,
  });
  const container = document.getElementById("map")!;
  const unsupported = () => {
    throw new Error("CesiumControlHost: addSource is not supported on the globe.");
  };
  const host = {
    getContainer: () => container,
    getCanvas: () => container,
    on() {},
    off() {},
    addSource: unsupported,
    addLayer: unsupported,
  } as unknown as MapLibreMap;
  const fitted: unknown[] = [];
  const control = new VectorControl({ enablePicker: false });
  bridgeVectorControlToCesium(control, {
    fitBounds: (bounds) => fitted.push(bounds),
  } as GeoLibreAppAPI);
  for (const event of ["layeradded", "layerupdated", "layerremoved"] as const) {
    control.on(event, () => syncVectorLayersToStore(control));
  }
  container.appendChild(control.onAdd(host));
  const data: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "polygon" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
    ],
  };
  const info = await control.addData(data, { name: "polygon" });
  assert.deepEqual(useAppStore.getState().layers[0].geojson, data);
  assert.deepEqual(await control.getLayerGeoJSON(info.id), data);
  assert.deepEqual(fitted, [[0, 0, 1, 1]]);
  control.setLayerOpacity(info.id, 0.4);
  control.setLayerVisibility(info.id, false);
  assert.equal(useAppStore.getState().layers[0].opacity, 0.4);
  assert.equal(useAppStore.getState().layers[0].visible, false);
  control.setLayerStyle(info.id, { fillColor: "#ff0000" });
  assert.equal(useAppStore.getState().layers[0].style.fillColor, "#ff0000");
  control.removeLayer(info.id);
  assert.equal(useAppStore.getState().layers.length, 0);
  control.onRemove();
});
