'use strict'

const path = require('node:path')

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/

function createRunRegistry() {
  const directories = new Map()

  function register(runDirectory, runId) {
    const normalizedRunId = String(runId || '').trim()
    if (!RUN_ID_PATTERN.test(normalizedRunId) || !path.isAbsolute(String(runDirectory || ''))) {
      throw Object.assign(new Error('Prompt Lab produced an invalid local run identity.'), {
        code: 'invalid_run_identity',
      })
    }
    directories.set(normalizedRunId, path.resolve(runDirectory))
    return normalizedRunId
  }

  function resolve(runId) {
    const normalizedRunId = String(runId || '').trim()
    if (!RUN_ID_PATTERN.test(normalizedRunId) || !directories.has(normalizedRunId)) {
      throw Object.assign(new Error('This run folder is not registered in the current app session.'), {
        code: 'run_not_registered',
      })
    }
    return directories.get(normalizedRunId)
  }

  return { register, resolve }
}

module.exports = { createRunRegistry }
