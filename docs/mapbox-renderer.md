# Mapbox renderer

Choose **View → Rendering engine → Mapbox** to render a project with Mapbox GL JS.
The engine is also available from the rendering-engine menu in each split pane.
MapLibre remains the default. Projects save the primary and secondary renderer
choices, and the Python and iframe APIs accept `mapbox` as a renderer name.

Set `VITE_MAPBOX_ACCESS_TOKEN` in **Settings → Environment variables**, or launch
the development server with `MAPBOX_TOKEN` in its environment. Token changes
recreate Mapbox maps. A missing token displays setup instructions; map loading
errors redact access tokens. Use a public Mapbox token appropriate for your
application. Mapbox use is associated with that token's account and is subject
to Mapbox's terms and usage pricing.

The map's Basemap selector offers Mapbox styles and the shared project basemap.
A Mapbox-specific choice is saved as `preferences.map.mapboxStyleUrl`; it does
not replace the basemap used by MapLibre and Cesium. All Mapbox panes share that
choice. Tokens are not added to the style URL by this selector. The existing
Environment variables settings retain their normal project credential handling.

## Supported paths

- Native GeoJSON, including the vector importer's materialized data, with point,
  line, polygon, extrusion, label, data-driven color, opacity, and filter styles.
- HTTP(S) raster tiles (XYZ, WMS and WMTS), vector tiles with named source layers,
  and georeferenced image/video sources.
- Shared layer/group visibility, opacity and ordering; synchronized or independent
  split-view cameras; Mercator/globe projection and Mapbox terrain.
- Feature picking, selection highlighting, extent drawing, draggable placement,
  and engine-level image capture.

Mapbox is not a full replacement for MapLibre's plugin ecosystem. Plugins must
explicitly declare `engines: ["mapbox"]` (or include it alongside other engines).
Unsupported plugins are disabled in the menu. `app.getMap()` stays MapLibre-only;
Mapbox-aware plugins use `app.getMapboxMap()` or the renderer-neutral app methods.
The vector import panel uses the existing store-based geometry bridge.

MapLibre custom protocols, tiled/streamed vector imports beyond the bridge's
materialization limits, custom COG terrain, deck.gl, and specialized plugin-owned
layers require additional adapters. Visible unsupported layers report an error
on the map instead of being silently omitted. Advanced MapLibre-only symbology
(such as custom marker assets and blend modes) is not reproduced by this native
renderer. Mapbox Standard's imported basemap layers do not expose the same
per-layer opacity controls as classic styles; use a classic style for background
opacity editing.

## Loading and size

Mapbox's JavaScript and CSS are imported only when a Mapbox pane mounts. The
production build gives them a separate chunk and excludes them from the PWA's
initial precache. MapLibre startup therefore does not download the Mapbox engine.
Desktop/web distribution artifacts still include it. With Mapbox GL JS 3.30.0,
the engine and stylesheet add approximately 1.91 MB raw, or 532 KB with gzip;
this excludes map tiles and other service responses.
