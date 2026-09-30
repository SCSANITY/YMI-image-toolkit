'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const HISTORY_LOCATOR_FILE = 'local-history.json'
const MAX_HISTORY_ITEMS = 50
const MAX_JSON_BYTES = 512 * 1024
const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/
const OUTPUT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function readBoundedJson(filePath) {
  const stat = await fs.stat(filePath)
  if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('history_record_invalid')
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

function cleanOutput(output) {
  const file = String(output?.file || '')
  if (!OUTPUT_FILE_PATTERN.test(file) || file === '.' || file === '..') return null
  return {
    file,
    format: String(output?.format || output?.extension || ''),
    width: numberOrNull(output?.width),
    height: numberOrNull(output?.height),
    byte_count: numberOrNull(output?.byte_count),
    sha256: String(output?.sha256 || ''),
  }
}

function historyRecord({ request, evidence, outputs, folderAvailable }) {
  const runId = String(evidence?.run_id || request?.run_id || '')
  if (!RUN_ID_PATTERN.test(runId) || request?.run_id !== runId || evidence?.run_id !== runId) return null
  return {
    runId,
    createdAt: String(request?.created_at || ''),
    completedAt: String(evidence?.completed_at || ''),
    experimentName: String(request?.experiment_name || 'Untitled experiment'),
    prompt: String(request?.prompt || ''),
    result: String(evidence?.result || 'unknown'),
    model: String(request?.parameters?.model || ''),
    size: String(request?.parameters?.size || ''),
    quality: String(request?.parameters?.quality || ''),
    outputFormat: String(request?.parameters?.output_format || ''),
    providerTimingMs: numberOrNull(evidence?.provider_timing_ms),
    calculatedChargeUsd: numberOrNull(evidence?.calculated_charge_usd),
    providerRequestId: String(evidence?.provider_request_id || ''),
    transportCalls: numberOrNull(evidence?.transport_calls),
    folderAvailable: Boolean(folderAvailable),
    outputs,
  }
}

function createHistoryStore({ evidenceRoot, defaultOutputRoot, previewDataUrl, registerRunDirectory }) {
  const resolvedEvidenceRoot = path.resolve(evidenceRoot)
  const resolvedDefaultOutputRoot = path.resolve(defaultOutputRoot)

  async function recordCompletedRun(result) {
    const runId = String(result?.evidence?.run_id || '')
    const evidenceDirectory = path.resolve(String(result?.evidenceDirectory || ''))
    const outputDirectory = path.resolve(String(result?.outputDirectory || ''))
    if (
      !RUN_ID_PATTERN.test(runId)
      || !isWithin(resolvedEvidenceRoot, evidenceDirectory)
      || path.dirname(evidenceDirectory) !== resolvedEvidenceRoot
      || !path.isAbsolute(outputDirectory)
    ) {
      throw new Error('history_identity_invalid')
    }
    await fs.writeFile(path.join(evidenceDirectory, HISTORY_LOCATOR_FILE), `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      output_directory: outputDirectory,
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  }

  async function locateOutputDirectory(evidenceDirectory, directoryName, runId) {
    let candidate = null
    try {
      const locator = await readBoundedJson(path.join(evidenceDirectory, HISTORY_LOCATOR_FILE))
      if (locator?.schema_version === 1 && locator?.run_id === runId && path.isAbsolute(String(locator?.output_directory || ''))) {
        candidate = path.resolve(locator.output_directory)
      }
    } catch {
      // Older runs have no locator. Their default output folder remains discoverable.
    }
    if (!candidate) candidate = path.join(resolvedDefaultOutputRoot, directoryName)
    try {
      if (!(await fs.stat(candidate)).isDirectory()) return null
      return candidate
    } catch {
      return null
    }
  }

  async function listHistory() {
    let directories
    try {
      directories = (await fs.readdir(resolvedEvidenceRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }

    const records = []
    for (const directoryName of directories) {
      const evidenceDirectory = path.join(resolvedEvidenceRoot, directoryName)
      if (!isWithin(resolvedEvidenceRoot, evidenceDirectory)) continue
      try {
        const [request, evidence] = await Promise.all([
          readBoundedJson(path.join(evidenceDirectory, 'request.json')),
          readBoundedJson(path.join(evidenceDirectory, 'evidence.json')),
        ])
        const runId = String(evidence?.run_id || '')
        if (!RUN_ID_PATTERN.test(runId) || !directoryName.startsWith(`${runId}_`)) continue
        const outputDirectory = await locateOutputDirectory(evidenceDirectory, directoryName, runId)
        const outputs = []
        for (const rawOutput of Array.isArray(evidence?.outputs) ? evidence.outputs : []) {
          const output = cleanOutput(rawOutput)
          if (!output) continue
          if (outputDirectory) {
            try {
              output.previewUrl = await previewDataUrl(path.join(outputDirectory, output.file))
              output.previewError = null
            } catch {
              output.previewUrl = null
              output.previewError = 'local_preview_unavailable'
            }
          } else {
            output.previewUrl = null
            output.previewError = 'local_preview_unavailable'
          }
          outputs.push(output)
        }
        if (outputDirectory) registerRunDirectory(outputDirectory, runId)
        const record = historyRecord({ request, evidence, outputs, folderAvailable: Boolean(outputDirectory) })
        if (record) records.push(record)
      } catch {
        // One malformed or incomplete internal record must not hide healthy history.
      }
    }
    return records
      .sort((left, right) => Date.parse(right.completedAt || right.createdAt) - Date.parse(left.completedAt || left.createdAt))
      .slice(0, MAX_HISTORY_ITEMS)
  }

  return { listHistory, recordCompletedRun }
}

module.exports = {
  HISTORY_LOCATOR_FILE,
  MAX_HISTORY_ITEMS,
  createHistoryStore,
  historyRecord,
}
