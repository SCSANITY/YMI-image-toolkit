$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
  throw 'Prompt Lab repository root could not be resolved.'
}

Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Write-Host 'Starting YMI Image Prompt Lab.'
Write-Host 'Add or replace the encrypted API key inside the app when needed.'
Write-Host 'Every paid request requires an explicit confirmation. Automatic retry is disabled.'
Push-Location $repoRoot
try {
  npm run prompt-lab
}
finally {
  Pop-Location
}
