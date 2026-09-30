'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createHistoryStore, HISTORY_LOCATOR_FILE } = require('../electron/historyStore.cjs')

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

test('history returns only an allowlisted persistent run shape with image previews', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-history-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const evidenceRoot = path.join(root, 'evidence')
  const outputRoot = path.join(root, 'images')
  const runId = '2026-09-30_12-00-00-000_abcdef'
  const directoryName = `${runId}_cover-test_1024x1024`
  const evidenceDirectory = path.join(evidenceRoot, directoryName)
  const outputDirectory = path.join(outputRoot, directoryName)
  await fs.mkdir(evidenceDirectory, { recursive: true })
  await fs.mkdir(outputDirectory, { recursive: true })
  await fs.writeFile(path.join(outputDirectory, 'output-01.png'), Buffer.from('image'))
  await writeJson(path.join(evidenceDirectory, 'request.json'), {
    schema_version: 1,
    run_id: runId,
    created_at: '2026-09-30T12:00:00.000Z',
    experiment_name: 'Cover test',
    prompt: 'Keep the illustration and change only the face.',
    parameters: { model: 'gpt-image-test', size: '1024x1024', quality: 'medium', output_format: 'png' },
    ordered_inputs: [{ path: 'must-not-leak.png' }],
    secret_future_field: 'must-not-leak',
  })
  await writeJson(path.join(evidenceDirectory, 'evidence.json'), {
    schema_version: 1,
    result: 'success',
    run_id: runId,
    completed_at: '2026-09-30T12:00:12.000Z',
    provider_timing_ms: 12000,
    calculated_charge_usd: 0.04,
    provider_request_id: 'req_safe',
    transport_calls: 1,
    private_future_field: 'must-not-leak',
    outputs: [{ file: 'output-01.png', format: 'png', width: 1024, height: 1024, byte_count: 5, sha256: 'ABC', storage_path: 'must-not-leak' }],
    partial_outputs: [],
  })

  const registered = []
  const store = createHistoryStore({
    evidenceRoot,
    defaultOutputRoot: outputRoot,
    previewDataUrl: async (filePath) => `data:image/webp;base64,${Buffer.from(path.basename(filePath)).toString('base64')}`,
    registerRunDirectory: (directory, id) => registered.push({ directory, id }),
  })
  const history = await store.listHistory()
  assert.equal(history.length, 1)
  assert.deepEqual(Object.keys(history[0]).sort(), [
    'calculatedChargeUsd', 'completedAt', 'createdAt', 'experimentName', 'folderAvailable',
    'model', 'outputFormat', 'outputs', 'prompt', 'providerRequestId', 'providerTimingMs',
    'quality', 'result', 'runId', 'size', 'transportCalls',
  ].sort())
  assert.deepEqual(Object.keys(history[0].outputs[0]).sort(), [
    'byte_count', 'file', 'format', 'height', 'previewError', 'previewUrl', 'sha256', 'width',
  ].sort())
  assert.equal(JSON.stringify(history).includes('must-not-leak'), false)
  assert.equal(history[0].outputs[0].previewUrl.startsWith('data:image/webp;base64,'), true)
  assert.deepEqual(registered, [{ directory: outputDirectory, id: runId }])
})

test('new completed runs record their private output locator outside the image folder', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-history-record-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const evidenceRoot = path.join(root, 'evidence')
  const outputRoot = path.join(root, 'custom-images')
  const runId = '2026-09-30_12-01-00-000_abcdef'
  const evidenceDirectory = path.join(evidenceRoot, `${runId}_test_1024x1024`)
  await fs.mkdir(evidenceDirectory, { recursive: true })
  await fs.mkdir(outputRoot, { recursive: true })
  const store = createHistoryStore({
    evidenceRoot,
    defaultOutputRoot: path.join(root, 'default-images'),
    previewDataUrl: async () => null,
    registerRunDirectory: () => null,
  })
  await store.recordCompletedRun({ evidenceDirectory, outputDirectory: outputRoot, evidence: { run_id: runId } })
  const locator = JSON.parse(await fs.readFile(path.join(evidenceDirectory, HISTORY_LOCATOR_FILE), 'utf8'))
  assert.deepEqual(locator, { schema_version: 1, run_id: runId, output_directory: outputRoot })
  assert.deepEqual(await fs.readdir(outputRoot), [])
})

test('one malformed history directory does not hide healthy records', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-history-malformed-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const evidenceRoot = path.join(root, 'evidence')
  await fs.mkdir(path.join(evidenceRoot, 'bad-record'), { recursive: true })
  await fs.writeFile(path.join(evidenceRoot, 'bad-record', 'request.json'), '{not-json', 'utf8')
  const store = createHistoryStore({
    evidenceRoot,
    defaultOutputRoot: path.join(root, 'images'),
    previewDataUrl: async () => null,
    registerRunDirectory: () => null,
  })
  assert.deepEqual(await store.listHistory(), [])
})
