param([switch]$Lan)
$ErrorActionPreference = 'Stop'
$taskProject = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $taskProject
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or later from nodejs.org first.' }
if (-not (Test-Path -LiteralPath (Join-Path $taskProject 'node_modules/ws'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}
if ($Lan) { $env:HOST = '0.0.0.0' } else { $env:HOST = '127.0.0.1' }
Write-Host 'Open http://localhost:8787 in Chrome. Press Ctrl+C to stop.'
if ($Lan) { Write-Host 'LAN mode exposes this temporary service to your local network. Use a trusted network.' }
& node server.mjs
exit $LASTEXITCODE
