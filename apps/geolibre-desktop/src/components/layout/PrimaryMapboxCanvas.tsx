import { useAppStore } from "@geolibre/core";
import { MapboxCanvas, type MapEngine } from "@geolibre/map";
import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { useMapboxAccessToken } from "../../hooks/useMapboxAccessToken";

/** Shared by the primary workspace and split panes, including the token hint. */
export function PrimaryMapboxCanvas({
  engineRef,
  onEngineReady,
  viewId,
}: {
  engineRef?: RefObject<MapEngine | null>;
  onEngineReady?: () => void;
  viewId?: string;
}) {
  const { t } = useTranslation();
  const token = useMapboxAccessToken();
  const basemap = useAppStore((s) => s.preferences.map.mapboxStyleUrl ?? "");
  const setBasemap = (url: string) => {
    const state = useAppStore.getState();
    state.setPreferences({
      ...state.preferences,
      map: { ...state.preferences.map, mapboxStyleUrl: url || undefined },
    });
  };
  const styles = [
    ["", t("renderer.projectBasemap")],
    ["mapbox://styles/mapbox/standard", "Mapbox Standard"],
    ["mapbox://styles/mapbox/streets-v12", "Mapbox Streets"],
    ["mapbox://styles/mapbox/outdoors-v12", "Mapbox Outdoors"],
    ["mapbox://styles/mapbox/satellite-v9", "Mapbox Satellite"],
    ["mapbox://styles/mapbox/satellite-streets-v12", "Mapbox Satellite Streets"],
    ["mapbox://styles/mapbox/light-v11", "Mapbox Light"],
    ["mapbox://styles/mapbox/dark-v11", "Mapbox Dark"],
  ];
  return (
    <div className="absolute inset-0" data-testid="primary-mapbox">
      {token ? (
        <MapboxCanvas
          accessToken={token}
          engineRef={engineRef}
          onEngineReady={onEngineReady}
          viewId={viewId}
        />
      ) : (
        <div
          role="status"
          className="flex h-full items-center justify-center bg-background p-8 text-center text-sm text-muted-foreground"
        >
          {t("renderer.mapboxTokenHint")}
        </div>
      )}
      {token && (
        <select
          aria-label={t("renderer.basemap")}
          value={basemap}
          onChange={(event) => setBasemap(event.target.value)}
          className="absolute top-12 start-2 z-10 max-w-[45%] rounded border border-input bg-background px-2 py-1 text-xs text-foreground shadow"
        >
          {!styles.some(([url]) => url === basemap) && (
            <option value={basemap}>{t("renderer.projectBasemap")}</option>
          )}
          {styles.map(([url, label]) => (
            <option key={url} value={url}>
              {label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
