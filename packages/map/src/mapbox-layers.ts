import {
  compileLayerFilters,
  labelFieldTextField,
  ruleBasedVisibilityFilter,
  DEFAULT_LAYER_STYLE,
  type GeoLibreLayer,
} from "@geolibre/core";
import type {
  DataDrivenPropertyValueSpecification,
  LayerSpecification,
  SourceSpecification,
  FilterSpecification,
} from "mapbox-gl";
import { circlePaint, fillPaint, fillExtrusionPaint, linePaint, rasterPaint } from "./style-mapper";

export interface MapboxLayerPlan {
  sourceId: string;
  source: SourceSpecification;
  layers: LayerSpecification[];
}

/** MapLibre's extra compositing properties are not in Mapbox's Style Spec. */
export function mapboxPaint(paint: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(paint).filter(
      ([key, value]) => !key.endsWith("-layer-opacity") && value != null,
    ),
  );
}

function supportedUrl(value: string): boolean {
  return !/^[\w+-]+:/.test(value) || /^(https?:|mapbox:|data:|blob:)/.test(value);
}

/**
 * Whether {@link compileMapboxLayer} can produce a native Mapbox plan for a
 * layer. The layer panels use it to badge a layer the Mapbox renderer cannot
 * draw (a MapLibre custom protocol, deck.gl, COG, ...) before the engine's
 * error banner would report it.
 */
export function isMapboxSupportedLayer(layer: GeoLibreLayer): boolean {
  try {
    compileMapboxLayer(layer);
    return true;
  } catch {
    return false;
  }
}

/** Compile only native Mapbox sources. Never hand MapLibre protocol URLs to its workers. */
export function compileMapboxLayer(layer: GeoLibreLayer): MapboxLayerPlan {
  const sourceId = `geolibre-mapbox-${layer.id}`;
  const style = { ...DEFAULT_LAYER_STYLE, ...layer.style };
  const layout = { visibility: layer.visible ? ("visible" as const) : ("none" as const) };
  const zoom = { minzoom: style.minZoom, maxzoom: style.maxZoom };
  const filters = [
    compileLayerFilters(layer),
    layer.timeFilter,
    layer.embedFilter,
    ruleBasedVisibilityFilter(layer.style),
  ].filter(Boolean);
  const filter = filters.length ? ["all", ...filters] : null;
  const geometryFilter = (geometry: string): FilterSpecification =>
    (filter
      ? ["all", ["==", ["geometry-type"], geometry], filter]
      : ["==", ["geometry-type"], geometry]) as FilterSpecification;
  const vectorLayers = (sourceLayer?: string): LayerSpecification[] => {
    const base = {
      source: sourceId,
      layout,
      ...zoom,
      ...(sourceLayer ? { "source-layer": sourceLayer } : {}),
    };
    const id = `${sourceId}-${sourceLayer ?? "geojson"}`;
    // The shared paint compiler produces Style Spec expressions. Conversion is
    // confined here; the engine never masquerades as a MapLibre Map instance.
    const result = [
      {
        ...base,
        id: `${id}-fill`,
        type: style.extrusionEnabled ? "fill-extrusion" : "fill",
        filter: geometryFilter("Polygon"),
        paint: mapboxPaint(
          style.extrusionEnabled
            ? fillExtrusionPaint(style, layer.opacity)
            : fillPaint(style, layer.opacity),
        ),
      },
      {
        ...base,
        id: `${id}-line`,
        type: "line",
        filter: (filter
          ? ["all", ["!=", ["geometry-type"], "Point"], filter]
          : ["!=", ["geometry-type"], "Point"]) as FilterSpecification,
        paint: mapboxPaint(linePaint(style, layer.opacity)),
      },
      {
        ...base,
        id: `${id}-circle`,
        type: "circle",
        filter: geometryFilter("Point"),
        paint: mapboxPaint(circlePaint(style, layer.opacity)),
      },
    ] as LayerSpecification[];
    const labels = style.labels;
    if (labels.enabled && (labels.field || labels.expression)) {
      let text: DataDrivenPropertyValueSpecification<string> = labelFieldTextField(
        labels,
      ) as DataDrivenPropertyValueSpecification<string>;
      if (labels.expression.trim()) {
        try {
          text = JSON.parse(labels.expression) as DataDrivenPropertyValueSpecification<string>;
        } catch {
          // An unparseable label expression must not take the geometry with
          // it; keep the field-based text.
        }
      }
      result.push({
        ...base,
        id: `${id}-labels`,
        type: "symbol",
        ...(filter ? { filter: filter as FilterSpecification } : {}),
        minzoom: Math.max(style.minZoom, labels.minZoom),
        maxzoom: Math.min(style.maxZoom, labels.maxZoom),
        layout: {
          ...layout,
          "text-field": text,
          "text-font": ["Open Sans Regular"],
          "text-size": labels.size,
          "symbol-placement": labels.placement,
          "text-allow-overlap": labels.allowOverlap,
          "text-anchor": labels.anchor,
          "text-offset": [labels.offsetX, labels.offsetY],
          "text-rotate": labels.rotation,
          "text-max-width": labels.maxWidth,
          "text-transform": labels.transform,
        },
        paint: {
          "text-color": labels.color,
          "text-halo-color": labels.haloColor,
          "text-halo-width": labels.haloWidth,
          "text-opacity": layer.opacity,
        },
      });
    }
    return result;
  };
  if (layer.geojson) {
    return {
      sourceId,
      source: { type: "geojson", data: layer.geojson, generateId: true },
      layers: vectorLayers(),
    };
  }
  const urls = [
    layer.source.url,
    ...(Array.isArray(layer.source.tiles) ? layer.source.tiles : []),
    ...(Array.isArray(layer.source.urls) ? layer.source.urls : []),
  ];
  if (urls.some((url) => typeof url === "string" && !supportedUrl(url))) {
    throw new Error("MapLibre custom tile protocols are not supported by Mapbox");
  }
  const url = typeof layer.source.url === "string" ? layer.source.url : undefined;
  const tiles = Array.isArray(layer.source.tiles)
    ? layer.source.tiles.filter((t): t is string => typeof t === "string")
    : [];
  const options = {
    ...(typeof layer.source.minzoom === "number" ? { minzoom: layer.source.minzoom } : {}),
    ...(typeof layer.source.maxzoom === "number" ? { maxzoom: layer.source.maxzoom } : {}),
    ...(typeof layer.source.attribution === "string"
      ? { attribution: layer.source.attribution }
      : {}),
    ...(Array.isArray(layer.source.bounds) && layer.source.bounds.length === 4
      ? { bounds: layer.source.bounds as [number, number, number, number] }
      : {}),
    ...(layer.source.scheme === "tms" ? { scheme: "tms" as const } : {}),
  };
  if (layer.type === "vector-tiles" && (url || tiles.length)) {
    const names = Array.isArray(layer.source.sourceLayers ?? layer.metadata.sourceLayers)
      ? ((layer.source.sourceLayers ?? layer.metadata.sourceLayers) as unknown[])
      : [layer.source.sourceLayer ?? layer.source["source-layer"]];
    const sourceLayers = names.filter((v): v is string => typeof v === "string" && Boolean(v));
    if (!sourceLayers.length) throw new Error("Vector tiles need a source-layer name");
    return {
      sourceId,
      source: { type: "vector", ...(url ? { url } : { tiles }), ...options },
      layers: sourceLayers.flatMap(vectorLayers),
    };
  }
  const rasterLayers = [
    {
      id: `${sourceId}-raster`,
      type: "raster",
      source: sourceId,
      layout,
      ...zoom,
      paint: mapboxPaint(rasterPaint(style, layer.opacity)),
    },
  ] as LayerSpecification[];
  if (["raster", "wms", "wmts", "xyz"].includes(layer.type) && (tiles.length || url)) {
    return {
      sourceId,
      source: {
        type: "raster",
        ...(tiles.length ? { tiles } : { url }),
        tileSize: typeof layer.source.tileSize === "number" ? layer.source.tileSize : 256,
        ...options,
      },
      layers: rasterLayers,
    };
  }
  if (layer.type === "geojson" && url) {
    return {
      sourceId,
      source: { type: "geojson", data: url, generateId: true },
      layers: vectorLayers(),
    };
  }
  if (
    (layer.type === "image" || layer.type === "video") &&
    Array.isArray(layer.source.coordinates)
  ) {
    const coordinates = layer.source.coordinates as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    if (
      coordinates.length !== 4 ||
      coordinates.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
    )
      throw new Error("Invalid image corners");
    if (layer.type === "image" && url)
      return { sourceId, source: { type: "image", url, coordinates }, layers: rasterLayers };
    if (layer.type === "video" && Array.isArray(layer.source.urls))
      return {
        sourceId,
        source: { type: "video", urls: layer.source.urls as string[], coordinates },
        layers: rasterLayers,
      };
  }
  throw new Error(`Layer type ${layer.type} requires a renderer-specific adapter`);
}
