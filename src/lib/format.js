export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/** Negative = smaller than the source, which is the outcome we want to highlight. */
export function deltaPercent(inBytes, outBytes) {
  if (!inBytes) return 0
  return Math.round(((outBytes - inBytes) / inBytes) * 100)
}

export function formatDelta(inBytes, outBytes) {
  const pct = deltaPercent(inBytes, outBytes)
  return `${pct > 0 ? '+' : ''}${pct}%`
}
