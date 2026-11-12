# Keeps the Vice Principal AI server running: starts it, and if it ever stops
# (crash, error), waits 5 seconds and starts it again. Output is appended live
# to server\logs\server.log (rotated at 10 MB). Started by the "VP Assistant"
# scheduled task that install-service.ps1 creates.
$ErrorActionPreference = "Continue"
$server = Split-Path -Parent $PSScriptRoot
Set-Location $server
$logDir = Join-Path $server "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "server.log"

function Write-Log($text) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" | Out-File -FilePath $log -Append -Encoding utf8
}

while ($true) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) {
    Move-Item -Force $log (Join-Path $logDir "server.previous.log")
  }
  Write-Log "starting server"
  # Pipe through Out-File so the log stays UTF-8 (Windows PowerShell 5 would write UTF-16).
  & node dist/index.js 2>&1 | ForEach-Object { "$_" } | Out-File -FilePath $log -Append -Encoding utf8
  Write-Log "server stopped (exit code $LASTEXITCODE); restarting in 5 seconds"
  Start-Sleep -Seconds 5
}
