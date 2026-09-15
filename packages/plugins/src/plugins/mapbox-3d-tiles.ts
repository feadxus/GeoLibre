import { applyTilesetAltitudeOffset, type PositionedTileset } from "./tiles-altitude-offset";
import { useAppStore, type GeoLibreLayer, resolveThreeDTilesRequestHeaders } from "@geolibre/core";
import type { Layer } from "@deck.gl/core";
import type { GeoLibreAppAPI } from "../types";
import { ensureSharedDeckOverlay, setSharedDeckLayers } from "./shared-deck-overlay";
import {
  acquireMercatorProjectionLock,
  releaseMercatorProjectionLock,
} from "./map-projection-utils";
import { THREE_D_TILES_DECK_LOAD_OPTIONS } from "./arcgis-i3s-tiles";

const SOURCE = "mapbox-3d-tiles";
let unsubscribe: (() => void) | undefined;
let boundMap: unknown;
let generation = 0;
const flyToRequests = new Set<string>();

export function isMapboxTilesLayer(layer: GeoLibreLayer): boolean {
  return layer.type === "3d-tiles" && layer.metadata.sourceKind === "3d-tiles-url";
}

/** Bind persisted tilesets to the current engine without storing renderer objects. */
export async function restoreMapboxTiles(app: GeoLibreAppAPI, flyToId?: string): Promise<void> {
  const map = app.getMapboxMap?.();
  if (!map || !app.getDeckGL) return;
  if (flyToId) flyToRequests.add(flyToId);
  const currentGeneration = ++generation;
  const deck = await app.getDeckGL();
  if (currentGeneration !== generation || app.getMapboxMap?.() !== map) return;
  await ensureSharedDeckOverlay(app);
  if (currentGeneration !== generation || app.getMapboxMap?.() !== map) return;
  unsubscribe?.();
  const newlyBound = boundMap !== map;
  boundMap = map;
  let signature = "";
  const versions = new Map<string, { source: string; revision: number }>();
  const render = () => {
    if (boundMap !== map) return;
    const layers = useAppStore.getState().layers.filter(isMapboxTilesLayer);
    const next = JSON.stringify(
      layers.map(({ id, source, visible, opacity }) => ({ id, source, visible, opacity })),
    );
    if (next === signature) return;
    signature = next;
    if (layers.length) acquireMercatorProjectionLock(SOURCE, app);
    else releaseMercatorProjectionLock(SOURCE, app);
    for (const id of flyToRequests)
      if (!layers.some((layer) => layer.id === id)) flyToRequests.delete(id);
    const Tile3DLayer = deck.geoLayers.Tile3DLayer as unknown as new (
      props: Record<string, unknown>,
    ) => Layer;
    for (const id of versions.keys())
      if (!layers.some((layer) => layer.id === id)) versions.delete(id);
    const revision = (layer: GeoLibreLayer) => {
      const source = JSON.stringify(layer.source);
      const previous = versions.get(layer.id);
      if (previous?.source === source) return previous.revision;
      const revision = (previous?.revision ?? -1) + 1;
      versions.set(layer.id, { source, revision });
      return revision;
    };
    setSharedDeckLayers(
      SOURCE,
      [...layers].reverse().map(
        (layer) =>
          new Tile3DLayer({
            id: `${layer.id}-${revision(layer)}-mapbox-tiles`,
            data: layer.source.url,
            altitudeOffset: layer.source.altitudeOffset,
            visible: layer.visible,
            opacity: layer.opacity,
            pickable: false,
            loadOptions: {
              ...THREE_D_TILES_DECK_LOAD_OPTIONS,
              fetch: {
                headers: resolveThreeDTilesRequestHeaders(
                  String(layer.source.url),
                  layer.source.requestHeaders as Record<string, string> | undefined,
                ),
              },
            },
            onTilesetLoad: (tileset: PositionedTileset & { zoom?: number }) => {
              applyTilesetAltitudeOffset(tileset, Number(layer.source.altitudeOffset ?? 0));
              const current = useAppStore.getState().layers.find(({ id }) => id === layer.id);
              if (!current || boundMap !== map) return;
              const center = tileset.cartographicCenter;
              useAppStore.getState().updateLayer(layer.id, {
                metadata: {
                  ...current.metadata,
                  status: "loaded",
                  error: undefined,
                  ...(center
                    ? {
                        center: Array.from(center).slice(0, 2),
                        altitude: center[2],
                        zoom: tileset.zoom,
                      }
                    : {}),
                },
              });
              if (center && flyToRequests.delete(layer.id))
                map.flyTo({
                  center: [center[0], center[1]],
                  zoom: Math.max(0, (tileset.zoom ?? 16) - 1),
                  pitch: 60,
                });
            },
            onError: (error: Error) => {
              const current = useAppStore.getState().layers.find(({ id }) => id === layer.id);
              if (current && boundMap === map)
                useAppStore.getState().updateLayer(layer.id, {
                  metadata: { ...current.metadata, status: "error", error: error.message },
                });
              return true;
            },
            onTileError: (_tile: unknown, message: string) => {
              const current = useAppStore.getState().layers.find(({ id }) => id === layer.id);
              if (current && boundMap === map)
                useAppStore.getState().updateLayer(layer.id, {
                  metadata: { ...current.metadata, status: "error", error: message },
                });
            },
          }) as unknown as Layer,
      ),
    );
  };
  unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.layers !== previous.layers) render();
  });
  if (newlyBound)
    map.once("remove", () => {
      if (boundMap !== map) return;
      generation++;
      unsubscribe?.();
      unsubscribe = undefined;
      boundMap = null;
      setSharedDeckLayers(SOURCE, []);
      releaseMercatorProjectionLock(SOURCE, app);
    });
  render();
}
