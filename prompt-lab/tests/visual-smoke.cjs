'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const sharp = require('sharp')
const { publicCapabilities } = require('../core/contract.cjs')
const { inspectImage } = require('../core/runner.cjs')
const { createPreviewDataUrl } = require('../electron/promptLabHandlers.cjs')

const screenshotPath = path.join(os.tmpdir(), 'ymi-prompt-lab-visual-smoke.png')

app.enableSandbox()

async function main() {
  await app.whenReady()
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-visual-'))
  const fixturePath = path.join(fixtureRoot, 'visual-input.png')
  await sharp({
    create: { width: 900, height: 600, channels: 4, background: { r: 33, g: 120, b: 164, alpha: 1 } },
  }).png().toFile(fixturePath)
  const historyPreviewUrl = await createPreviewDataUrl(fixturePath)
  ipcMain.handle('prompt-lab:boot', () => ({
    capabilities: publicCapabilities(),
    apiKeyLoaded: false,
    apiKeyStatus: { configured: false, readable: true, source: null, errorCode: null },
    defaultOutputRoot: path.join(os.tmpdir(), 'YMI Prompt Lab Visual Smoke'),
  }))
  ipcMain.handle('prompt-lab:pick-images', () => [fixturePath])
  ipcMain.handle('prompt-lab:list-history', () => [{
    runId: '2026-09-30_12-00-00-000_abcdef',
    createdAt: '2026-09-30T12:00:00.000Z',
    completedAt: '2026-09-30T12:00:12.000Z',
    experimentName: 'Visual history fixture',
    prompt: 'Visual smoke prompt',
    result: 'success',
    model: 'gpt-image-test',
    size: '1024x1024',
    quality: 'medium',
    outputFormat: 'png',
    providerTimingMs: 12000,
    calculatedChargeUsd: 0.04,
    providerRequestId: 'req_visual',
    transportCalls: 1,
    folderAvailable: false,
    outputs: [{ file: 'output-01.png', format: 'png', width: 900, height: 600, byte_count: 1, sha256: 'ABC', previewUrl: historyPreviewUrl, previewError: null }],
  }])
  ipcMain.handle('prompt-lab:inspect-image', async (_event, filePath, options) => {
    const inspected = await inspectImage(filePath, options)
    return {
      ok: true,
      image: {
        path: inspected.path,
        previewUrl: await createPreviewDataUrl(inspected.bytes),
        name: inspected.name,
        byte_count: inspected.byte_count,
        sha256: inspected.sha256,
        width: inspected.width,
        height: inspected.height,
        format: inspected.format,
        mime_type: inspected.mime_type,
        has_alpha: inspected.has_alpha,
      },
    }
  })
  const errors = []
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.on('console-message', (details) => {
    if (details?.level === 'error') errors.push(details.message)
  })
  await win.loadURL('http://127.0.0.1:5176')
  await new Promise((resolve) => setTimeout(resolve, 450))

  const initial = await win.webContents.executeJavaScript(`({
    title: document.title,
    bodyLength: document.body.innerText.trim().length,
    h1: document.querySelector('h1')?.textContent,
    buttons: Array.from(document.querySelectorAll('button')).map((button) => button.textContent.trim()),
    overlays: document.querySelectorAll('.vite-error-overlay').length,
    keyStatus: document.body.innerText.includes('API key missing'),
    keyInput: document.querySelector('input[aria-label="OpenAI API key"]')?.type,
    sizeOptions: Array.from(document.querySelector('select[aria-label="Size preset"]')?.options || []).map((option) => option.value),
    workspaceColumns: getComputedStyle(document.querySelector('.creative-workspace')).gridTemplateColumns.split(' ').length,
    backgroundColor: getComputedStyle(document.body).backgroundColor,
    imageOnlyCopy: document.body.innerText.includes('Images-only output') && document.body.innerText.includes('containing images only'),
    canvasVisible: Boolean(document.querySelector('.result-canvas')),
    historyVisible: document.body.innerText.includes('Recent generations') && document.body.innerText.includes('Visual history fixture'),
    canvasAspectRatio: getComputedStyle(document.querySelector('.result-canvas')).aspectRatio,
    resultObjectFit: getComputedStyle(document.querySelector('.result-canvas > img') || document.createElement('img')).objectFit,
  })`)
  assert.equal(initial.title, 'YMI Image Prompt Lab')
  assert.equal(initial.h1, 'Image Prompt Lab')
  assert.ok(initial.bodyLength > 1000)
  assert.equal(initial.overlays, 0)
  assert.equal(initial.keyStatus, true)
  assert.equal(initial.keyInput, 'password')
  assert.deepEqual(initial.sizeOptions, ['1024x1024', '2048x2048', '1536x1024', '1024x1536', 'auto', 'custom'])
  assert.equal(initial.workspaceColumns, 3)
  assert.notEqual(initial.backgroundColor, 'rgb(10, 15, 21)')
  assert.equal(initial.imageOnlyCopy, true)
  assert.equal(initial.canvasVisible, true)
  assert.equal(initial.historyVisible, true)
  assert.equal(initial.canvasAspectRatio, '1 / 1')
  assert.ok(initial.buttons.includes('Validate / dry run'))
  assert.ok(initial.buttons.includes('Send one paid request'))

  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.trim() === '+ Add').click()`)
  const inputPreview = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      const image = document.querySelector('.input-card img')
      if (image?.complete && image.naturalWidth > 0) {
        resolve({ srcPrefix: image.src.slice(0, 32), naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight })
        return
      }
      if (Date.now() - started > 5000) {
        reject(new Error('input_preview_did_not_render'))
        return
      }
      setTimeout(check, 50)
    }
    check()
  })`)
  assert.match(inputPreview.srcPrefix, /^data:image\/webp;base64,/)
  assert.ok(inputPreview.naturalWidth > 0)
  assert.ok(inputPreview.naturalHeight > 0)

  await win.webContents.executeJavaScript(`document.querySelector('.history-card').click()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const historyResult = await win.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.result-canvas')
    const image = canvas.querySelector('img')
    const canvasRect = canvas.getBoundingClientRect()
    return {
      objectFit: getComputedStyle(image).objectFit,
      canvasWidth: Math.round(canvasRect.width),
      canvasHeight: Math.round(canvasRect.height),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      runDetailsAvailable: document.body.innerText.includes('Run details'),
    }
  })()`)
  assert.equal(historyResult.objectFit, 'contain')
  assert.equal(historyResult.canvasWidth, historyResult.canvasHeight)
  assert.ok(historyResult.canvasWidth <= 442)
  assert.deepEqual([historyResult.naturalWidth, historyResult.naturalHeight], [768, 512])
  assert.equal(historyResult.runDetailsAvailable, true)

  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Advanced controls')).click()`)
  const advanced = await win.webContents.executeJavaScript(`({
    fidelity: Array.from(document.querySelectorAll('.field-label')).some((label) => label.textContent === 'Input fidelity'),
    streaming: document.body.innerText.includes('Stream response'),
    responseFormat: document.body.innerText.includes('response_format'),
  })`)
  assert.deepEqual(advanced, { fidelity: true, streaming: true, responseFormat: true })
  assert.deepEqual(errors, [])

  await win.webContents.executeJavaScript(`document.querySelector('.input-card').scrollIntoView({ block: 'center' })`)
  await new Promise((resolve) => setTimeout(resolve, 100))

  const image = await win.webContents.capturePage()
  await fs.writeFile(screenshotPath, image.toPNG())
  process.stdout.write(`${JSON.stringify({ result: 'pass', screenshotPath, consoleErrors: errors.length, initial, inputPreview, historyResult, advanced }, null, 2)}\n`)
  win.destroy()
  await fs.rm(fixtureRoot, { recursive: true, force: true })
  app.quit()
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
