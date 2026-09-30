'use strict'

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { publicCapabilities } = require('../core/contract.cjs')
const { executeImageEdit, inspectImage, prepareRequest, publicRequest } = require('../core/runner.cjs')
const { createExecuteHandler, createPreviewDataUrl, errorResult } = require('./promptLabHandlers.cjs')

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: 'YMI Image Prompt Lab',
    backgroundColor: '#0c1117',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/developers\.openai\.com\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const allowedLocal = isDev ? url.startsWith('http://127.0.0.1:5176/') : url.startsWith('file:')
    if (allowedLocal) return
    event.preventDefault()
    if (/^https:\/\/developers\.openai\.com\//.test(url)) shell.openExternal(url)
  })

  if (isDev) win.loadURL('http://127.0.0.1:5176')
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

ipcMain.handle('prompt-lab:boot', async () => ({
  capabilities: publicCapabilities(),
  apiKeyLoaded: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
  defaultOutputRoot: path.join(app.getPath('documents'), 'YMI Prompt Lab Runs'),
}))

ipcMain.handle('prompt-lab:pick-images', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose ordered image inputs',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'OpenAI image inputs', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  return result.canceled ? [] : result.filePaths
})

ipcMain.handle('prompt-lab:pick-mask', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose an optional PNG mask',
    properties: ['openFile'],
    filters: [{ name: 'PNG mask', extensions: ['png'] }],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('prompt-lab:pick-output-root', async (event, current) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Choose where Prompt Lab runs are saved',
    defaultPath: current || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('prompt-lab:inspect-image', async (_event, filePath, options) => {
  try {
    const image = await inspectImage(filePath, options)
    return {
      ok: true,
      image: {
        path: image.path,
        previewUrl: await createPreviewDataUrl(image.bytes),
        name: image.name,
        byte_count: image.byte_count,
        sha256: image.sha256,
        width: image.width,
        height: image.height,
        format: image.format,
        mime_type: image.mime_type,
        has_alpha: image.has_alpha,
      },
    }
  } catch (error) {
    return errorResult(error)
  }
})

ipcMain.handle('prompt-lab:validate', async (_event, request) => {
  try {
    const prepared = await prepareRequest(request)
    return { ok: true, request: publicRequest(prepared) }
  } catch (error) {
    return errorResult(error)
  }
})

ipcMain.handle('prompt-lab:execute', createExecuteHandler({
  prepareRequest,
  executeImageEdit,
  getApiKey: () => process.env.OPENAI_API_KEY,
  confirmRequest: async (event, prepared) => {
    const confirmed = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'warning',
      title: 'Send one paid OpenAI request?',
      message: `Send exactly one ${prepared.settings.model} image-edit request?`,
      detail: [
        `Size: ${prepared.settings.size}`,
        `Quality: ${prepared.settings.quality}`,
        `Outputs: ${prepared.settings.n}`,
        `Inputs: ${prepared.images.length}`,
        'Automatic retry: OFF',
        'If the outcome becomes unknown, the app will stop and will not resubmit.',
      ].join('\n'),
      buttons: ['Cancel', 'Send one request'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return confirmed.response === 1
  },
}))

ipcMain.handle('prompt-lab:export-config', async (event, config) => {
  const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Export Prompt Lab experiment',
    defaultPath: `${String(config?.experimentName || 'prompt-experiment').replace(/[^A-Za-z0-9_-]+/g, '-')}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  const exportValue = {
    schema_version: 1,
    exported_at: new Date().toISOString(),
    experiment_name: String(config?.experimentName || ''),
    prompt: String(config?.prompt || ''),
    settings: config?.settings || {},
  }
  await fs.writeFile(result.filePath, `${JSON.stringify(exportValue, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return result.filePath
})

ipcMain.handle('prompt-lab:import-config', async (event) => {
  const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
    title: 'Import Prompt Lab experiment',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const value = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8'))
  if (value?.schema_version !== 1 || typeof value.prompt !== 'string' || typeof value.settings !== 'object') {
    throw new Error('Unsupported Prompt Lab config file.')
  }
  return {
    experimentName: String(value.experiment_name || ''),
    prompt: value.prompt,
    settings: value.settings,
  }
})

ipcMain.handle('prompt-lab:reveal-path', (_event, target) => {
  shell.showItemInFolder(path.resolve(target))
  return true
})

ipcMain.handle('prompt-lab:open-path', async (_event, target) => {
  await shell.openPath(path.resolve(target))
  return true
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
