$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json'))) {
  throw 'Prompt Lab repository root could not be resolved.'
}

if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) {
  $secureKey = Read-Host 'Paste the OpenAI API Key for this session' -AsSecureString
  $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $sessionKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    if ([string]::IsNullOrWhiteSpace($sessionKey)) {
      throw 'No API key was entered. Prompt Lab was not started.'
    }
    $env:OPENAI_API_KEY = $sessionKey
  }
  finally {
    if ($keyPointer -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }
    $sessionKey = $null
    $secureKey = $null
  }
}

Write-Host 'Starting YMI Image Prompt Lab. The key is available only to this process tree.'
Write-Host 'Every paid request requires an explicit confirmation. Automatic retry is disabled.'
Push-Location $repoRoot
try {
  npm run prompt-lab
}
finally {
  Pop-Location
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
}
