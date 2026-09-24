$ErrorActionPreference = "Stop"

$frontendRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $frontendRoot
Push-Location $frontendRoot

try {
  node --check script.js
  if ($LASTEXITCODE -ne 0) { throw "script.js contains a syntax error." }

  node --check invitation.config.js
  if ($LASTEXITCODE -ne 0) { throw "invitation.config.js contains a syntax error." }

  node --check gallery.js
  if ($LASTEXITCODE -ne 0) { throw "gallery.js contains a syntax error." }

  node --check gallery-admin.js
  if ($LASTEXITCODE -ne 0) { throw "gallery-admin.js contains a syntax error." }

  node --check gallery.config.js
  if ($LASTEXITCODE -ne 0) { throw "gallery.config.js contains a syntax error." }

  $indexPage = Get-Content -Raw -LiteralPath "index.html"
  $fallbackPage = Get-Content -Raw -LiteralPath "404.html"
  if ($indexPage -cne $fallbackPage) {
    throw "index.html and 404.html must remain identical."
  }

  $customDomain = (Get-Content -Raw -LiteralPath "CNAME").Trim()
  if ($customDomain -cne "lang-mueller.de") {
    throw "CNAME must contain lang-mueller.de."
  }

  if (-not (Test-Path -LiteralPath "fotos/index.html")) {
    throw "fotos/index.html is missing."
  }

  if (-not (Test-Path -LiteralPath "fotos/admin/index.html")) {
    throw "fotos/admin/index.html is missing."
  }

  git -C $repositoryRoot diff --check
  if ($LASTEXITCODE -ne 0) { throw "Git found whitespace errors." }

  Write-Host "All frontend checks passed." -ForegroundColor Green
}
finally {
  Pop-Location
}
