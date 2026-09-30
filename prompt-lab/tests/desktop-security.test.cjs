'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { createRunRegistry } = require('../electron/runRegistry.cjs')

const root = path.join(__dirname, '..', '..')

test('run-folder opening accepts only main-owned run identities', () => {
  const registry = createRunRegistry()
  const runDirectory = path.resolve('C:/safe/prompt-lab-run')
  registry.register(runDirectory, '2026-09-30_10-00-00_abcdef')
  assert.equal(registry.resolve('2026-09-30_10-00-00_abcdef'), runDirectory)
  assert.throws(() => registry.resolve('not-registered'), (error) => error.code === 'run_not_registered')
  assert.throws(() => registry.register('relative/path', 'run-id'), (error) => error.code === 'invalid_run_identity')
})

test('desktop source pins sandbox, CSP, exact navigation and run-ID-only shell access', () => {
  const main = fs.readFileSync(path.join(root, 'prompt-lab', 'electron', 'main.cjs'), 'utf8')
  const preload = fs.readFileSync(path.join(root, 'prompt-lab', 'electron', 'preload.cjs'), 'utf8')
  const html = fs.readFileSync(path.join(root, 'prompt-lab', 'index.html'), 'utf8')
  const launcher = fs.readFileSync(path.join(root, 'prompt-lab', 'START_PROMPT_LAB.ps1'), 'utf8')
  assert.match(main, /app\.enableSandbox\(\)/)
  assert.match(main, /sandbox:\s*true/)
  assert.match(main, /candidate\.href === \(isDev \? devEntryUrl : packagedEntryUrl\)/)
  assert.doesNotMatch(main, /url\.startsWith\('file:'\)/)
  assert.match(main, /runRegistry\.resolve\(runId\)/)
  assert.doesNotMatch(preload, /openPath|revealPath/)
  assert.match(preload, /openRunFolder/)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'self'/)
  assert.match(html, /object-src 'none'/)
  assert.match(launcher, /Remove-Item Env:ELECTRON_RUN_AS_NODE/)
  assert.doesNotMatch(launcher, /Read-Host|SecureStringToBSTR/)
})

test('portable build is isolated from the existing converter package entry', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const config = fs.readFileSync(path.join(root, 'prompt-lab', 'electron-builder.yml'), 'utf8')
  assert.equal(packageJson.main, 'electron/main.cjs')
  assert.match(packageJson.scripts['prompt-lab:dist'], /prompt-lab\/electron-builder\.yml --win portable/)
  assert.match(config, /main: prompt-lab\/electron\/main\.cjs/)
  assert.match(config, /target: portable/)
  assert.match(config, /prompt-lab\/release/)
})
