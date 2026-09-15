import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { layerRow } from "./helpers";
import { DESKTOP_SETTINGS_STORAGE_KEY } from "../apps/geolibre-desktop/src/lib/storage-keys";

const PMTILES = "https://docs.mapbox.com/mapbox-gl-js/assets/earthquakes.pmtiles";
const COPC =
  "https://raw.githubusercontent.com/PDAL/PDAL/master/test/data/copc/1.2-with-color.copc.laz";
const TILES = "https://pelican-public.s3.amazonaws.com/3dtiles/agi-hq/tileset.json";

test.skip(!process.env.MAPBOX_TOKEN, "Set MAPBOX_TOKEN to exercise real Mapbox data imports");
test.use({ actionTimeout: 30_000 });

async function openSource(page: Page, name: string) {
  await page.getByRole("button", { name: "Add Data", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

// Inspect the real engine held by the React shell without adding a production
// global or replacing map calls. The rest of the test uses the public UI.
async function bindEngine(page: Page) {
  await page.waitForFunction(() => {
    const header = document.querySelector("header") as unknown as Record<string, unknown>;
    if (!header) return false;
    let fiber = header[Object.keys(header).find((key) => key.startsWith("__reactFiber"))!] as any;
    while (fiber) {
      for (const side of [fiber, fiber.alternate]) {
        let hook = side?.memoizedState;
        while (hook) {
          const ref = hook.memoizedState;
          if (ref?.current?.kind === "mapbox" && ref.current.getMapboxMap) {
            (window as any).mapboxArchiveTestRef = ref;
            return true;
          }
          hook = hook.next;
        }
      }
      fiber = fiber.return;
    }
    return false;
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`Mapbox PMTiles, COPC and 3D Tiles survive project reload (${theme})`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addLocatorHandler(
      page.getByRole("heading", { name: "Recover unsaved work?" }),
      async () => {
        await page.getByRole("button", { name: "Discard", exact: true }).click();
      },
    );
    await page.addInitScript(
      ({ key, token }) => {
        delete (window as any).showSaveFilePicker;
        delete (window as any).showOpenFilePicker;
        localStorage.setItem(
          key,
          JSON.stringify({
            ...JSON.parse(localStorage.getItem(key) || "{}"),
            mapboxAccessToken: token,
            uiProfile: { onboarded: true, hiddenDataSources: [] },
          }),
        );
      },
      { key: DESKTOP_SETTINGS_STORAGE_KEY, token: process.env.MAPBOX_TOKEN! },
    );
    await page.goto("/");
    if (theme === "dark") await page.getByRole("button", { name: "Switch to Dark Mode" }).click();
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("menuitem", { name: "Rendering engine", exact: true }).hover();
    await page.getByRole("menuitemradio", { name: "Mapbox", exact: true }).click();
    await bindEngine(page);

    await openSource(page, "PMTiles Layer");
    await page
      .getByRole("textbox", { name: "https://example.com/tiles.pmtiles", exact: true })
      .fill(PMTILES);
    await page
      .getByRole("textbox", { name: "Optional custom layer name" })
      .fill("Earthquakes PMTiles");
    await page.getByRole("button", { name: "Add Layer", exact: true }).click();
    await expect(layerRow(page, "Earthquakes PMTiles")).toBeVisible();
    await expect(layerRow(page, "Earthquakes PMTiles")).not.toContainText("No Mapbox");
    await page.locator(".maplibre-gl-pmtiles-layer-close").click();
    await page.waitForFunction(() => {
      const map = (window as any).mapboxArchiveTestRef.current.getMapboxMap();
      return map
        .queryRenderedFeatures()
        .some((feature: any) => feature.source?.startsWith("geolibre-mapbox-pmtiles"));
    });
    await page.screenshot({ path: info.outputPath(`pmtiles-${theme}.png`) });

    await openSource(page, "3D Tiles Layer");
    await page.getByRole("textbox", { name: "Tileset URL", exact: true }).fill(TILES);
    await page.getByRole("textbox", { name: "Layer name", exact: true }).fill("AGI HQ");
    await page.getByRole("spinbutton", { name: "Altitude offset", exact: true }).fill("-300");
    await page.getByRole("button", { name: "Add tileset", exact: true }).click();
    await expect(layerRow(page, "AGI HQ")).toBeVisible();
    await page.locator(".three-d-tiles-control-close").click();
    await page.waitForFunction(() => {
      const map = (window as any).mapboxArchiveTestRef.current.getMapboxMap();
      return map.__deck?.props.layers.some(
        (layer: any) =>
          layer.id.endsWith("-mapbox-tiles") &&
          layer.isLoaded &&
          layer.state?.tileset3d?.tiles.some((tile: any) => tile.content),
      );
    });
    await page.evaluate(() =>
      (window as any).mapboxArchiveTestRef.current
        .getMapboxMap()
        .jumpTo({ center: [-75.5967, 40.0388], zoom: 17, pitch: 60 }),
    );
    await page.waitForTimeout(1000); // Allow the newly selected 3D tiles to draw after the camera jump.
    await page.screenshot({ path: info.outputPath(`tiles-${theme}.png`) });

    await openSource(page, "LiDAR Layer");
    await page
      .getByRole("textbox", { name: "https://example.com/pointcloud.laz", exact: true })
      .fill(COPC);
    await page.getByRole("button", { name: "Load", exact: true }).click();
    await expect(page.getByText("1,065 points", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(layerRow(page, "1.2-with-color.copc.laz")).not.toContainText("No Mapbox");
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.waitForFunction(() => {
      const map = (window as any).mapboxArchiveTestRef.current.getMapboxMap();
      return (
        !map.isMoving() &&
        Math.abs(map.getCenter().lng + 117.245) < 0.05 &&
        map._controls.some((control: any) =>
          control._deck?.props.layers.some(
            (layer: any) =>
              layer.id.startsWith("pointcloud-") && layer.props.data?.length > 0 && layer.isLoaded,
          ),
        )
      );
    });
    await page.screenshot({ path: info.outputPath(`lidar-${theme}.png`) });

    // Toggle through the Layers panel and persist the resulting visibility.
    await layerRow(page, "AGI HQ").getByRole("button", { name: "Hide layer", exact: true }).click();
    await layerRow(page, "AGI HQ").getByRole("button", { name: "Show layer", exact: true }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("menuitem", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Strip credentials", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
    const savedPath = (await (await downloading).path())!;
    const saved = JSON.parse(await readFile(savedPath, "utf8"));
    expect(saved.primaryRenderer).toBe("mapbox");
    expect(saved.layers.map((layer: any) => layer.type).sort()).toEqual([
      "3d-tiles",
      "lidar",
      "pmtiles",
    ]);
    expect(JSON.stringify(saved)).not.toContain(process.env.MAPBOX_TOKEN!);

    await page.reload();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open From" }).click();
    await page.getByRole("menuitem", { name: "File...", exact: true }).click();
    await (
      await choosing
    ).setFiles({
      name: "mapbox.geolibre.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(saved)),
    });
    await bindEngine(page);
    await expect(layerRow(page, "Earthquakes PMTiles")).toBeVisible();
    await expect(layerRow(page, "AGI HQ")).toBeVisible();
    await expect(layerRow(page, "1.2-with-color.copc.laz")).toBeVisible({ timeout: 60_000 });
    await openSource(page, "LiDAR Layer");
    await expect(page.getByText("1,065 points", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.evaluate(() =>
      (window as any).mapboxArchiveTestRef.current
        .getMapboxMap()
        .jumpTo({ center: [-75.5967, 40.0388], zoom: 17, pitch: 60 }),
    );
    await page.waitForFunction(() => {
      const map = (window as any).mapboxArchiveTestRef.current.getMapboxMap();
      return map.__deck?.props.layers.some(
        (layer: any) =>
          layer.id.endsWith("-mapbox-tiles") &&
          layer.isLoaded &&
          layer.state?.tileset3d?.tiles.some((tile: any) => tile.content),
      );
    });
    // Reuse the same project across native engine teardown and reattachment.
    for (const renderer of ["MapLibre", "Mapbox"]) {
      await page.getByRole("button", { name: "View", exact: true }).click();
      await page.getByRole("menuitem", { name: "Rendering engine", exact: true }).hover();
      await page.getByRole("menuitemradio", { name: renderer, exact: true }).click();
      await expect(
        page.locator(renderer === "Mapbox" ? ".mapboxgl-canvas" : ".maplibregl-canvas").first(),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Add Data", exact: true })).toBeEnabled();
    }
    await bindEngine(page);
    await openSource(page, "LiDAR Layer");
    await expect(page.getByText("1,065 points", { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.evaluate(() =>
      (window as any).mapboxArchiveTestRef.current
        .getMapboxMap()
        .jumpTo({ center: [-75.5967, 40.0388], zoom: 17, pitch: 60 }),
    );
    await page.waitForFunction(() => {
      const map = (window as any).mapboxArchiveTestRef.current.getMapboxMap();
      return map.__deck?.props.layers.some(
        (layer: any) =>
          layer.id.endsWith("-mapbox-tiles") &&
          layer.isLoaded &&
          layer.state?.tileset3d?.tiles.some((tile: any) => tile.content),
      );
    });
    await layerRow(page, "AGI HQ")
      .getByRole("button", { name: "Remove layer", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Remove layer?" })
      .getByRole("button", { name: "Remove", exact: true })
      .click();
    await expect(layerRow(page, "AGI HQ")).toHaveCount(0);
    await page.waitForFunction(
      () =>
        !(window as any).mapboxArchiveTestRef.current
          .getMapboxMap()
          .__deck?.props.layers.some((layer: any) => layer.id.endsWith("-mapbox-tiles")),
    );
    expect(errors).toEqual([]);
  });
}
