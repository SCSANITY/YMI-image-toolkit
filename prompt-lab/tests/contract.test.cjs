'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  DEFAULT_SETTINGS,
  ENDPOINT,
  MODELS,
  parseSize,
  publicCapabilities,
  validatePrompt,
  validateSettings,
} = require('../core/contract.cjs')

test('network egress guard is active in this test process', () => {
  assert.equal(globalThis.__YMI_PROMPT_LAB_NETWORK_GUARD__, true)
  assert.throws(() => fetch(ENDPOINT), /forbid_network_egress/)
})

test('default request is the pinned Flare 1024 medium PNG contract', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
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
    timeout_ms: 180000,
  })
})

test('only the official GPT Image 2.5 snapshots and aliases are selectable', () => {
  assert.deepEqual(MODELS.map((model) => model.id), [
    'gpt-image-2.5-flare-2026-09-08',
    'gpt-image-2.5-sunburst-2026-09-08',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
  ])
  assert.throws(() => validateSettings({ model: 'chatgpt-image-latest' }), /supported GPT Image 2.5/)
})

test('custom size parser accepts supported shape rules and auto', () => {
  assert.deepEqual(parseSize('1024x1024'), { value: '1024x1024', width: 1024, height: 1024, experimental: false })
  assert.equal(parseSize('1536x1024').value, '1536x1024')
  assert.equal(parseSize('auto').value, 'auto')
  assert.equal(parseSize('2560x1440').experimental, false)
  assert.equal(parseSize('3072x1536').experimental, true)
})

test('custom size parser rejects aliases, bad divisibility, ratio, pixels, and edges', () => {
  for (const value of ['1024X1024', '1024x1024px', '1000x1000', '512x2048', '256x256', '3840x3840']) {
    assert.throws(() => parseSize(value))
  }
})

test('all supported quality values and output controls normalize', () => {
  for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max']) {
    assert.equal(validateSettings({ quality }).quality, quality)
  }
  const settings = validateSettings({
    output_format: 'webp',
    output_compression: 81,
    background: 'transparent',
    n: 10,
    stream: true,
    partial_images: 3,
    input_fidelity: 'high',
    user: 'operator-test',
    timeout_ms: 600000,
  })
  assert.equal(settings.output_compression, 81)
  assert.equal(settings.partial_images, 3)
  assert.equal(settings.input_fidelity, 'high')
})

test('transparent JPEG and invalid bounded numeric controls fail closed', () => {
  assert.throws(() => validateSettings({ output_format: 'jpeg', background: 'transparent' }), /require PNG or WebP/)
  assert.throws(() => validateSettings({ n: 11 }), /1 to 10/)
  assert.throws(() => validateSettings({ partial_images: 4 }), /0 to 3/)
  assert.throws(() => validateSettings({ output_compression: -1 }), /0 to 100/)
  assert.throws(() => validateSettings({ timeout_ms: 9999 }), /10000 to 600000/)
})

test('partial image count is forced to zero when streaming is off', () => {
  assert.equal(validateSettings({ stream: false, partial_images: 3 }).partial_images, 0)
})

test('prompt must be present and no longer than 32000 characters', () => {
  assert.equal(validatePrompt('  hello  '), 'hello')
  assert.throws(() => validatePrompt('   '), /Enter a prompt/)
  assert.throws(() => validatePrompt('a'.repeat(32001)), /exceeds/)
})

test('public capability contract explains fixed response and retry behavior', () => {
  const contract = publicCapabilities()
  assert.equal(contract.endpoint, ENDPOINT)
  assert.match(contract.notes.responseFormat, /base64/)
  assert.match(contract.notes.retries, /disabled/)
  assert.equal(contract.limits.maxImages, 16)
})
