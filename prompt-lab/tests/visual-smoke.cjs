'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { publicCapabilities } = require('../core/contract.cjs')

const screenshotPath = path.join(os.tmpdir(), 'ymi-prompt-lab-visual-smoke.png')

async function main() {
  await app.whenReady()
  ipcMain.handle('prompt-lab:boot', () => ({
    capabilities: publicCapabilities(),
    apiKeyLoaded: false,
    defaultOutputRoot: path.join(os.tmpdir(), 'YMI Prompt Lab Visual Smoke'),
  }))
  const errors = []
  const win = new BrowserWindow({
    width: 1500,
    height: 960,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
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
  })`)
  assert.equal(initial.title, 'YMI Image Prompt Lab')
  assert.equal(initial.h1, 'Image Prompt Lab')
  assert.ok(initial.bodyLength > 1000)
  assert.equal(initial.overlays, 0)
  assert.equal(initial.keyStatus, true)
  assert.ok(initial.buttons.includes('Validate / dry run'))
  assert.ok(initial.buttons.includes('Send one paid request'))

  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent.includes('Advanced controls')).click()`)
  const advanced = await win.webContents.executeJavaScript(`({
    fidelity: Array.from(document.querySelectorAll('.field-label')).some((label) => label.textContent === 'Input fidelity'),
    streaming: document.body.innerText.includes('Stream response'),
    responseFormat: document.body.innerText.includes('response_format'),
  })`)
  assert.deepEqual(advanced, { fidelity: true, streaming: true, responseFormat: true })
  assert.deepEqual(errors, [])

  const image = await win.webContents.capturePage()
  await fs.writeFile(screenshotPath, image.toPNG())
  process.stdout.write(`${JSON.stringify({ result: 'pass', screenshotPath, consoleErrors: errors.length, initial, advanced }, null, 2)}\n`)
  win.destroy()
  app.quit()
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
