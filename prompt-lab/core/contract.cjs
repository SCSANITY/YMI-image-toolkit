'use strict'

const ENDPOINT = 'https://api.openai.com/v1/images/edits'
const MAX_IMAGES = 16
const MAX_IMAGE_BYTES = 50 * 1024 * 1024
const MAX_MASK_BYTES = 4 * 1024 * 1024
const MAX_PROMPT_CHARS = 32_000
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_EDGE = 3_840

const MODELS = Object.freeze([
  {
    id: 'gpt-image-2.5-flare-2026-09-08',
    label: 'Flare 2026-09-08 (pinned, recommended)',
    family: 'flare',
    pinned: true,
  },
  {
    id: 'gpt-image-2.5-sunburst-2026-09-08',
    label: 'Sunburst 2026-09-08 (pinned)',
    family: 'sunburst',
    pinned: true,
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'Flare rolling alias',
    family: 'flare',
    pinned: false,
  },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'Sunburst rolling alias',
    family: 'sunburst',
    pinned: false,
  },
])

const QUALITY_VALUES = Object.freeze(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
const OUTPUT_FORMATS = Object.freeze(['png', 'jpeg', 'webp'])
const BACKGROUNDS = Object.freeze(['auto', 'opaque', 'transparent'])
const INPUT_FIDELITY_VALUES = Object.freeze(['omit', 'low', 'high'])

const DEFAULT_SETTINGS = Object.freeze({
  model: 'gpt-image-2.5-flare-2026-09-08',
  size: '1024x1024',
  quality: 'medium',
  output_format: 'png',
  background: 'opaque',
  output_compression: 100,
  n: 1,
  stream: false,
  partial_images: 0,
  input_fidelity: 'omit',
  user: '',
  timeout_ms: 180_000,
})

function fail(code, message, field) {
  const error = new Error(message)
  error.code = code
  error.field = field || null
  throw error
}

function parseSize(raw) {
  const value = String(raw || '').trim()
  if (value === 'auto') return { value, width: null, height: null, experimental: false }
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(value)
  if (!match) fail('invalid_size', 'Size must be auto or WIDTHxHEIGHT.', 'size')
  const width = Number(match[1])
  const height = Number(match[2])
  if (width % 16 !== 0 || height % 16 !== 0) {
    fail('invalid_size', 'Width and height must both be divisible by 16.', 'size')
  }
  const ratio = width / height
  if (ratio < 1 / 3 || ratio > 3) {
    fail('invalid_size', 'Aspect ratio must be between 1:3 and 3:1.', 'size')
  }
  const pixels = width * height
  if (pixels < MIN_PIXELS || pixels > MAX_PIXELS || width > MAX_EDGE || height > MAX_EDGE) {
    fail('invalid_size', 'Size is outside the documented GPT Image pixel or edge limits.', 'size')
  }
  return {
    value: `${width}x${height}`,
    width,
    height,
    experimental: Math.max(width, height) > 2560 || Math.min(width, height) > 1440,
  }
}

function integer(value, min, max, field) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`invalid_${field}`, `${field} must be an integer from ${min} to ${max}.`, field)
  }
  return number
}

function validateSettings(input) {
  const settings = { ...DEFAULT_SETTINGS, ...(input || {}) }
  if (!MODELS.some((model) => model.id === settings.model)) {
    fail('invalid_model', 'Select one of the supported GPT Image 2.5 model IDs.', 'model')
  }
  if (!QUALITY_VALUES.includes(settings.quality)) {
    fail('invalid_quality', 'Select a supported quality.', 'quality')
  }
  if (!OUTPUT_FORMATS.includes(settings.output_format)) {
    fail('invalid_output_format', 'Select PNG, JPEG, or WebP.', 'output_format')
  }
  if (!BACKGROUNDS.includes(settings.background)) {
    fail('invalid_background', 'Select auto, opaque, or transparent.', 'background')
  }
  if (!INPUT_FIDELITY_VALUES.includes(settings.input_fidelity)) {
    fail('invalid_input_fidelity', 'Input fidelity must be omitted, low, or high.', 'input_fidelity')
  }
  if (settings.background === 'transparent' && settings.output_format === 'jpeg') {
    fail('transparent_jpeg', 'Transparent backgrounds require PNG or WebP.', 'output_format')
  }

  const size = parseSize(settings.size)
  const n = integer(settings.n, 1, 10, 'n')
  const partialImages = integer(settings.partial_images, 0, 3, 'partial_images')
  const outputCompression = integer(settings.output_compression, 0, 100, 'output_compression')
  const timeoutMs = integer(settings.timeout_ms, 10_000, 600_000, 'timeout_ms')
  const user = String(settings.user || '').trim()
  if (user.length > 256) fail('invalid_user', 'End-user identifier must be 256 characters or fewer.', 'user')

  return {
    model: settings.model,
    size: size.value,
    quality: settings.quality,
    output_format: settings.output_format,
    background: settings.background,
    output_compression: outputCompression,
    n,
    stream: Boolean(settings.stream),
    partial_images: Boolean(settings.stream) ? partialImages : 0,
    input_fidelity: settings.input_fidelity,
    user,
    timeout_ms: timeoutMs,
    size_metadata: size,
  }
}

function validatePrompt(prompt) {
  const normalized = String(prompt || '').trim()
  if (!normalized) fail('prompt_required', 'Enter a prompt before validating or sending.', 'prompt')
  if (normalized.length > MAX_PROMPT_CHARS) {
    fail('prompt_too_long', `Prompt exceeds ${MAX_PROMPT_CHARS.toLocaleString()} characters.`, 'prompt')
  }
  return normalized
}

function publicCapabilities() {
  return {
    endpoint: ENDPOINT,
    models: MODELS,
    qualities: QUALITY_VALUES,
    outputFormats: OUTPUT_FORMATS,
    backgrounds: BACKGROUNDS,
    inputFidelityValues: INPUT_FIDELITY_VALUES,
    limits: {
      maxImages: MAX_IMAGES,
      maxImageBytes: MAX_IMAGE_BYTES,
      maxMaskBytes: MAX_MASK_BYTES,
      maxPromptChars: MAX_PROMPT_CHARS,
      minPixels: MIN_PIXELS,
      maxPixels: MAX_PIXELS,
      maxEdge: MAX_EDGE,
    },
    defaults: DEFAULT_SETTINGS,
    notes: {
      responseFormat: 'GPT Image models always return base64 image data; response_format is not sent.',
      retries: 'Automatic retries are permanently disabled.',
      inputFidelity: 'Optional advanced field. The pinned Flare snapshot rejected it during YMI evaluation; omit unless intentionally retesting provider support.',
      streamingCost: 'Each partial image adds 100 output tokens according to the OpenAI image guide.',
    },
  }
}

module.exports = {
  BACKGROUNDS,
  DEFAULT_SETTINGS,
  ENDPOINT,
  INPUT_FIDELITY_VALUES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_MASK_BYTES,
  MODELS,
  OUTPUT_FORMATS,
  QUALITY_VALUES,
  parseSize,
  publicCapabilities,
  validatePrompt,
  validateSettings,
}
