import type { GeoLibreLayer } from "@geolibre/core";
import type { LayerSpecification, SourceSpecification } from "maplibre-gl";

/** Scale outputs without nesting a camera expression below an arithmetic node. */
export function arcgisOpacity(value: unknown, opacity: number): unknown {
  if (value == null) return opacity;
  if (typeof value === "number") return value * opacity;
  if (Array.isArray(value)) {
    if (value[0] === "interpolate" || value[0] === "step") {
      const start = value[0] === "step" ? 2 : 4;
      return value.map((part, index) =>
        index >= start && (index - start) % 2 === 0 ? arcgisOpacity(part, opacity) : part,
      );
    }
    return ["*", value, opacity];
  }
  if (typeof value === "object" && "stops" in value && Array.isArray(value.stops)) {
    return {
      ...value,
      stops: value.stops.map(([input, output]) => [input, arcgisOpacity(output, opacity)]),
      ...("default" in value ? { default: arcgisOpacity(value.default, opacity) } : {}),
    };
  }
  return opacity;
}

/** Resolved ArcGIS styles travel with the layer, independently of its control. */
export function arcgisVectorStyle(layer: GeoLibreLayer): {
  sources: Record<string, SourceSpecification>;
  layers: LayerSpecification[];
} | null {
  if (layer.type !== "arcgis") return null;
  const sources = layer.source.arcgisSources;
  const layers = layer.source.arcgisLayers;
  const nativeIds = layer.metadata.nativeLayerIds;
  if (!Array.isArray(nativeIds)) return null;
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) return null;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const entries = Object.entries(sources);
  if (
    entries.length === 0 ||
    entries.some(([, source]) => !source || source.type !== "vector") ||
    layers.some(
      (spec) =>
        !spec ||
        typeof spec.id !== "string" ||
        !nativeIds.includes(spec.id) ||
        typeof spec.source !== "string" ||
        !Object.hasOwn(sources, spec.source) ||
        !["fill", "line", "circle", "symbol", "fill-extrusion", "heatmap"].includes(spec.type),
    )
  )
    return null;
  return {
    sources: sources as Record<string, SourceSpecification>,
    layers: layers as LayerSpecification[],
  };
}
