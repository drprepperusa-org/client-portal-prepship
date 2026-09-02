/**
 * CP-068 — hand a file the backend produced to the browser's download manager.
 *
 * The bytes are whatever the API returned; nothing here reads, edits or names their contents.
 * The filename is the one PrepShip put on the response, or the caller's fallback when the
 * header was not readable.
 */
export function downloadFile(file: { bytes: Blob; filename: string }): void {
  const url = URL.createObjectURL(file.bytes);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
