'use strict'

const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { publicCapabilities } = require('../core/contract.cjs')
const { executeImageEdit, inspectImage, prepareRequest, publicRequest } = require('../core/runner.cjs')
const { createApiKeyStore } = require('./apiKeyStore.cjs')
const { createExecuteHandler, createPreviewDataUrl, errorResult } = require('./promptLabHandlers.cjs')
const { createRunRegistry } = require('./runRegistry.cjs')

const isDev = !app.isPackaged
const devEntryUrl = 'http://127.0.0.1:5176/'
const packagedEntryPath = path.join(__dirname, '..', 'dist', 'index.html')
const packagedEntryUrl = pathToFileURL(packagedEntryPath).href
let sessionApiKey = String(process.env.OPENAI_API_KEY || '').trim()
delete process.env.OPENAI_API_KEY

app.enableSandbox()

let mainWindow = null
let apiKeyStore = null
const runRegistry = createRunRegistry()

function isAllowedNavigation(url) {
  try {
    const candidate = new URL(url)
    candidate.hash = ''
    return candidate.href === (isDev ? devEntryUrl : packagedEntryUrl)
  } catch {
    return false
  }
}

function assertTrustedEvent(event) {
  if (
    !mainWindow
    || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame
    || !isAllowedNavigation(event.senderFrame.url)
  ) {
    throw Object.assign(new Error('Prompt Lab rejected an untrusted renderer request.'), {
      code: 'untrusted_renderer',
    })
  }
}

async function apiKeyStatus() {
  const stored = await apiKeyStore.status()
  if (stored.configured && stored.readable) return stored
  if (sessionApiKey) return { configured: true, readable: true, source: 'session', errorCode: null }
  return stored
}

async function loadApiKey() {
  try {
    const stored = await apiKeyStore.load()
    if (stored) return stored
  } catch (error) {
    if (!sessionApiKey) throw error
  }
  return sessionApiKey || null
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: 'YMI Image Prompt Lab',
    backgroundColor: '#f8f1e8',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/developers\.openai\.com\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url)) return
    event.preventDefault()
    if (/^https:\/\/developers\.openai\.com\//.test(url)) shell.openExternal(url)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  if (isDev) win.loadURL(devEntryUrl)
  else win.loadFile(packagedEntryPath)
  return win
}

function registerIpcHandlers() {
  ipcMain.handle('prompt-lab:boot', async (event) => {
    assertTrustedEvent(event)
    const status = await apiKeyStatus()
    return {
      capabilities: publicCapabilities(),
      apiKeyLoaded: status.configured && status.readable,
      apiKeyStatus: status,
      defaultOutputRoot: path.join(app.getPath('documents'), 'YMI Prompt Lab Images'),
    }
  })

  ipcMain.handle('prompt-lab:api-key-status', async (event) => {
    assertTrustedEvent(event)
    return apiKeyStatus()
  })

  ipcMain.handle('prompt-lab:save-api-key', async (event, value) => {
    assertTrustedEvent(event)
    const status = await apiKeyStore.save(value)
    sessionApiKey = ''
    return status
  })

  ipcMain.handle('prompt-lab:remove-api-key', async (event) => {
    assertTrustedEvent(event)
    const confirmed = await dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
      type: 'warning',
      title: 'Remove saved API key?',
      message: 'Remove the saved OpenAI API key from this Windows account?',
      detail: 'Prompt Lab will not be able to send requests until a new key is saved.',
      buttons: ['Cancel', 'Remove key'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (confirmed.response !== 1) return { removed: false, status: await apiKeyStatus() }
    sessionApiKey = ''
    return { removed: true, status: await apiKeyStore.remove() }
  })

  ipcMain.handle('prompt-lab:pick-images', async (event) => {
    assertTrustedEvent(event)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose ordered image inputs',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'OpenAI image inputs', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('prompt-lab:pick-mask', async (event) => {
    assertTrustedEvent(event)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose an optional PNG mask',
      properties: ['openFile'],
      filters: [{ name: 'PNG mask', extensions: ['png'] }],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('prompt-lab:pick-output-root', async (event, current) => {
    assertTrustedEvent(event)
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Choose where Prompt Lab runs are saved',
      defaultPath: current || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('prompt-lab:inspect-image', async (event, filePath, options) => {
    assertTrustedEvent(event)
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

  ipcMain.handle('prompt-lab:validate', async (event, request) => {
    assertTrustedEvent(event)
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
    getApiKey: loadApiKey,
    getEvidenceRoot: () => path.join(app.getPath('userData'), 'prompt-lab-run-records'),
    registerRunDirectory: runRegistry.register,
    confirmRequest: async (event, prepared) => {
      assertTrustedEvent(event)
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
    assertTrustedEvent(event)
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
    assertTrustedEvent(event)
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

  ipcMain.handle('prompt-lab:open-run-folder', async (event, runId) => {
    assertTrustedEvent(event)
    const target = runRegistry.resolve(runId)
    const result = await shell.openPath(target)
    if (result) throw Object.assign(new Error('The run folder could not be opened.'), { code: 'run_folder_open_failed' })
    return true
  })
}

app.whenReady().then(() => {
  apiKeyStore = createApiKeyStore({ safeStorage, userDataPath: app.getPath('userData') })
  registerIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
