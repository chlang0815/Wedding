$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot

try {
  node --check script.js
  if ($LASTEXITCODE -ne 0) { throw "script.js contains a syntax error." }

  node --check invitation.config.js
  if ($LASTEXITCODE -ne 0) { throw "invitation.config.js contains a syntax error." }

  $indexPage = Get-Content -Raw -LiteralPath "index.html"
  $fallbackPage = Get-Content -Raw -LiteralPath "404.html"
  if ($indexPage -cne $fallbackPage) {
    throw "index.html and 404.html must remain identical."
  }

  git diff --check
  if ($LASTEXITCODE -ne 0) { throw "Git found whitespace errors." }

  Write-Host "All project checks passed." -ForegroundColor Green
}
finally {
  Pop-Location
}
