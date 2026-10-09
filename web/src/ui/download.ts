/** Save a blob as a file through the browser's download. */
export function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
  // Revoked later: some browsers start reading the URL only after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The file name without its extension, for naming files derived from it. */
export const baseName = (fileName = 'model') => fileName.replace(/\.[^.]+$/, '') || 'model';
