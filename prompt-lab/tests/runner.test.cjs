'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const sharp = require('sharp')
const {
  appendTextFields,
  calculateChargeUsd,
  executeImageEdit,
  parseSse,
  prepareRequest,
  publicRequest,
  readBoundedFile,
} = require('../core/runner.cjs')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ymi-prompt-lab-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const illustration = path.join(root, 'illustration.png')
  const identity = path.join(root, 'identity.jpg')
  const mask = path.join(root, 'mask.png')
  const outputRoot = path.join(root, 'visible-images')
  const evidenceRoot = path.join(root, 'internal-evidence')
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 20, g: 60, b: 90, alpha: 1 } } }).png().toFile(illustration)
  await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 210, g: 180, b: 140 } } }).jpeg().toFile(identity)
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(mask)
  const output = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 80, g: 120, b: 160, alpha: 1 } } }).png().toBuffer()
  return { root, illustration, identity, mask, output, outputRoot, evidenceRoot }
}

function successPayload(output) {
  return {
    created: 1,
    background: 'opaque',
    output_format: 'png',
    quality: 'medium',
    size: '1024x1024',
    usage: {
      input_tokens: 30,
      input_tokens_details: { text_tokens: 10, image_tokens: 20 },
      output_tokens: 30,
      total_tokens: 60,
    },
    data: [{ b64_json: output.toString('base64') }],
  }
}

test('file size is rejected from metadata before bytes are read', async () => {
  let reads = 0
  const fsImpl = {
    stat: async () => ({ isFile: () => true, size: 10_000 }),
    readFile: async () => { reads += 1; return Buffer.alloc(10_000) },
  }
  await assert.rejects(
    () => readBoundedFile('oversized.png', 10_000, { fsImpl }),
    (error) => error.code === 'invalid_image_size',
  )
  assert.equal(reads, 0)
})

test('prepareRequest validates ordered inputs and mask without sending', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareRequest({
    prompt: 'Keep the illustration and replace only the face.',
    settings: {},
    imagePaths: [f.illustration, f.identity],
    maskPath: f.mask,
  })
  assert.equal(prepared.images.length, 2)
  assert.equal(prepared.images[0].name, 'illustration.png')
  assert.equal(prepared.images[1].name, 'identity.jpg')
  assert.equal(prepared.mask.has_alpha, true)
  const summary = publicRequest(prepared)
  assert.equal(summary.automatic_retry, false)
  assert.equal(summary.maximum_concurrency, 1)
  assert.equal('bytes' in summary.ordered_inputs[0], false)
})

test('mask must match the first input image dimensions', async (t) => {
  const f = await fixture(t)
  const wrongMask = path.join(f.root, 'wrong-mask.png')
  await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(wrongMask)
  await assert.rejects(() => prepareRequest({ prompt: 'edit', settings: {}, imagePaths: [f.illustration], maskPath: wrongMask }), /dimensions must match/)
})

test('multipart sends the complete selected API controls and omits inapplicable fields', async (t) => {
  const f = await fixture(t)
  const prepared = await prepareRequest({
    prompt: 'edit',
    settings: { stream: true, partial_images: 2, output_format: 'webp', output_compression: 72, input_fidelity: 'high', user: 'test-user' },
    imagePaths: [f.illustration, f.identity],
  })
  const form = appendTextFields(new FormData(), prepared)
  assert.equal(form.get('model'), 'gpt-image-2.5-flare-2026-09-08')
  assert.equal(form.getAll('image[]').length, 2)
  assert.equal(form.get('stream'), 'true')
  assert.equal(form.get('partial_images'), '2')
  assert.equal(form.get('output_compression'), '72')
  assert.equal(form.get('input_fidelity'), 'high')
  assert.equal(form.get('user'), 'test-user')

  const defaultPrepared = await prepareRequest({ prompt: 'edit', settings: {}, imagePaths: [f.illustration] })
  const defaultForm = appendTextFields(new FormData(), defaultPrepared)
  assert.equal(defaultForm.has('partial_images'), false)
  assert.equal(defaultForm.has('output_compression'), false)
  assert.equal(defaultForm.has('input_fidelity'), false)
  assert.equal(defaultForm.has('response_format'), false)
})

test('successful JSON execution makes exactly one call and writes sanitized evidence', async (t) => {
  const f = await fixture(t)
  let calls = 0
  let requestInit
  const secret = 'sk-test-secret-value'
  const result = await executeImageEdit({
    prompt: 'edit exactly one face',
    settings: {},
    imagePaths: [f.illustration, f.identity],
    outputRoot: f.outputRoot,
    evidenceRoot: f.evidenceRoot,
    experimentName: 'success',
    apiKey: secret,
    fetchImpl: async (_url, init) => {
      calls += 1
      requestInit = init
      return new Response(JSON.stringify(successPayload(f.output)), { status: 200, headers: { 'x-request-id': 'req_test_123' } })
    },
  })
  assert.equal(calls, 1)
  assert.match(requestInit.headers.Authorization, /^Bearer /)
  assert.equal(result.evidence.transport_calls, 1)
  assert.equal(result.evidence.provider_request_id, 'req_test_123')
  assert.equal(result.evidence.calculated_charge_usd, 0.00111)
  assert.equal(result.evidence.outputs[0].width, 1024)
  assert.equal(result.evidence.outputs[0].height, 1024)
  assert.deepEqual(await fs.readdir(result.outputDirectory), ['output-01.png'])
  const evidenceFiles = await fs.readdir(result.evidenceDirectory)
  assert.deepEqual(evidenceFiles.sort(), ['REQUEST_STARTED.json', 'evidence.json', 'request.json', 'response.json'])
  for (const file of evidenceFiles) {
    assert.doesNotMatch(await fs.readFile(path.join(result.evidenceDirectory, file), 'utf8'), new RegExp(secret))
  }
})

test('a missing run directory is rebuilt locally after the provider result without another request', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const result = await executeImageEdit({
    prompt: 'edit exactly one face',
    settings: {},
    imagePaths: [f.illustration, f.identity],
    outputRoot: f.outputRoot,
    evidenceRoot: f.evidenceRoot,
    experimentName: 'recover-missing-directory',
    apiKey: 'sk-test',
    fetchImpl: async () => {
      calls += 1
      const runFolder = (await fs.readdir(f.evidenceRoot, { withFileTypes: true }))
        .find((entry) => entry.isDirectory())
      assert.ok(runFolder)
      await fs.rm(path.join(f.evidenceRoot, runFolder.name), { recursive: true, force: true })
      return new Response(JSON.stringify(successPayload(f.output)), {
        status: 200,
        headers: { 'x-request-id': 'req_recovered_locally' },
      })
    },
  })

  assert.equal(calls, 1)
  assert.equal(result.evidence.local_evidence_recovery, 'recreated_missing_evidence_directory')
  assert.deepEqual((await fs.readdir(result.evidenceDirectory)).sort(), [
    'REQUEST_STARTED.json',
    'evidence.json',
    'request.json',
    'response.json',
  ])
  assert.deepEqual(await fs.readdir(result.outputDirectory), ['output-01.png'])
})

test('HTTP 503 is conclusively rejected after one call and never retried', async (t) => {
  const f = await fixture(t)
  let calls = 0
  let evidenceDirectory
  await assert.rejects(
    () => executeImageEdit({
      prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
      experimentName: '503', apiKey: 'sk-test',
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({ error: { code: 'server_error', type: 'server_error', message: 'Temporarily unavailable' } }), { status: 503 })
      },
    }),
    (error) => {
      evidenceDirectory = error.evidenceDirectory
      return error.code === 'openai_request_rejected' && error.disposition === 'conclusively_rejected'
    },
  )
  assert.equal(calls, 1)
  await assert.rejects(fs.access(f.outputRoot), (error) => error.code === 'ENOENT')
  assert.ok((await fs.readdir(evidenceDirectory)).includes('evidence.json'))
})

test('transport failure is outcome_unknown after one call and never retried', async (t) => {
  const f = await fixture(t)
  let calls = 0
  let evidenceDirectory
  await assert.rejects(
    () => executeImageEdit({
      prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
      experimentName: 'timeout', apiKey: 'sk-test',
      fetchImpl: async () => { calls += 1; throw new Error('simulated transport timeout') },
    }),
    (error) => { evidenceDirectory = error.evidenceDirectory; return error.code === 'openai_outcome_unknown' && error.disposition === 'outcome_unknown' },
  )
  assert.equal(calls, 1)
  const evidence = JSON.parse(await fs.readFile(path.join(evidenceDirectory, 'evidence.json'), 'utf8'))
  assert.equal(evidence.transport_calls, 1)
  assert.equal(evidence.automatic_retry, false)
})

test('a vanished run directory never masks an unknown transport outcome or triggers a retry', async (t) => {
  const f = await fixture(t)
  let calls = 0
  await assert.rejects(
    () => executeImageEdit({
      prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
      experimentName: 'missing-evidence-directory', apiKey: 'sk-test',
      fetchImpl: async () => {
        calls += 1
        const runFolder = (await fs.readdir(f.evidenceRoot, { withFileTypes: true }))
          .find((entry) => entry.isDirectory())
        assert.ok(runFolder)
        await fs.rm(path.join(f.evidenceRoot, runFolder.name), { recursive: true, force: true })
        throw new Error('simulated transport timeout')
      },
    }),
    (error) => error.code === 'openai_outcome_unknown'
      && error.disposition === 'outcome_unknown'
      && error.evidenceSaved === true,
  )
  assert.equal(calls, 1)
})

test('interrupted successful response body is outcome_unknown and never retried', async (t) => {
  const f = await fixture(t)
  let calls = 0
  let evidenceDirectory
  await assert.rejects(
    () => executeImageEdit({
      prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
      experimentName: 'interrupted-body', apiKey: 'sk-test',
      fetchImpl: async () => {
        calls += 1
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'x-request-id': 'req_interrupted' }),
          text: async () => { throw new Error('socket closed') },
        }
      },
    }),
    (error) => { evidenceDirectory = error.evidenceDirectory; return error.code === 'openai_outcome_unknown' && error.disposition === 'outcome_unknown' },
  )
  assert.equal(calls, 1)
  const evidence = JSON.parse(await fs.readFile(path.join(evidenceDirectory, 'evidence.json'), 'utf8'))
  assert.equal(evidence.provider_request_id, 'req_interrupted')
  assert.equal(evidence.transport_calls, 1)
})

test('missing key fails before transport and before creating a run directory', async (t) => {
  const f = await fixture(t)
  let calls = 0
  await assert.rejects(() => executeImageEdit({
    prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
    experimentName: 'missing-key', apiKey: '', fetchImpl: async () => { calls += 1 },
  }), (error) => error.code === 'openai_api_key_missing')
  assert.equal(calls, 0)
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['identity.jpg', 'illustration.png', 'mask.png'])
})

test('streaming response saves partial and completed events with one call', async (t) => {
  const f = await fixture(t)
  let calls = 0
  const encoded = f.output.toString('base64')
  const stream = [
    `data: ${JSON.stringify({ type: 'image_edit.partial_image', b64_json: encoded, partial_image_index: 0, output_format: 'png', size: '1024x1024' })}`,
    `data: ${JSON.stringify({ type: 'image_edit.completed', b64_json: encoded, output_format: 'png', size: '1024x1024', usage: successPayload(f.output).usage })}`,
    'data: [DONE]',
    '',
  ].join('\n\n')
  const result = await executeImageEdit({
    prompt: 'edit', settings: { stream: true, partial_images: 1 }, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
    experimentName: 'stream', apiKey: 'sk-test',
    fetchImpl: async () => { calls += 1; return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }) },
  })
  assert.equal(calls, 1)
  assert.equal(result.evidence.outputs.length, 1)
  assert.equal(result.evidence.partial_outputs.length, 1)
  assert.equal(result.response.stream_events.length, 2)
  assert.equal('b64_json' in result.response.stream_events[0], false)
})

test('mismatched returned dimensions fail after one call with result_received', async (t) => {
  const f = await fixture(t)
  const wrong = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#234567' } }).png().toBuffer()
  let calls = 0
  await assert.rejects(() => executeImageEdit({
    prompt: 'edit', settings: {}, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
    experimentName: 'wrong-size', apiKey: 'sk-test',
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify(successPayload(wrong)), { status: 200 }) },
  }), (error) => error.code === 'response_size_mismatch' && error.disposition === 'result_received')
  assert.equal(calls, 1)
})

test('missing requested outputs fail closed after one call', async (t) => {
  const f = await fixture(t)
  let calls = 0
  await assert.rejects(() => executeImageEdit({
    prompt: 'edit', settings: { n: 2 }, imagePaths: [f.illustration], outputRoot: f.outputRoot, evidenceRoot: f.evidenceRoot,
    experimentName: 'missing-output', apiKey: 'sk-test',
    fetchImpl: async () => { calls += 1; return new Response(JSON.stringify(successPayload(f.output)), { status: 200 }) },
  }), (error) => error.code === 'response_image_count_mismatch' && error.disposition === 'result_received')
  assert.equal(calls, 1)
})

test('cost calculation requires token detail and uses published GPT Image 2.5 rates', () => {
  assert.equal(calculateChargeUsd({ input_tokens_details: { text_tokens: 10, image_tokens: 20 }, output_tokens: 30 }), 0.00111)
  assert.equal(calculateChargeUsd({ input_tokens: 30, output_tokens: 30 }), null)
})

test('SSE parser accepts multi-line data and rejects malformed JSON', () => {
  assert.deepEqual(parseSse('data: {"type":"image_edit.completed",\ndata: "size":"1024x1024"}\n\n'), [{ type: 'image_edit.completed', size: '1024x1024' }])
  assert.throws(() => parseSse('data: nope\n\n'), /invalid JSON/)
})
