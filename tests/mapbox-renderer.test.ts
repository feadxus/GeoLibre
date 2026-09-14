import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyProjectToStore,
  createEmptyProject,
  parseProject,
  projectFromStore,
  serializeProject,
  useAppStore,
} from "@geolibre/core";
import { compileMapboxLayer } from "../packages/map/src/mapbox-layers";
import { MAPBOX_CAPABILITIES, redactMapboxError } from "../packages/map/src/mapbox-engine";
import { isPluginEngineSupported } from "../packages/plugins/src/types";
import { geojsonLayer } from "./helpers/layer-fixtures";

describe("Mapbox project and plugin boundaries", () => {
  it("round trips the primary renderer independently of the grid", () => {
    const project = createEmptyProject();
    project.primaryRenderer = "mapbox";
    const reopened = parseProject(serializeProject(project));
    assert.equal(reopened.primaryRenderer, "mapbox");
    assert.equal(applyProjectToStore(reopened).primaryRenderer, "mapbox");
    useAppStore.getState().newProject();
    useAppStore.getState().setPrimaryRenderer("mapbox");
    assert.equal(projectFromStore(useAppStore.getState()).primaryRenderer, "mapbox");
  });
  it("round trips Mapbox secondary panes", () => {
    const project = createEmptyProject();
    project.mapLayout = { rows: 1, cols: 2, syncView: true };
    project.secondaryMapViews = [
      { id: "mapbox-pane", view: project.mapView, viewKind: "mapbox", layerVisibility: {} },
    ];
    assert.equal(parseProject(serializeProject(project)).secondaryMapViews?.[0].viewKind, "mapbox");
  });
  it("does not activate MapLibre plugins or expose a fake MapLibre map", () => {
    assert.equal(isPluginEngineSupported({}, "mapbox"), false);
    assert.equal(isPluginEngineSupported({ engines: ["maplibre", "cesium"] }, "mapbox"), false);
    assert.equal(isPluginEngineSupported({ engines: ["mapbox"] }, "mapbox"), true);
    assert.equal(MAPBOX_CAPABILITIES.nativeMapInstance, false);
    assert.equal(MAPBOX_CAPABILITIES.customLayers, false);
  });
  it("redacts credentials from engine errors", () => {
    const result = redactMapboxError(
      "Failed https://api.mapbox.com/style?access_token=pk.private.value&x=1 sk.other.secret",
    );
    assert.ok(!result.includes("private"));
    assert.ok(!result.includes("secret"));
    assert.ok(result.includes("&x=1"));
  });
});

describe("Mapbox native layer compilation", () => {
  it("preserves GeoJSON, opacity and all filter sources while removing MapLibre paint extensions", () => {
    const layer = geojsonLayer({ id: "states" });
    layer.opacity = 0.5;
    layer.filterExpression = ["==", ["get", "name"], "California"];
    layer.timeFilter = [">", ["get", "year"], 2020];
    layer.embedFilter = ["==", ["get", "visible"], true];
    const plan = compileMapboxLayer(layer);
    assert.equal(plan.source.type, "geojson");
    if (plan.source.type === "geojson") assert.equal(plan.source.data, layer.geojson);
    for (const spec of plan.layers) {
      assert.ok(!Object.keys(spec.paint ?? {}).some((key) => key.endsWith("-layer-opacity")));
      assert.match(JSON.stringify(spec), /California/);
      assert.match(JSON.stringify(spec), /year/);
      assert.match(JSON.stringify(spec), /visible/);
    }
    const fill = plan.layers.find((s) => s.type === "fill");
    assert.ok(fill);
    assert.equal(fill.paint?.["fill-opacity"], layer.style.fillOpacity * 0.5);
  });
  it("uses Mapbox's native GeoJSON path even for plugin-owned in-memory vector data", () => {
    const layer = geojsonLayer({ id: "external" });
    layer.metadata = { sourceKind: "maplibre-gl-vector", nativeLayerIds: ["old-native-id"] };
    assert.equal(compileMapboxLayer(layer).source.type, "geojson");
  });
  it("preserves HTTP raster bounds, zoom limits, attribution and TMS scheme", () => {
    const layer = {
      ...geojsonLayer({ id: "tiles" }),
      geojson: undefined,
      type: "xyz" as const,
      source: {
        tiles: ["https://example.com/{z}/{x}/{y}.png"],
        scheme: "tms",
        tileSize: 512,
        minzoom: 2,
        maxzoom: 12,
        bounds: [-10, -10, 10, 10],
        attribution: "Test tiles",
      },
    };
    assert.deepEqual(compileMapboxLayer(layer).source, { ...layer.source, type: "raster" });
  });
  it("rejects custom protocols rather than silently displaying an empty layer", () => {
    const layer = {
      ...geojsonLayer({ id: "cog" }),
      geojson: undefined,
      type: "raster" as const,
      source: { tiles: ["geolibre-cog://sample/{z}/{x}/{y}"] },
    };
    assert.throws(() => compileMapboxLayer(layer), /custom tile protocols/);
  });
  it("creates each source-layer in vector tiles", () => {
    const layer = {
      ...geojsonLayer({ id: "vector" }),
      geojson: undefined,
      type: "vector-tiles" as const,
      source: { url: "mapbox://mapbox.mapbox-streets-v8", sourceLayers: ["water", "road"] },
    };
    const plan = compileMapboxLayer(layer);
    assert.equal(plan.layers.length, 6);
    assert.equal(new Set(plan.layers.map((s) => s.id)).size, 6);
    assert.equal(
      plan.layers.filter((s) => "source-layer" in s && s["source-layer"] === "water").length,
      3,
    );
  });
});

describe("Mapbox-specific basemap preference", () => {
  it("persists the override without changing the other engines' shared basemap", () => {
    const project = createEmptyProject();
    const shared = project.basemapStyleUrl;
    project.primaryRenderer = "mapbox";
    project.preferences.map.mapboxStyleUrl = "mapbox://styles/mapbox/standard";
    const reopened = parseProject(serializeProject(project));
    assert.equal(reopened.basemapStyleUrl, shared);
    assert.equal(reopened.preferences.map.mapboxStyleUrl, "mapbox://styles/mapbox/standard");
  });
});
