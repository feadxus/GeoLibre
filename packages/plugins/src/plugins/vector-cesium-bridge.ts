import type { FeatureCollection } from "geojson";
import type { Map as MapLibreMap, SourceSpecification, LayerSpecification } from "maplibre-gl";
import type { VectorControl } from "maplibre-gl-vector";
import type { GeoLibreAppAPI } from "../types";
import { setVectorGeometryReader, syncVectorLayersToStore } from "./vector-layer-sync";

/**
 * Retain the vector panel's presentation records while Cesium renders their
 * geometry through the app store. This adapter belongs only to VectorControl;
 * the globe host still rejects unsupported MapLibre operations by other controls.
 */
export function bridgeVectorControlToCesium(control: VectorControl, app: GeoLibreAppAPI): void {
  const sources = new Map<string, { serialize: () => SourceSpecification }>();
  const layers = new Map<string, LayerSpecification>();
  const collections = new Map<string, FeatureCollection>();
  const pending = new Map<string, object>();
  let removed = false;
  const originalOnAdd = control.onAdd.bind(control);
  control.onAdd = (host) => {
    removed = false;
    const overrides = {
      addSource(id: string, spec: SourceSpecification) {
        sources.set(id, { serialize: () => spec });
      },
      getSource: (id: string) => sources.get(id),
      removeSource(id: string) {
        sources.delete(id);
      },
      addLayer(layer: LayerSpecification) {
        layers.set(layer.id, { ...layer });
      },
      getLayer: (id: string) => layers.get(id),
      removeLayer(id: string) {
        layers.delete(id);
      },
      moveLayer() {}, // Ordering is applied by the Cesium store reconciler.
      setPaintProperty(id: string, key: string, value: unknown) {
        const layer = layers.get(id);
        if (layer) layer.paint = { ...layer.paint, [key]: value } as LayerSpecification["paint"];
      },
      setLayoutProperty(id: string, key: string, value: unknown) {
        const layer = layers.get(id);
        if (layer) layer.layout = { ...layer.layout, [key]: value } as LayerSpecification["layout"];
      },
      getStyle: () => ({
        version: 8,
        sources: Object.fromEntries([...sources].map(([id, source]) => [id, source.serialize()])),
        layers: [...layers.values()],
      }),
      fitBounds(bounds: [[number, number], [number, number]]) {
        app.fitBounds?.([...bounds[0], ...bounds[1]]);
      },
    };
    const map = new Proxy(host, {
      get(target, key) {
        if (key in overrides) return Reflect.get(overrides, key);
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return originalOnAdd(map as MapLibreMap);
  };

  setVectorGeometryReader(control, (info) => {
    const spec = sources.get(info.sourceId)?.serialize();
    if (
      spec?.type === "geojson" &&
      typeof spec.data === "object" &&
      spec.data.type === "FeatureCollection"
    ) {
      return spec.data;
    }
    return collections.get(info.id);
  });

  // Tiled inputs live in DuckDB. Export once per source revision, including
  // refresh and render-mode changes, and ignore completions after removal.
  const syncGeometry = () => {
    const infos = control.getLayers();
    const ids = new Set(infos.map((info) => info.id));
    for (const id of collections.keys()) if (!ids.has(id)) collections.delete(id);
    for (const id of pending.keys()) if (!ids.has(id)) pending.delete(id);
    for (const info of infos) {
      const source = sources.get(info.sourceId);
      if (!source || source.serialize().type === "geojson" || pending.get(info.id) === source)
        continue;
      pending.set(info.id, source);
      void control
        .getLayerGeoJSON(info.id)
        .then((data) => {
          if (removed || pending.get(info.id) !== source || sources.get(info.sourceId) !== source)
            return;
          if (data) collections.set(info.id, data);
          syncVectorLayersToStore(control);
        })
        .catch((error: unknown) => {
          console.error("[GeoLibre] Failed to prepare vector geometry for Cesium", error);
          if (pending.get(info.id) === source) pending.delete(info.id);
        });
    }
  };
  for (const event of ["layeradded", "layerremoved", "layerupdated"] as const) {
    control.on(event, syncGeometry);
  }
  const originalOnRemove = control.onRemove.bind(control);
  control.onRemove = () => {
    removed = true;
    try {
      originalOnRemove();
    } finally {
      sources.clear();
      layers.clear();
      collections.clear();
      pending.clear();
    }
  };
}
