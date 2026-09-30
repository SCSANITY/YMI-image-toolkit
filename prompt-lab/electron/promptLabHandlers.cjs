'use strict'

const path = require('node:path')
const sharp = require('sharp')

const PREVIEW_MAX_DIMENSION = 768
const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

function errorResult(error) {
  return {
    ok: false,
    error: {
      code: String(error?.code || 'prompt_lab_error'),
      message: String(error?.message || error || 'Unknown error'),
      disposition: error?.disposition || null,
      httpStatus: error?.httpStatus || null,
      providerRequestId: error?.providerRequestId || null,
      runDirectory: error?.runDirectory || null,
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

function createExecuteHandler({
  prepareRequest,
  executeImageEdit,
  confirmRequest,
  getApiKey,
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
      const apiKey = String(getApiKey() || '').trim()
      if (!apiKey) {
        return errorResult(Object.assign(new Error('Restart Prompt Lab from a terminal that has OPENAI_API_KEY loaded.'), {
          code: 'openai_api_key_missing',
        }))
      }

      const prepared = await prepareRequest(request)
      if (!await confirmRequest(event, prepared)) return { ok: false, cancelled: true }

      const result = await executeImageEdit({ ...request, apiKey })
      return {
        ok: true,
        result: {
          ...result,
          outputs: await Promise.all(result.evidence.outputs.map(async (output) => ({
            ...output,
            previewUrl: await previewDataUrl(path.join(result.runDirectory, output.file)),
          }))),
          partialOutputs: await Promise.all(result.evidence.partial_outputs.map(async (output) => ({
            ...output,
            previewUrl: await previewDataUrl(path.join(result.runDirectory, output.file)),
          }))),
        },
      }
    } catch (error) {
      return errorResult(error)
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
}
