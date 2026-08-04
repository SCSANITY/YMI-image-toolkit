const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const ops = require('./imageOps.cjs')

const isDev = !app.isPackaged

// Converted images live here for the length of the session and are downloaded from here
// on demand. Cleared on quit — the user is warned first if anything is still unsaved.
const STAGING_ROOT = path.join(os.tmpdir(), 'ymi-image-toolkit-staging')
let slotCounter = 0

let unsavedCount = 0
let allowClose = false

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1060,
    minHeight: 700,
    // Frameless: the app draws its own title bar so the shell reads as one continuous
    // pane of glass. Windows still supplies resize borders and rounded corners.
    frame: false,
    // Transparent base + acrylic gives the window real glass over the desktop; the page
    // paints its own dark tint on top so contrast never depends on the wallpaper.
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const sendState = () => win.webContents.send('window-state', { maximized: win.isMaximized() })
  win.on('maximize', sendState)
  win.on('unmaximize', sendState)

  win.on('close', (event) => {
    if (allowClose || unsavedCount === 0) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close anyway', 'Keep working'],
      defaultId: 1,
      cancelId: 1,
      title: 'Unsaved conversions',
      message: `${unsavedCount} converted image${unsavedCount === 1 ? '' : 's'} not downloaded yet.`,
      detail: 'Converted images are held temporarily and are deleted when the app closes.',
      noLink: true,
    })
    if (choice === 0) {
      allowClose = true
      win.close()
    }
  })

  if (isDev) {
    win.loadURL('http://127.0.0.1:5175')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
  return win
}

// ── IPC ───────────────────────────────────────────────────────────────────────
// Every handler returns a plain serialisable object. Failures come back as
// { ok: false, error } rather than throwing across the bridge, so the renderer has one
// uniform result shape to render.

function fail(error) {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

/**
 * The pipeline owns the settings contract; the UI renders whatever it is told here.
 * Keeping this on one side avoids two drifting copies of "what the defaults are".
 */
ipcMain.handle('get-defaults', () => ({
  settings: ops.DEFAULT_SETTINGS,
  outputFormats: ops.OUTPUT_FORMATS,
  inputExtensions: [...ops.INPUT_EXTENSIONS],
}))

// ── window chrome (frameless) ─────────────────────────────────────────────────

ipcMain.on('window-minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize())
ipcMain.on('window-maximize-toggle', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  if (win.isMaximized()) win.unmaximize()
  else win.maximize()
})
ipcMain.on('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close())
ipcMain.on('set-unsaved-count', (_event, count) => { unsavedCount = Number(count) || 0 })

// ── input ─────────────────────────────────────────────────────────────────────

ipcMain.handle('pick-files', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: 'Add images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tif', 'tiff'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('pick-directory', async (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win, {
    title: title || 'Choose folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('expand-paths', async (_event, paths) => {
  try {
    return { ok: true, paths: await ops.expandPaths(paths || []) }
  } catch (e) {
    return fail(e)
  }
})

ipcMain.handle('probe-file', async (_event, filePath) => {
  try {
    return { ok: true, file: await ops.probeFile(filePath) }
  } catch (e) {
    return fail(e)
  }
})

// ── convert into staging, download on demand ─────────────────────────────────

ipcMain.handle('convert-to-staging', async (_event, filePath, settings) => {
  try {
    slotCounter += 1
    return { ok: true, result: await ops.convertToStaging(filePath, settings, STAGING_ROOT, slotCounter) }
  } catch (e) {
    return fail(e)
  }
})

/**
 * Ask where converted images should go. One file gets a Save-As dialog (name included),
 * several get a folder picker — never a dialog per image.
 */
ipcMain.handle('choose-destination', async (event, request) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const defaultDir = request.defaultDir || app.getPath('pictures')

  if (request.count === 1) {
    const spec = ops.OUTPUT_FORMATS[request.format] || { ext: 'webp' }
    const result = await dialog.showSaveDialog(win, {
      title: 'Download converted image',
      defaultPath: path.join(defaultDir, request.suggestedName),
      filters: [{ name: `${String(request.format).toUpperCase()} image`, extensions: [spec.ext] }],
    })
    if (result.canceled || !result.filePath) return null
    return { mode: 'file', filePath: result.filePath, dir: path.dirname(result.filePath) }
  }

  const result = await dialog.showOpenDialog(win, {
    title: `Download ${request.count} converted images to…`,
    buttonLabel: 'Download here',
    defaultPath: defaultDir,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  return { mode: 'directory', dir: result.filePaths[0] }
})

ipcMain.handle('save-outputs', async (_event, items, destination, options) => {
  try {
    return { ok: true, results: await ops.saveOutputs(items, destination, options) }
  } catch (e) {
    return fail(e)
  }
})

/** Drop staged files for rows the user removed, so temp does not grow all session. */
ipcMain.handle('discard-staged', async (_event, stagedPaths) => {
  await Promise.all(
    (stagedPaths || []).map((p) =>
      // Each staged file owns its slot folder; removing that folder removes the file.
      fsp.rm(path.dirname(p), { recursive: true, force: true }).catch(() => {})
    )
  )
  return true
})

ipcMain.handle('reveal-path', (_event, target) => {
  shell.showItemInFolder(path.normalize(target))
  return true
})

ipcMain.handle('open-path', async (_event, target) => {
  await shell.openPath(path.normalize(target))
  return true
})

// ── lifecycle ─────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Anything left behind by a crash or a force-quit is dead weight; clear it on start.
  await fsp.rm(STAGING_ROOT, { recursive: true, force: true }).catch(() => {})
  await fsp.mkdir(STAGING_ROOT, { recursive: true })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  try {
    fs.rmSync(STAGING_ROOT, { recursive: true, force: true })
  } catch {
    // A locked temp folder is not worth blocking quit over; startup clears it next time.
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
