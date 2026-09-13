/** Extract a display filename without changing the source used for file access. */
export function localFileName(path: string): string {
  const isContentUri = /^content:\/\//i.test(path);
  const value = isContentUri ? path.split(/[?#]/)[0] : path;
  const segment = value.split(/[/\\]/).pop() ?? value;
  // A browser File can also carry a SAF document ID after a native import.
  // Do not decode ordinary filenames: percent escapes can be literal text.
  if (!isContentUri && !/^[^%/\\:]+%3a/i.test(segment)) return segment;
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return segment;
  }
  // Strip the provider's volume prefix before taking the final path component.
  return (
    decoded
      .replace(/^[^/\\:]+:/, "")
      .split(/[/\\]/)
      .pop() ?? decoded
  );
}

/** Keep imported layers distinguishable, including within a multi-file import. */
export function uniqueImportedLayerName(name: string, names: Iterable<string>): string {
  const existing = new Set(names);
  let candidate = name;
  let suffix = 2;
  while (existing.has(candidate)) candidate = `${name}_${suffix++}`;
  return candidate;
}
