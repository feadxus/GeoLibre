import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isKmzBytes,
  kmlFileNameFromUrl,
  kmlImportFile,
} from "../apps/geolibre-desktop/src/lib/kml-import-file";

const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
const XML = new TextEncoder().encode('<?xml version="1.0"?><kml/>');

describe("kml-import-file", () => {
  it("detects the KMZ container by its zip magic", () => {
    assert.equal(isKmzBytes(ZIP), true);
    assert.equal(isKmzBytes(XML), false);
    assert.equal(isKmzBytes(new Uint8Array([0x50])), false);
  });

  it("keeps a URL's own .kml/.kmz file name when it matches the payload", () => {
    assert.equal(kmlFileNameFromUrl("https://h.test/data/parks.kmz?v=2", ZIP), "parks.kmz");
    assert.equal(kmlFileNameFromUrl("https://h.test/data/Trails%20A.KML#x", XML), "Trails A.KML");
  });

  it("names an extension-less or mislabelled download from the payload", () => {
    assert.equal(kmlFileNameFromUrl("https://h.test/export?id=7", ZIP), "export.kmz");
    assert.equal(kmlFileNameFromUrl("https://h.test/export?id=7", XML), "export.kml");
    // A `.kml` link that serves a zip is a KMZ; the importer routes on the name.
    assert.equal(kmlFileNameFromUrl("https://h.test/doc.kml", ZIP), "doc.kmz");
    assert.equal(kmlFileNameFromUrl("https://h.test/", XML), "document.kml");
    assert.equal(kmlFileNameFromUrl("not a url", XML), "not a url.kml");
  });

  it("builds a File carrying the bytes and the matching MIME type", async () => {
    const kmz = kmlImportFile("parks.kmz", ZIP.subarray(1, 4));
    assert.equal(kmz.name, "parks.kmz");
    assert.equal(kmz.type, "application/vnd.google-earth.kmz");
    assert.deepEqual(new Uint8Array(await kmz.arrayBuffer()), new Uint8Array([0x4b, 0x03, 0x04]));
    const kml = kmlImportFile("doc.kml", "<kml/>");
    assert.equal(kml.type, "application/vnd.google-earth.kml+xml");
    assert.equal(await kml.text(), "<kml/>");
  });
});
