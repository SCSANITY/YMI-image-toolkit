/**
 * Output naming. One rule: a row's download name is its stem plus the extension of the
 * format it converts to. The stem is the source name + the suffix setting, unless the
 * user renamed the row — a manual name always wins and is never suffixed again.
 *
 * Renaming only ever affects the OUTPUT. Source files are never touched.
 */

// Characters Windows rejects in a filename, plus control characters.
// Spaces and hyphens are legitimate and must survive.
const ILLEGAL_CHARS = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']

function stripIllegal(value) {
  let out = ''
  for (const char of value) {
    if (ILLEGAL_CHARS.includes(char)) continue
    if (char.charCodeAt(0) < 32) continue
    out += char
  }
  return out
}

export function stemOf(filename) {
  const dot = String(filename).lastIndexOf('.')
  return dot > 0 ? String(filename).slice(0, dot) : String(filename)
}

/**
 * Clean a typed name. If the user typed the output extension too ("hero.webp"), drop it —
 * the extension is owned by the format, not the name. Other dots are legitimate ("logo.v2").
 */
export function sanitizeStem(raw, ext) {
  let value = stripIllegal(String(raw ?? '')).trim()
  if (ext && value.toLowerCase().endsWith(`.${String(ext).toLowerCase()}`)) {
    value = value.slice(0, -(String(ext).length + 1))
  }
  return value.replace(/[. ]+$/, '').trim()
}

/** Converted rows download the staged result, so its real format wins over the current setting. */
export function outputExtFor(file, settings, outputFormats) {
  const key = file.staged ? file.staged.format : settings.format
  return (outputFormats[key] || outputFormats[settings.format] || { ext: 'webp' }).ext
}

export function outputStemFor(file, settings) {
  if (file.customStem) return file.customStem
  return `${stemOf(file.name)}${(settings.output.suffix || '').trim()}`
}

export function outputNameFor(file, settings, outputFormats) {
  return `${outputStemFor(file, settings)}.${outputExtFor(file, settings, outputFormats)}`
}
