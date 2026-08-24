/**
 * Image pipeline — the single source of truth for what this app does to a file.
 *
 * Conversion is two phases on purpose, so nothing is ever written where the user did not
 * ask for it:
 *
 *   1. convertToStaging()  read -> resize -> flatten (only if the target has no alpha)
 *                          -> encode -> write into a temp staging folder
 *   2. saveOutputs()       copy staged files to wherever the user chooses, on demand
 *
 * Staged files are COPIED, not moved, so the same result can be downloaded more than once
 * during a session. The staging folder is temporary and is cleared when the app quits.
 *
 * Everything Electron-specific (windows, dialogs, IPC) lives in main.cjs. This module is
 * plain Node + sharp so it can be tested headlessly and reused if the app ever grows a CLI.
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

// Each conversion already uses libvips threads; keep per-call threading low so the
// renderer's parallel batch does not oversubscribe the CPU.
sharp.concurrency(2)

// libvips' operation cache holds up to 20 OPEN FILE HANDLES by default. On Windows that
// keeps a source image locked ("file in use") long after the app is done with it -- the
// handle belongs to this global cache, not to any list row, so removing the row or
// clearing the list cannot release it. Zero the file-handle budget; the in-memory result
// cache (50MB / 100 items) is untouched, and this app reads each source once anyway.
sharp.cache({ files: 0 })

/** Extensions we can READ. Output is deliberately limited to OUTPUT_FORMATS. */
const INPUT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff'])

/** Extensions we can WRITE, keyed by the format id used in settings. */
const OUTPUT_FORMATS = {
  webp: { ext: 'webp', alpha: true },
  png: { ext: 'png', alpha: true },
  jpeg: { ext: 'jpg', alpha: false },
}

const DEFAULT_SETTINGS = {
  format: 'webp',
  quality: 82,
  lossless: false,
  effort: 4,
  pngPalette: false,
  resize: { mode: 'none', percent: 100, width: 1600, height: null, allowUpscale: false },
  flattenColor: '#ffffff',
  keepMetadata: false,
  output: { suffix: '', overwrite: false, lastDir: null },
}

// ── file discovery ────────────────────────────────────────────────────────────

function isSupportedInput(filePath) {
  return INPUT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

/** Expand a mixed list of files/folders into a flat, de-duplicated list of image paths. */
async function expandPaths(inputPaths) {
  const found = []
  const seen = new Set()

  async function walk(target, depth) {
    let stat
    try {
      stat = await fsp.stat(target)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      if (depth > 8) return
      const entries = await fsp.readdir(target)
      for (const entry of entries.sort()) {
        await walk(path.join(target, entry), depth + 1)
      }
      return
    }
    if (!isSupportedInput(target)) return
    const key = path.resolve(target).toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    found.push(path.resolve(target))
  }

  for (const p of inputPaths) await walk(p, 0)
  return found
}

// ── probing (list rows + thumbnails) ──────────────────────────────────────────

async function probeFile(filePath) {
  const stat = await fsp.stat(filePath)
  const meta = await sharp(filePath, { failOn: 'error' }).metadata()
  const thumb = await sharp(filePath, { failOn: 'error' })
    .resize(160, 160, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 70 })
    .toBuffer()

  return {
    path: filePath,
    name: path.basename(filePath),
    dir: path.dirname(filePath),
    bytes: stat.size,
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || path.extname(filePath).slice(1).toLowerCase(),
    hasAlpha: Boolean(meta.hasAlpha),
    pages: meta.pages || 1,
    thumb: `data:image/webp;base64,${thumb.toString('base64')}`,
  }
}

// ── phase 1: convert into staging ─────────────────────────────────────────────

/**
 * Turn the UI's resize settings into concrete sharp `resize()` options, or null for "no resize".
 * `sourceWidth` is needed because percentage scaling is only meaningful against real pixels.
 */
function resolveResizeOptions(resize, sourceWidth) {
  if (!resize || resize.mode === 'none') return null

  if (resize.mode === 'percent') {
    const scale = Number(resize.percent) / 100
    if (!Number.isFinite(scale) || scale <= 0 || scale === 1 || !sourceWidth) return null
    // Width drives the scale; height follows from the aspect ratio.
    return { width: Math.max(1, Math.round(sourceWidth * scale)), kernel: 'lanczos3' }
  }

  const width = Number(resize.width) > 0 ? Math.round(Number(resize.width)) : null
  const height = Number(resize.height) > 0 ? Math.round(Number(resize.height)) : null
  if (!width && !height) return null
  return {
    width,
    height,
    fit: 'inside',
    withoutEnlargement: !resize.allowUpscale,
    kernel: 'lanczos3',
  }
}

function applyEncoder(pipeline, settings) {
  const quality = Math.min(100, Math.max(1, Math.round(Number(settings.quality) || 82)))
  switch (settings.format) {
    case 'webp':
      return pipeline.webp({
        quality,
        lossless: Boolean(settings.lossless),
        effort: Math.min(6, Math.max(0, Number(settings.effort) ?? 4)),
      })
    case 'jpeg':
      return pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? '4:4:4' : '4:2:0' })
    case 'png':
      return pipeline.png({
        compressionLevel: 9,
        effort: 7,
        palette: Boolean(settings.pngPalette),
        quality,
      })
    default:
      throw new Error(`Unsupported output format: ${settings.format}`)
  }
}

/** The filename the user will see suggested in the save dialog. */
function suggestedName(inputPath, settings) {
  const spec = OUTPUT_FORMATS[settings.format]
  const base = path.basename(inputPath, path.extname(inputPath))
  const suffix = (settings.output?.suffix || '').trim()
  return `${base}${suffix}.${spec.ext}`
}

/**
 * Convert one file into `stagingDir`. Nothing lands anywhere the user can see until
 * commitOutputs() runs, so a cancelled save dialog leaves the disk untouched.
 * `slot` keeps same-named sources from different folders apart inside staging.
 */
async function convertToStaging(inputPath, rawSettings, stagingDir, slot) {
  const settings = { ...DEFAULT_SETTINGS, ...rawSettings }
  const spec = OUTPUT_FORMATS[settings.format]
  if (!spec) throw new Error(`Unsupported output format: ${settings.format}`)

  const inputStat = await fsp.stat(inputPath)
  let pipeline = sharp(inputPath, { failOn: 'error' })
  const meta = await pipeline.metadata()

  const resizeOptions = resolveResizeOptions(settings.resize, meta.width)
  if (resizeOptions) pipeline = pipeline.resize(resizeOptions)

  // Alpha only has to go when the target format cannot carry it.
  if (!spec.alpha) pipeline = pipeline.flatten({ background: settings.flattenColor || '#ffffff' })

  pipeline = settings.keepMetadata ? pipeline.withMetadata() : pipeline.keepIccProfile()
  pipeline = applyEncoder(pipeline, settings)

  const name = suggestedName(inputPath, settings)
  const stagedPath = path.join(stagingDir, String(slot), name)
  await fsp.mkdir(path.dirname(stagedPath), { recursive: true })
  const info = await pipeline.toFile(stagedPath)

  return {
    inputPath,
    stagedPath,
    suggestedName: name,
    inBytes: inputStat.size,
    outBytes: info.size,
    width: info.width,
    height: info.height,
    format: info.format,
  }
}

// ── phase 2: commit staged files to the destination the user picked ───────────

function uniquify(targetPath) {
  const dir = path.dirname(targetPath)
  const ext = path.extname(targetPath)
  const stem = path.basename(targetPath, ext)
  let candidate = targetPath
  let n = 1
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${n}${ext}`)
    n += 1
  }
  return candidate
}

const isSamePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/**
 * `destination` is either { mode: 'directory', dir } for a batch or
 * { mode: 'file', filePath } for a single image saved under a chosen name.
 */
async function saveOutputs(items, destination, options = {}) {
  const overwrite = Boolean(options.overwrite)
  const results = []

  for (const item of items) {
    try {
      let target = destination.mode === 'file'
        ? destination.filePath
        : path.join(destination.dir, item.suggestedName)

      // Hard invariant: the source image is never replaced by its own conversion.
      if (isSamePath(target, item.inputPath)) {
        if (destination.mode === 'file') {
          throw new Error('That is the source file — choose a different name.')
        }
        const ext = path.extname(target)
        target = path.join(path.dirname(target), `${path.basename(target, ext)}-converted${ext}`)
      }

      // A save dialog has already asked about replacing a named file; only batch
      // directory writes fall back to the counter rule.
      if (destination.mode === 'directory' && !overwrite) target = uniquify(target)

      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.copyFile(item.stagedPath, target)
      results.push({ ...item, ok: true, outputPath: target })
    } catch (e) {
      results.push({ ...item, ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return results
}

async function discardStaging(stagingDir) {
  await fsp.rm(stagingDir, { recursive: true, force: true })
}

module.exports = {
  INPUT_EXTENSIONS,
  OUTPUT_FORMATS,
  DEFAULT_SETTINGS,
  isSupportedInput,
  expandPaths,
  probeFile,
  suggestedName,
  convertToStaging,
  saveOutputs,
  discardStaging,
  resolveResizeOptions,
}
