/**
 * Turns a picked or downloaded KML/KMZ document into the `File` the host KML
 * importer expects, so the Add Data dialog can hand a URL or a native file
 * pick through the same path drag-and-drop and the Browser panel use on the
 * 2D renderers (folder-aware placemark layers, ground overlays, models, and
 * Super-Overlays), rather than the Cesium-only `KmlDataSource`.
 */

const KMZ_MIME = "application/vnd.google-earth.kmz";
const KML_MIME = "application/vnd.google-earth.kml+xml";

/** Whether the bytes are a zip archive (the KMZ container), by its `PK` magic. */
export function isKmzBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Derives the file name a downloaded document should carry. The importer routes
 * on the extension, so a URL without one (a KML service endpoint, a download
 * handler) gets `.kmz` or `.kml` from the payload itself.
 *
 * @param url - The URL the document was fetched from.
 * @param bytes - The downloaded payload.
 * @returns A file name ending in `.kml` or `.kmz`.
 */
export function kmlFileNameFromUrl(url: string, bytes: Uint8Array): string {
  let segment = "";
  try {
    const path = new URL(url).pathname;
    segment = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
  } catch {
    segment = url.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "";
  }
  const kmz = isKmzBytes(bytes);
  const extension = kmz ? "kmz" : "kml";
  const base = segment.replace(/\.(?:kml|kmz)$/i, "") || "document";
  if (/\.(?:kml|kmz)$/i.test(segment)) {
    // Trust the payload over the URL: a `.kml` link that serves a zip is a KMZ.
    const claims = segment.toLowerCase().endsWith(".kmz");
    return claims === kmz ? segment : `${base}.${extension}`;
  }
  return `${base}.${extension}`;
}

/**
 * Builds the `File` handed to the KML importer.
 *
 * @param name - The file name (its extension decides KML vs KMZ handling).
 * @param content - The document as text, an `ArrayBuffer`, or bytes.
 * @returns A `File` named after the document with the matching MIME type.
 */
export function kmlImportFile(name: string, content: string | ArrayBuffer | Uint8Array): File {
  const kmz = /\.kmz$/i.test(name);
  const part: BlobPart =
    content instanceof Uint8Array
      ? (content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer)
      : content;
  return new File([part], name, { type: kmz ? KMZ_MIME : KML_MIME });
}
