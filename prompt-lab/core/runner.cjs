'use strict'

const crypto = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require('sharp')
const {
  ENDPOINT,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_MASK_BYTES,
  validatePrompt,
  validateSettings,
} = require('./contract.cjs')

const MIME_BY_FORMAT = Object.freeze({ png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' })
const EXT_BY_FORMAT = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' })
const PRICES_PER_MILLION = Object.freeze({ textInput: 5, imageInput: 8, imageOutput: 30 })

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
}

function cleanText(value, maximum = 500) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maximum)
}

function safeRequestId(value) {
  const requestId = String(value || '').trim()
  return /^[A-Za-z0-9_-]{1,160}$/.test(requestId) ? requestId : null
}

function safeFileStem(value) {
  const stem = String(value || 'experiment')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 64)
  return stem || 'experiment'
}

function runId(now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  return `${timestamp}_${crypto.randomBytes(3).toString('hex')}`
}

function calculateChargeUsd(usage) {
  const details = usage?.input_tokens_details
  const textInput = Number(details?.text_tokens)
  const imageInput = Number(details?.image_tokens)
  const imageOutput = Number(usage?.output_tokens)
  if (![textInput, imageInput, imageOutput].every(Number.isFinite)) return null
  return Number((
    (textInput * PRICES_PER_MILLION.textInput
      + imageInput * PRICES_PER_MILLION.imageInput
      + imageOutput * PRICES_PER_MILLION.imageOutput) / 1_000_000
  ).toFixed(6))
}

function localArtifactWriteError(cause) {
  return Object.assign(new Error('OpenAI returned a result, but Prompt Lab could not save the local run artifacts.'), {
    code: 'local_artifact_write_failed',
    cause,
  })
}

async function readBoundedFile(filePath, byteLimit, { isMask = false, fsImpl = fs } = {}) {
  let stats
  try {
    stats = await fsImpl.stat(filePath)
  } catch (error) {
    throw Object.assign(new Error(`${isMask ? 'Mask' : 'Image'} could not be read.`), {
      code: isMask ? 'invalid_mask_path' : 'invalid_image_path',
      cause: error,
    })
  }
  if (!stats.isFile() || stats.size <= 0 || stats.size >= byteLimit) {
    throw Object.assign(new Error(`${isMask ? 'Mask' : 'Image'} must be non-empty and under ${byteLimit / 1024 / 1024} MB.`), {
      code: isMask ? 'invalid_mask_size' : 'invalid_image_size',
    })
  }
  const bytes = await fsImpl.readFile(filePath)
  if (bytes.length <= 0 || bytes.length >= byteLimit) {
    throw Object.assign(new Error(`${isMask ? 'Mask' : 'Image'} must be non-empty and under ${byteLimit / 1024 / 1024} MB.`), {
      code: isMask ? 'invalid_mask_size' : 'invalid_image_size',
    })
  }
  return bytes
}

async function inspectImage(filePath, { isMask = false } = {}) {
  const byteLimit = isMask ? MAX_MASK_BYTES : MAX_IMAGE_BYTES
  const bytes = await readBoundedFile(filePath, byteLimit, { isMask })
  let metadata
  try {
    metadata = await sharp(bytes).metadata()
  } catch {
    throw Object.assign(new Error(`${path.basename(filePath)} is not a readable image.`), { code: 'invalid_image' })
  }
  if (!MIME_BY_FORMAT[metadata.format]) {
    throw Object.assign(new Error(`${path.basename(filePath)} must be PNG, JPEG, or WebP.`), { code: 'unsupported_image_format' })
  }
  if (!metadata.width || !metadata.height) {
    throw Object.assign(new Error(`${path.basename(filePath)} has no readable dimensions.`), { code: 'invalid_image_dimensions' })
  }
  if (isMask && (metadata.format !== 'png' || !metadata.hasAlpha)) {
    throw Object.assign(new Error('Mask must be a PNG with an alpha channel.'), { code: 'invalid_mask_format' })
  }
  return {
    path: path.resolve(filePath),
    name: path.basename(filePath),
    bytes,
    byte_count: bytes.length,
    sha256: sha256(bytes),
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    mime_type: MIME_BY_FORMAT[metadata.format],
    has_alpha: Boolean(metadata.hasAlpha),
  }
}

function publicImage(image) {
  if (!image) return null
  return {
    name: image.name,
    byte_count: image.byte_count,
    sha256: image.sha256,
    width: image.width,
    height: image.height,
    format: image.format,
    mime_type: image.mime_type,
    has_alpha: image.has_alpha,
  }
}

async function prepareRequest({ prompt, settings, imagePaths, maskPath }) {
  const cleanPrompt = validatePrompt(prompt)
  const cleanSettings = validateSettings(settings)
  const paths = Array.isArray(imagePaths) ? imagePaths.filter(Boolean) : []
  if (paths.length < 1 || paths.length > MAX_IMAGES) {
    throw Object.assign(new Error(`Choose between 1 and ${MAX_IMAGES} input images.`), { code: 'invalid_image_count' })
  }
  const images = []
  for (const filePath of paths) images.push(await inspectImage(filePath))
  const mask = maskPath ? await inspectImage(maskPath, { isMask: true }) : null
  if (mask && (mask.width !== images[0].width || mask.height !== images[0].height)) {
    throw Object.assign(new Error('Mask dimensions must match the first input image.'), { code: 'mask_dimensions_mismatch' })
  }
  return {
    prompt: cleanPrompt,
    prompt_sha256: sha256(Buffer.from(cleanPrompt, 'utf8')),
    settings: cleanSettings,
    images,
    mask,
  }
}

function publicRequest(prepared) {
  const { size_metadata: sizeMetadata, ...apiSettings } = prepared.settings
  return {
    endpoint: ENDPOINT,
    prompt: prepared.prompt,
    prompt_sha256: prepared.prompt_sha256,
    parameters: apiSettings,
    size_metadata: sizeMetadata,
    ordered_inputs: prepared.images.map(publicImage),
    mask: publicImage(prepared.mask),
    automatic_retry: false,
    maximum_concurrency: 1,
  }
}

function appendTextFields(form, prepared) {
  const settings = prepared.settings
  form.set('model', settings.model)
  for (const image of prepared.images) {
    form.append('image[]', new Blob([image.bytes], { type: image.mime_type }), image.name)
  }
  if (prepared.mask) {
    form.set('mask', new Blob([prepared.mask.bytes], { type: 'image/png' }), prepared.mask.name)
  }
  form.set('prompt', prepared.prompt)
  form.set('size', settings.size)
  form.set('quality', settings.quality)
  form.set('output_format', settings.output_format)
  form.set('background', settings.background)
  form.set('n', String(settings.n))
  form.set('stream', String(settings.stream))
  if (settings.stream) form.set('partial_images', String(settings.partial_images))
  if (settings.input_fidelity !== 'omit') form.set('input_fidelity', settings.input_fidelity)
  if (settings.user) form.set('user', settings.user)
  if (settings.output_format === 'jpeg' || settings.output_format === 'webp') {
    form.set('output_compression', String(settings.output_compression))
  }
  return form
}

function parseSse(text) {
  const events = []
  for (const block of String(text || '').split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') continue
    try {
      events.push(JSON.parse(data))
    } catch {
      throw Object.assign(new Error('Streaming response included invalid JSON.'), { code: 'invalid_stream_event' })
    }
  }
  return events
}

function decodeResponse({ bodyText, streaming }) {
  if (!streaming) {
    let payload
    try {
      payload = JSON.parse(bodyText)
    } catch {
      throw Object.assign(new Error('OpenAI response body is not valid JSON.'), { code: 'invalid_response_json' })
    }
    return { payload, finals: payload?.data || [], partials: [], usage: payload?.usage || null }
  }
  const events = parseSse(bodyText)
  const partials = events.filter((event) => event?.type === 'image_edit.partial_image')
  const finals = events.filter((event) => event?.type === 'image_edit.completed')
  const usage = finals.at(-1)?.usage || null
  return { payload: { events: events.map(({ b64_json: _image, ...event }) => event) }, finals, partials, usage }
}

async function validateOutput(encoded, expectedSettings) {
  if (typeof encoded !== 'string' || !encoded) {
    throw Object.assign(new Error('OpenAI response did not include image bytes.'), { code: 'response_image_missing' })
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (!bytes.length) throw Object.assign(new Error('OpenAI returned an empty image.'), { code: 'response_image_empty' })
  let metadata
  try {
    metadata = await sharp(bytes).metadata()
  } catch {
    throw Object.assign(new Error('OpenAI returned unreadable image bytes.'), { code: 'response_image_invalid' })
  }
  const expectedFormat = expectedSettings.output_format === 'jpeg' ? 'jpeg' : expectedSettings.output_format
  if (metadata.format !== expectedFormat) {
    throw Object.assign(new Error(`Expected ${expectedFormat}, received ${metadata.format || 'unknown'}.`), { code: 'response_format_mismatch' })
  }
  const size = expectedSettings.size_metadata
  if (size.width && (metadata.width !== size.width || metadata.height !== size.height)) {
    throw Object.assign(new Error(`Expected ${size.value}, received ${metadata.width}x${metadata.height}.`), { code: 'response_size_mismatch' })
  }
  return {
    bytes,
    format: metadata.format,
    extension: EXT_BY_FORMAT[metadata.format],
    width: metadata.width,
    height: metadata.height,
    byte_count: bytes.length,
    sha256: sha256(bytes),
  }
}

async function writeJson(filePath, value, options = {}) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', ...options })
}

async function executeImageEdit({
  prompt,
  settings,
  imagePaths,
  maskPath,
  outputRoot,
  experimentName,
  apiKey,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const prepared = await prepareRequest({ prompt, settings, imagePaths, maskPath })
  if (!String(apiKey || '').trim()) {
    throw Object.assign(new Error('OPENAI_API_KEY is not loaded in this process.'), { code: 'openai_api_key_missing' })
  }
  if (typeof fetchImpl !== 'function') {
    throw Object.assign(new Error('No HTTP transport is available.'), { code: 'transport_missing' })
  }
  if (!String(outputRoot || '').trim()) {
    throw Object.assign(new Error('Choose a local run output folder.'), { code: 'output_root_missing' })
  }

  const id = runId(now())
  const folder = `${id}_${safeFileStem(experimentName)}_${prepared.settings.size}`
  const resolvedOutputRoot = path.resolve(outputRoot)
  await fs.mkdir(resolvedOutputRoot, { recursive: true })
  const runDirectory = path.join(resolvedOutputRoot, folder)
  await fs.mkdir(runDirectory, { recursive: false })
  const requestEvidence = {
    schema_version: 1,
    run_id: id,
    created_at: now().toISOString(),
    experiment_name: cleanText(experimentName, 120),
    ...publicRequest(prepared),
  }
  await writeJson(path.join(runDirectory, 'request.json'), requestEvidence, { flag: 'wx' })

  const form = appendTextFields(new FormData(), prepared)
  const startedAt = Date.now()
  const requestStartedEvidence = {
    schema_version: 1,
    run_id: id,
    started_at: now().toISOString(),
    endpoint: ENDPOINT,
    request_count: 1,
    automatic_retry: false,
  }
  await writeJson(path.join(runDirectory, 'REQUEST_STARTED.json'), requestStartedEvidence, { flag: 'wx' })

  let response
  let transportCalls = 0
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), prepared.settings.timeout_ms)
  try {
    transportCalls += 1
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
  } catch (cause) {
    const evidence = {
      schema_version: 1,
      result: 'outcome_unknown',
      run_id: id,
      completed_at: now().toISOString(),
      transport_calls: transportCalls,
      automatic_retry: false,
      error: { code: 'openai_outcome_unknown', message: 'The request may have been accepted; do not automatically resubmit.' },
    }
    let evidenceSaved = false
    try {
      await writeJson(path.join(runDirectory, 'evidence.json'), evidence, { flag: 'wx' })
      evidenceSaved = true
    } catch { /* preserve the unknown provider outcome */ }
    const error = Object.assign(new Error(evidence.error.message), {
      code: evidence.error.code,
      disposition: 'outcome_unknown',
      evidenceSaved,
      runId: id,
      runDirectory,
      cause,
    })
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (transportCalls !== 1) throw new Error('internal_request_count_violation')
  const providerRequestId = safeRequestId(response.headers.get('x-request-id'))
  let bodyText
  try {
    bodyText = await response.text()
  } catch (cause) {
    if (!response.ok) bodyText = ''
    else {
      const evidence = {
        schema_version: 1,
        result: 'outcome_unknown',
        run_id: id,
        completed_at: now().toISOString(),
        transport_calls: transportCalls,
        automatic_retry: false,
        provider_request_id: providerRequestId,
        http_status: response.status,
        error: { code: 'openai_outcome_unknown', message: 'Response body was interrupted; do not automatically resubmit.' },
      }
      let evidenceSaved = false
      try {
        await writeJson(path.join(runDirectory, 'evidence.json'), evidence, { flag: 'wx' })
        evidenceSaved = true
      } catch { /* preserve the unknown provider outcome */ }
      throw Object.assign(new Error(evidence.error.message), {
        code: evidence.error.code,
        disposition: 'outcome_unknown',
        evidenceSaved,
        providerRequestId,
        runId: id,
        runDirectory,
        cause,
      })
    }
  }
  if (!response.ok) {
    let providerError = null
    try { providerError = JSON.parse(bodyText)?.error || null } catch { /* keep providerError null */ }
    const evidence = {
      schema_version: 1,
      result: 'conclusively_rejected',
      run_id: id,
      completed_at: now().toISOString(),
      transport_calls: transportCalls,
      automatic_retry: false,
      provider_request_id: providerRequestId,
      http_status: response.status,
      error: {
        code: cleanText(providerError?.code) || 'openai_request_rejected',
        type: cleanText(providerError?.type) || null,
        message: cleanText(providerError?.message) || `OpenAI rejected the request with HTTP ${response.status}.`,
      },
    }
    let evidenceSaved = false
    try {
      await writeJson(path.join(runDirectory, 'evidence.json'), evidence, { flag: 'wx' })
      evidenceSaved = true
    } catch { /* preserve the conclusive provider rejection */ }
    throw Object.assign(new Error(evidence.error.message), {
      code: 'openai_request_rejected',
      disposition: 'conclusively_rejected',
      evidenceSaved,
      httpStatus: response.status,
      providerRequestId,
      runId: id,
      runDirectory,
    })
  }

  let decoded
  try {
    decoded = decodeResponse({ bodyText, streaming: prepared.settings.stream })
    if (!decoded.finals.length) throw Object.assign(new Error('OpenAI response did not include a completed image.'), { code: 'response_image_missing' })
    if (decoded.finals.length !== prepared.settings.n) {
      throw Object.assign(new Error(`Expected ${prepared.settings.n} completed image(s), received ${decoded.finals.length}.`), { code: 'response_image_count_mismatch' })
    }

    const outputRecords = []
    const outputArtifacts = []
    for (let index = 0; index < decoded.finals.length; index += 1) {
      const output = await validateOutput(decoded.finals[index]?.b64_json, prepared.settings)
      const file = `output-${String(index + 1).padStart(2, '0')}.${output.extension}`
      outputArtifacts.push({ file, bytes: output.bytes })
      outputRecords.push({ file, ...output, bytes: undefined })
    }

    const partialRecords = []
    const partialArtifacts = []
    for (let index = 0; index < decoded.partials.length; index += 1) {
      const partial = await validateOutput(decoded.partials[index]?.b64_json, prepared.settings)
      const sourceIndex = Number.isInteger(decoded.partials[index]?.partial_image_index)
        ? decoded.partials[index].partial_image_index
        : null
      const file = `partial-${String(index + 1).padStart(2, '0')}.${partial.extension}`
      partialArtifacts.push({ file, bytes: partial.bytes })
      partialRecords.push({ file, provider_partial_image_index: sourceIndex, ...partial, bytes: undefined })
    }

    const responseEvidence = {
      http_status: response.status,
      provider_request_id: providerRequestId,
      created: decoded.payload?.created ?? decoded.finals.at(-1)?.created_at ?? null,
      background: decoded.payload?.background ?? decoded.finals.at(-1)?.background ?? null,
      output_format: decoded.payload?.output_format ?? decoded.finals.at(-1)?.output_format ?? prepared.settings.output_format,
      quality: decoded.payload?.quality ?? decoded.finals.at(-1)?.quality ?? prepared.settings.quality,
      size: decoded.payload?.size ?? decoded.finals.at(-1)?.size ?? prepared.settings.size,
      usage: decoded.usage,
      stream_events: decoded.payload?.events || null,
    }
    const completedAt = Date.now()
    let evidence = {
      schema_version: 1,
      result: 'success',
      run_id: id,
      completed_at: now().toISOString(),
      transport_calls: transportCalls,
      automatic_retry: false,
      provider_request_id: providerRequestId,
      provider_timing_ms: completedAt - startedAt,
      calculated_charge_usd: calculateChargeUsd(decoded.usage),
      pricing_basis_usd_per_million: PRICES_PER_MILLION,
      outputs: outputRecords,
      partial_outputs: partialRecords,
    }

    const persistCompletedRun = async ({ recreate = false } = {}) => {
      if (recreate) {
        await fs.mkdir(resolvedOutputRoot, { recursive: true })
        await fs.mkdir(runDirectory, { recursive: false })
        await writeJson(path.join(runDirectory, 'request.json'), requestEvidence, { flag: 'wx' })
        await writeJson(path.join(runDirectory, 'REQUEST_STARTED.json'), requestStartedEvidence, { flag: 'wx' })
      }
      for (const output of outputArtifacts) {
        await fs.writeFile(path.join(runDirectory, output.file), output.bytes, { flag: 'wx' })
      }
      for (const partial of partialArtifacts) {
        await fs.writeFile(path.join(runDirectory, partial.file), partial.bytes, { flag: 'wx' })
      }
      await writeJson(path.join(runDirectory, 'response.json'), responseEvidence, { flag: 'wx' })
      await writeJson(path.join(runDirectory, 'evidence.json'), evidence, { flag: 'wx' })
    }

    try {
      await persistCompletedRun()
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw localArtifactWriteError(cause)
      let runDirectoryMissing = false
      try {
        await fs.stat(runDirectory)
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw localArtifactWriteError(cause)
        runDirectoryMissing = true
      }
      if (!runDirectoryMissing) throw localArtifactWriteError(cause)

      evidence = {
        ...evidence,
        local_artifact_recovery: 'recreated_missing_run_directory',
      }
      try {
        await persistCompletedRun({ recreate: true })
      } catch (recoveryCause) {
        throw localArtifactWriteError(recoveryCause)
      }
    }
    return { runDirectory, request: requestEvidence, response: responseEvidence, evidence }
  } catch (cause) {
    if (cause?.code === 'ERR_FS_EISDIR') throw cause
    if (cause?.code === 'local_artifact_write_failed') {
      throw Object.assign(cause, {
        disposition: 'result_received',
        evidenceSaved: false,
        providerRequestId,
        runId: id,
        runDirectory,
      })
    }
    const evidencePath = path.join(runDirectory, 'evidence.json')
    let evidenceSaved = false
    try {
      await writeJson(evidencePath, {
        schema_version: 1,
        result: 'invalid_response',
        run_id: id,
        completed_at: now().toISOString(),
        transport_calls: transportCalls,
        automatic_retry: false,
        provider_request_id: providerRequestId,
        http_status: response.status,
        error: { code: cleanText(cause?.code) || 'openai_invalid_response', message: cleanText(cause?.message) },
      }, { flag: 'wx' })
      evidenceSaved = true
    } catch { /* preserve the original response-validation failure */ }
    throw Object.assign(new Error(cause?.message || 'OpenAI response was invalid.'), {
      code: cause?.code || 'openai_invalid_response',
      disposition: 'result_received',
      evidenceSaved,
      providerRequestId,
      runId: id,
      runDirectory,
      cause,
    })
  }
}

module.exports = {
  PRICES_PER_MILLION,
  appendTextFields,
  calculateChargeUsd,
  decodeResponse,
  executeImageEdit,
  inspectImage,
  parseSse,
  prepareRequest,
  publicRequest,
  readBoundedFile,
  safeFileStem,
  sha256,
  validateOutput,
}
