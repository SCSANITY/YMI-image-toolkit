'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const sharp = require('sharp')
const {
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_DIMENSION,
  createExecuteHandler,
  createPreviewDataUrl,
  errorResult,
} = require('../electron/promptLabHandlers.cjs')

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

test('preview helper returns a bounded decodable data URL instead of file URL', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-preview-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source.png')
  await sharp({
    create: { width: 1600, height: 1200, channels: 4, background: { r: 40, g: 90, b: 140, alpha: 1 } },
  }).png().toFile(source)

  const previewUrl = await createPreviewDataUrl(source)
  assert.match(previewUrl, /^data:image\/webp;base64,/)
  const bytes = Buffer.from(previewUrl.split(',')[1], 'base64')
  assert.ok(bytes.length <= PREVIEW_MAX_BYTES)
  const metadata = await sharp(bytes).metadata()
  assert.ok(metadata.width <= PREVIEW_MAX_DIMENSION)
  assert.ok(metadata.height <= PREVIEW_MAX_DIMENSION)
})

test('real execute handler atomically admits one overlapping call and one transport', async () => {
  const confirmation = deferred()
  const transport = deferred()
  let transportCalls = 0
  const handler = createExecuteHandler({
    prepareRequest: async () => ({ settings: { model: 'test-model' }, images: [] }),
    confirmRequest: async () => confirmation.promise,
    getApiKey: () => 'sk-test',
    executeImageEdit: async () => {
      transportCalls += 1
      await transport.promise
      return {
        runDirectory: 'unused',
        evidence: { outputs: [], partial_outputs: [] },
      }
    },
  })

  const first = handler({ sender: {} }, { prompt: 'first' })
  const overlappingDuringConfirmation = await handler({ sender: {} }, { prompt: 'second' })
  assert.equal(overlappingDuringConfirmation.error.code, 'request_in_flight')

  confirmation.resolve(true)
  await new Promise((resolve) => setImmediate(resolve))
  const overlappingDuringTransport = await handler({ sender: {} }, { prompt: 'third' })
  assert.equal(overlappingDuringTransport.error.code, 'request_in_flight')

  transport.resolve()
  assert.equal((await first).ok, true)
  assert.equal(transportCalls, 1)
})

test('a missing local preview does not turn a completed provider request into a second-request error', async () => {
  const handler = createExecuteHandler({
    prepareRequest: async () => ({ settings: { model: 'test-model' }, images: [] }),
    confirmRequest: async () => true,
    getApiKey: () => 'sk-test',
    registerRunDirectory: () => '2026-09-30_10-22-34-259_b53ea7',
    previewDataUrl: async () => {
      const error = new Error('missing output')
      error.code = 'ENOENT'
      throw error
    },
    executeImageEdit: async () => ({
      runDirectory: path.join(os.tmpdir(), 'missing-prompt-lab-run'),
      request: { endpoint: 'test' },
      response: { http_status: 200 },
      evidence: {
        run_id: '2026-09-30_10-22-34-259_b53ea7',
        outputs: [{ file: 'output-01.png', width: 1024, height: 1024, byte_count: 1, sha256: 'A' }],
        partial_outputs: [],
      },
    }),
  })

  const response = await handler({ sender: {} }, { prompt: 'test' })
  assert.equal(response.ok, true)
  assert.equal(response.result.localArtifactsAvailable, false)
  assert.equal(response.result.outputs[0].previewUrl, null)
  assert.equal(response.result.outputs[0].previewError, 'local_preview_unavailable')
})

test('error responses claim saved evidence only when the runner proved it', () => {
  assert.equal(errorResult(Object.assign(new Error('saved'), { evidenceSaved: true }), { runId: 'run-saved' }).error.evidenceSaved, true)
  assert.equal(errorResult(new Error('not saved'), { runId: 'run-missing' }).error.evidenceSaved, false)
})
