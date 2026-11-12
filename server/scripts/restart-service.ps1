# Rebuilds and restarts the background server, e.g. after editing .env or
# pulling an update.
$ErrorActionPreference = "Stop"
$server = Split-Path -Parent $PSScriptRoot
$taskName = "VP Assistant"
Set-Location $server
if (-not (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue)) {
  throw "The '$taskName' task is not installed. Run: npm run service:install"
}
npx.cmd prisma migrate deploy | Out-Null
npm.cmd run build --silent
if ($LASTEXITCODE -ne 0) { throw "Build failed - the old version keeps running." }
& (Join-Path $PSScriptRoot "stop-server.ps1") -Quiet
Start-ScheduledTask -TaskName $taskName
Write-Host "Restarted. Log: server\logs\server.log"
