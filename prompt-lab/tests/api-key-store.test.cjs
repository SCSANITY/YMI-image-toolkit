'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { API_KEY_FILE_NAME, createApiKeyStore, normalizeApiKey } = require('../electron/apiKeyStore.cjs')

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8').map((byte) => byte ^ 0xa5),
    decryptString: (value) => Buffer.from(value).map((byte) => byte ^ 0xa5).toString('utf8'),
  }
}

test('encrypted key store saves, reuses, replaces and removes without plaintext on disk', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-key-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const store = createApiKeyStore({ safeStorage: fakeSafeStorage(), userDataPath: root })
  const first = 'sk-proj-test-first-value-1234567890'
  const replacement = 'sk-proj-test-replacement-value-0987654321'

  assert.deepEqual(await store.status(), { configured: false, readable: true, source: null, errorCode: null })
  assert.deepEqual(await store.save(first), { configured: true, readable: true, source: 'encrypted', errorCode: null })
  assert.equal(await store.load(), first)
  assert.doesNotMatch(await fs.readFile(path.join(root, API_KEY_FILE_NAME), 'utf8'), new RegExp(first))

  await store.save(replacement)
  assert.equal(await store.load(), replacement)
  assert.doesNotMatch(await fs.readFile(path.join(root, API_KEY_FILE_NAME), 'utf8'), new RegExp(replacement))

  assert.deepEqual(await store.remove(), { configured: false, readable: true, source: null, errorCode: null })
  assert.equal(await store.load(), null)
})

test('key validation rejects empty, whitespace and implausible values', () => {
  assert.throws(() => normalizeApiKey(''), (error) => error.code === 'openai_api_key_invalid')
  assert.throws(() => normalizeApiKey('sk-short'), (error) => error.code === 'openai_api_key_invalid')
  assert.throws(() => normalizeApiKey('sk-proj-invalid key-with-space-123456'), (error) => error.code === 'openai_api_key_invalid')
})

test('damaged encrypted record fails closed but remains replaceable or removable', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-key-corrupt-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, API_KEY_FILE_NAME), '{not-json', 'utf8')
  const store = createApiKeyStore({ safeStorage: fakeSafeStorage(), userDataPath: root })

  assert.deepEqual(await store.status(), {
    configured: true,
    readable: false,
    source: 'encrypted',
    errorCode: 'api_key_store_unreadable',
  })
  await assert.rejects(() => store.load(), (error) => error.code === 'api_key_store_unreadable')
  await store.save('sk-proj-recovered-value-1234567890')
  assert.equal((await store.status()).readable, true)
})
