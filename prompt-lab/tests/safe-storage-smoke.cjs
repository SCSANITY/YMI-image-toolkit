'use strict'

const { app, safeStorage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { API_KEY_FILE_NAME, createApiKeyStore } = require('../electron/apiKeyStore.cjs')

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-safe-storage-'))
  app.setPath('userData', root)
  try {
    await app.whenReady()
    assert.equal(safeStorage.isEncryptionAvailable(), true)
    const store = createApiKeyStore({ safeStorage, userDataPath: app.getPath('userData') })
    const secret = 'sk-proj-electron-safe-storage-smoke-1234567890'
    await store.save(secret)
    assert.equal(await store.load(), secret)
    const diskText = await fs.readFile(path.join(root, API_KEY_FILE_NAME), 'utf8')
    assert.doesNotMatch(diskText, new RegExp(secret))
    await store.remove()
    assert.equal(await store.load(), null)
    process.stdout.write(`${JSON.stringify({ result: 'pass', encryptionAvailable: true, plaintextOnDisk: false })}\n`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    app.quit()
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`)
  app.exit(1)
})
