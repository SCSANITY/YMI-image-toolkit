'use strict'

const path = require('node:path')
const fs = require('node:fs/promises')
const sharp = require('sharp')

const PREVIEW_MAX_DIMENSION = 768
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function errorResult(error, { runId = null } = {}) {
  return {
    ok: false,
    error: {
      code: String(error?.code || 'prompt_lab_error'),
      message: String(error?.message || error || 'Unknown error'),
      disposition: error?.disposition || null,
      httpStatus: error?.httpStatus || null,
      providerRequestId: error?.providerRequestId || null,
      runId,
      evidenceSaved: error?.evidenceSaved === true,
    },
  }
}

async function createPreviewDataUrl(input) {
  const thumbnail = await sharp(input, { failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({
      width: PREVIEW_MAX_DIMENSION,
      height: PREVIEW_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80, effort: 4 })
    .toBuffer()

  if (thumbnail.length > PREVIEW_MAX_BYTES) {
    throw Object.assign(new Error('The local preview thumbnail exceeded its safety limit.'), {
      code: 'preview_thumbnail_too_large',
    })
  }
  return `data:image/webp;base64,${thumbnail.toString('base64')}`
}

async function mapOutputPreview(output, outputDirectory, previewDataUrl) {
  try {
    return {
      ...output,
      previewUrl: await previewDataUrl(path.join(outputDirectory, output.file)),
      previewError: null,
    }
  } catch {
    return {
      ...output,
      previewUrl: null,
      previewError: 'local_preview_unavailable',
    }
  }
}

async function verifyLocalArtifacts(result) {
  const evidenceFiles = [
    'request.json',
    'REQUEST_STARTED.json',
    'response.json',
    'evidence.json',
  ]
  const imageFiles = [
    ...result.evidence.outputs.map((output) => output.file),
    ...result.evidence.partial_outputs.map((output) => output.file),
  ]
  try {
    await Promise.all([
      ...evidenceFiles.map((file) => fs.access(path.join(result.evidenceDirectory, file))),
      ...imageFiles.map((file) => fs.access(path.join(result.outputDirectory, file))),
    ])
    return true
  } catch {
    return false
  }
}

function createExecuteHandler({
  prepareRequest,
  executeImageEdit,
  confirmRequest,
  getApiKey,
  getEvidenceRoot,
  registerRunDirectory = () => null,
  previewDataUrl = createPreviewDataUrl,
}) {
  let activeOwner = null

  return async function executeHandler(event, request) {
    if (activeOwner) {
      return errorResult(Object.assign(new Error('A request is already running.'), { code: 'request_in_flight' }))
    }

    const owner = Symbol('prompt-lab-request')
    activeOwner = owner

    try {
      const apiKey = String(await getApiKey() || '').trim()
      if (!apiKey) {
        return errorResult(Object.assign(new Error('Add an OpenAI API key in Prompt Lab before sending.'), {
          code: 'openai_api_key_missing',
        }))
      }

      const prepared = await prepareRequest(request)
      if (!await confirmRequest(event, prepared)) return { ok: false, cancelled: true }

      const evidenceRoot = await getEvidenceRoot()
      const result = await executeImageEdit({ ...request, evidenceRoot, apiKey })
      const runId = registerRunDirectory(result.outputDirectory, result.evidence?.run_id)
      const outputs = await Promise.all(result.evidence.outputs.map((output) => (
        mapOutputPreview(output, result.outputDirectory, previewDataUrl)
      )))
      const partialOutputs = await Promise.all(result.evidence.partial_outputs.map((output) => (
        mapOutputPreview(output, result.outputDirectory, previewDataUrl)
      )))
      return {
        ok: true,
        result: {
          request: result.request,
          response: result.response,
          evidence: result.evidence,
          runId,
          localArtifactsAvailable: await verifyLocalArtifacts(result),
          outputs,
          partialOutputs,
        },
      }
    } catch (error) {
      return errorResult(error, { runId: error?.runId || null })
    } finally {
      if (activeOwner === owner) activeOwner = null
    }
  }
}

module.exports = {
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_DIMENSION,
  createExecuteHandler,
  createPreviewDataUrl,
  errorResult,
  mapOutputPreview,
  verifyLocalArtifacts,
}
