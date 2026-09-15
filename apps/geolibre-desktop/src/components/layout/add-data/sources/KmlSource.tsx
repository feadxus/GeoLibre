import { createCesiumKmlLayer, useAppStore } from "@geolibre/core";
import { routeKmlFileSelection, type KmlFileImport } from "@geolibre/plugins";
import { Button, Input, Label } from "@geolibre/ui";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { isTauri } from "../../../../lib/is-tauri";
import { kmlFileNameFromUrl, kmlImportFile } from "../../../../lib/kml-import-file";
import { openLocalDataFileWithFallback } from "../../../../lib/tauri-io";
import { errorMessage, fileNameFromPath, layerNameFromPath, proxyFeedRequestUrl } from "../helpers";
import { AddDataSourceForm, useAddDataSource } from "../shared";

interface PickedKml {
  path: string;
  /** The KMZ archive bytes (binary picks). */
  data?: ArrayBuffer;
  /** The KML document text (text picks). */
  text?: string;
}

/** Encodes a picked KMZ archive as the data URL a Cesium KML layer persists. */
function kmzDataUrl(data: ArrayBuffer): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([data], { type: "application/vnd.google-earth.kmz" }));
  });
}

/**
 * Downloads a KML/KMZ URL for the 2D importer. The desktop fetches natively
 * (no CORS); the dev server goes through its same-origin proxy; the hosted web
 * build needs the host to allow cross-origin reads.
 */
async function fetchKmlImportFile(url: string, t: TFunction): Promise<File> {
  let bytes: Uint8Array;
  if (isTauri()) {
    const { fetchUrlBytes } = await import("../../../../lib/native-http");
    const raw = await fetchUrlBytes(url, { context: "KML / KMZ" });
    bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  } else {
    const response = await fetch(proxyFeedRequestUrl(url));
    if (!response.ok) {
      throw new Error(t("addData.common.requestFailed", { status: response.status }));
    }
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  return kmlImportFile(kmlFileNameFromUrl(url, bytes), bytes);
}

/**
 * KML / KMZ from a URL or a local file. On the Cesium globe the document is
 * preserved as a native `KmlDataSource` layer (styles, overlays, network
 * links). On the 2D renderers it goes through the host KML importer that
 * drag-and-drop and the Browser panel use, which converts placemarks into
 * folder-aware GeoJSON layers and adds ground overlays, models, and
 * Super-Overlays; layer names then come from the document itself.
 */
export function KmlSource({ initialUrl }: { initialUrl?: string }) {
  const { t } = useTranslation();
  const nativeGlobe = useAppStore((state) => state.primaryRenderer === "cesium");
  const [defaultName] = useState(() => t("addData.kml.defaultName"));
  const source = useAddDataSource(defaultName);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [picked, setPicked] = useState<PickedKml | null>(null);
  const chooseFile = async () => {
    source.setError(null);
    try {
      const file = await openLocalDataFileWithFallback({
        filters: [{ name: "KML / KMZ", extensions: ["kml", "kmz"] }],
        accept: ".kml,.kmz",
        readText: true,
        binaryExtensions: ["kmz"],
      });
      if (!file) return;
      if (!file.data?.byteLength && !file.text?.trim()) {
        throw new Error(t("addData.kml.errorSource"));
      }
      setPicked(file);
      setUrl("");
      source.setLayerName((current) =>
        current.trim() && current !== defaultName
          ? current
          : layerNameFromPath(file.path, defaultName),
      );
    } catch (error) {
      source.setError(errorMessage(error, t("addData.shared.addError")));
    }
  };
  const submit = source.runSubmit(async () => {
    const trimmedUrl = url.trim();
    if (!picked && !trimmedUrl) throw new Error(t("addData.kml.errorSource"));
    if (nativeGlobe) {
      const data = picked ? (picked.data ? await kmzDataUrl(picked.data) : picked.text) : undefined;
      source.addAndClose(
        createCesiumKmlLayer({
          name: source.layerName.trim() || defaultName,
          url: trimmedUrl,
          data,
          sourcePath: picked?.path,
        }),
      );
      return;
    }
    const imports: KmlFileImport[] = picked
      ? [
          {
            file: kmlImportFile(fileNameFromPath(picked.path), picked.data ?? picked.text ?? ""),
            // Only a native pick has a filesystem path; a browser File's
            // `path` is just its name, which the importer must not re-read.
            sourcePath: isTauri() ? picked.path : undefined,
          },
        ]
      : [{ file: await fetchKmlImportFile(trimmedUrl, t) }];
    // The host importer reports its own failures through the shell's import
    // banner; a `false` here means no importer is registered at all.
    if (!(await routeKmlFileSelection(imports))) {
      throw new Error(t("addData.kml.errorImporter"));
    }
    source.shell.closeDialog();
  });
  return (
    <AddDataSourceForm
      layerName={source.layerName}
      onLayerNameChange={source.setLayerName}
      beforeLayerId={source.beforeLayerId}
      onBeforeLayerIdChange={source.setBeforeLayerId}
      hideLayerFields={!nativeGlobe}
      onSubmit={submit}
      error={source.error}
      submitDisabled={source.isSubmitting}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="kml-url">{t("addData.kml.url")}</Label>
          <Input
            id="kml-url"
            value={url}
            placeholder="https://example.com/map.kmz"
            onChange={(event) => {
              setUrl(event.target.value);
              setPicked(null);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={chooseFile}>
            {t("addData.common.chooseFile")}
          </Button>
          <span className="truncate text-xs text-muted-foreground">
            {picked?.path ?? t("addData.common.noFileSelected")}
          </span>
        </div>
        {!nativeGlobe && (
          <p className="text-xs text-muted-foreground">{t("addData.kml.mapLayerNamesNote")}</p>
        )}
      </div>
    </AddDataSourceForm>
  );
}
