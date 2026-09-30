$ErrorActionPreference = 'Stop'

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
& .\node_modules\.bin\electron.cmd prompt-lab/tests/safe-storage-smoke.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
