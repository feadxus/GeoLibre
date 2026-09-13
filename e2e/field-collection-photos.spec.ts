import { expect, test } from "@playwright/test";
import { waitForMap } from "./helpers";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);

test("field collection appends, removes, validates and saves multiple photos", async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  await waitForMap(page, "/?lang=en");
  await page.getByRole("button", { name: "Controls", exact: true }).click();
  await page.getByRole("menuitem", { name: "Field Collection" }).click();
  const dialog = page.getByRole("dialog", { name: "Field Collection" });
  await dialog.getByLabel("Layer name", { exact: true }).fill("Photos");
  await dialog.getByRole("button", { name: "Create layer", exact: true }).click();
  await dialog.getByRole("button", { name: "Pick on map", exact: true }).click();
  await page.locator(".maplibregl-canvas").click({ position: { x: 350, y: 240 } });

  const input = dialog.locator('input[type="file"]');
  await input.setInputFiles([
    { name: "a.png", mimeType: "image/png", buffer: PNG },
    { name: "b.png", mimeType: "image/png", buffer: PNG },
  ]);
  await expect(dialog.getByRole("img")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Remove", exact: true }).first().click();
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", "b.png");
  await input.setInputFiles({ name: "c.png", mimeType: "image/png", buffer: PNG });
  await expect(dialog.getByRole("img")).toHaveCount(2);

  await input.setInputFiles([
    { name: "valid.png", mimeType: "image/png", buffer: PNG },
    { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) },
  ]);
  await expect(dialog.getByText(/That photo is too large/)).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Save point", exact: true }).click();
  await expect(dialog.getByText("Saved 1 point to Photos.")).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Project", exact: true }).click();
  await page.getByRole("menuitem", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const project = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const properties = project.layers.find((layer: { name: string }) => layer.name === "Photos")
    .geojson.features[0].properties;
  expect(properties.geolibre_photo_names).toEqual(["b.png", "c.png"]);
  expect(properties.geolibre_photos).toEqual([
    `data:image/png;base64,${PNG.toString("base64")}`,
    `data:image/png;base64,${PNG.toString("base64")}`,
  ]);
  expect(properties.photo).toBe(properties.geolibre_photos[0]);
});
