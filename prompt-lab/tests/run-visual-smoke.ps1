$ErrorActionPreference = 'Stop'

# Some agent/IDE shells export ELECTRON_RUN_AS_NODE for their own integrations.
# Prompt Lab is a real Electron app, so the smoke child process must not inherit it.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\.bin\concurrently.cmd -k -s first `
  'vite --config prompt-lab/vite.config.mjs --configLoader native' `
  'wait-on tcp:5176 && electron prompt-lab/tests/visual-smoke.cjs'
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
