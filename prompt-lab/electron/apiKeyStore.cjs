'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const API_KEY_FILE_NAME = 'openai-api-key.v1.enc.json'
const API_KEY_MAX_LENGTH = 512

function keyStoreError(code, message, cause) {
  return Object.assign(new Error(message), { code, cause })
}

function normalizeApiKey(value) {
  const apiKey = String(value || '').trim()
  if (apiKey.length < 20 || apiKey.length > API_KEY_MAX_LENGTH || /[\s\u0000-\u001f]/.test(apiKey)) {
    throw keyStoreError('openai_api_key_invalid', 'Enter a valid OpenAI API key without spaces.')
  }
  return apiKey
}

function createApiKeyStore({ safeStorage, userDataPath, fsImpl = fs }) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw keyStoreError('api_key_store_unavailable', 'Windows secure storage is unavailable.')
  }

  const filePath = path.join(userDataPath, API_KEY_FILE_NAME)

  function assertEncryptionAvailable() {
    if (!safeStorage.isEncryptionAvailable()) {
      throw keyStoreError(
        'api_key_encryption_unavailable',
        'Windows account encryption is not available. Restart the app after signing in to Windows.',
      )
    }
  }

  async function readEnvelope() {
    let text
    try {
      text = await fsImpl.readFile(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw keyStoreError('api_key_store_unreadable', 'The saved API key could not be read.', error)
    }

    let envelope
    try {
      envelope = JSON.parse(text)
    } catch (error) {
      throw keyStoreError('api_key_store_unreadable', 'The saved API key record is damaged.', error)
    }
    if (
      envelope?.schemaVersion !== 1
      || typeof envelope.ciphertextBase64 !== 'string'
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertextBase64)
    ) {
      throw keyStoreError('api_key_store_unreadable', 'The saved API key record has an unsupported format.')
    }
    return envelope
  }

  async function load() {
    const envelope = await readEnvelope()
    if (!envelope) return null
    assertEncryptionAvailable()
    try {
      return normalizeApiKey(safeStorage.decryptString(Buffer.from(envelope.ciphertextBase64, 'base64')))
    } catch (error) {
      if (error?.code === 'openai_api_key_invalid') throw error
      throw keyStoreError(
        'api_key_store_unreadable',
        'The saved API key cannot be decrypted by this Windows account.',
        error,
      )
    }
  }

  async function status() {
    let envelope
    try {
      envelope = await readEnvelope()
    } catch (error) {
      return { configured: true, readable: false, source: 'encrypted', errorCode: error.code }
    }
    if (!envelope) return { configured: false, readable: true, source: null, errorCode: null }
    try {
      await load()
      return { configured: true, readable: true, source: 'encrypted', errorCode: null }
    } catch (error) {
      return { configured: true, readable: false, source: 'encrypted', errorCode: error.code }
    }
  }

  async function save(value) {
    const apiKey = normalizeApiKey(value)
    assertEncryptionAvailable()
    let encrypted
    try {
      encrypted = safeStorage.encryptString(apiKey)
    } catch (error) {
      throw keyStoreError('api_key_encryption_failed', 'The API key could not be encrypted.', error)
    }
    const envelope = `${JSON.stringify({
      schemaVersion: 1,
      ciphertextBase64: Buffer.from(encrypted).toString('base64'),
    }, null, 2)}\n`
    await fsImpl.mkdir(userDataPath, { recursive: true })
    const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`
    try {
      await fsImpl.writeFile(temporaryPath, envelope, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      await fsImpl.rm(filePath, { force: true })
      await fsImpl.rename(temporaryPath, filePath)
    } catch (error) {
      throw keyStoreError('api_key_store_write_failed', 'The encrypted API key could not be saved.', error)
    } finally {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => {})
    }
    return status()
  }

  async function remove() {
    try {
      await fsImpl.rm(filePath, { force: true })
    } catch (error) {
      throw keyStoreError('api_key_store_remove_failed', 'The saved API key could not be removed.', error)
    }
    return status()
  }

  return { load, remove, save, status }
}

module.exports = {
  API_KEY_FILE_NAME,
  createApiKeyStore,
  normalizeApiKey,
}
