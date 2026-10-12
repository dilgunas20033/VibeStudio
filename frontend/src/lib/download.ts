/** Save a Blob as a file via a temporary object URL. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const safeFileName = (name: string) => name.replace(/[^\w\- ]+/g, '').trim() || 'vibestudio'
