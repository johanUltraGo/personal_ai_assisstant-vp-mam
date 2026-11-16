# Makes the Vice Principal AI server start automatically when you log in to
# Windows and keep running in the background (reminders need it running).
#   Install / update:  npm run service:install      (from the server folder)
#   After editing .env: npm run service:restart
#   Remove:            npm run service:uninstall
$ErrorActionPreference = "Stop"
$server = Split-Path -Parent $PSScriptRoot
$taskName = "VP Assistant"
Set-Location $server

Write-Host "1/4 Updating the database..."
npx.cmd prisma migrate deploy | Out-Null
Write-Host "2/4 Building the server..."
npm.cmd run build --silent
if ($LASTEXITCODE -ne 0) { throw "Build failed - fix the errors above and run this again." }

Write-Host "3/4 Registering the '$taskName' startup task..."
& (Join-Path $PSScriptRoot "stop-server.ps1") -Quiet
$runner = Join-Path $PSScriptRoot "run-forever.ps1"
# conhost --headless gives PowerShell a console with no window. Without it,
# Windows 11 can hand the console to Windows Terminal, and closing that hidden
# window ends the server with a Ctrl+C (exit 0xC000013A).
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
  -Argument "--headless powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`"" -WorkingDirectory $server
# Start 30 s after log-in, then every 5 minutes act as a watchdog: if the
# server is not running it is started again; if it is, nothing happens
# (MultipleInstances IgnoreNew), so there is never a second copy.
$atLogOn = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$atLogOn.Delay = "PT30S"
# Separate watchdog trigger: starts now and repeats every 5 minutes, forever.
$watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$trigger = @($atLogOn, $watchdog)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Keeps the Vice Principal AI server running (reminders, 9:00 list, calendar alerts)." -Force | Out-Null

Write-Host "4/4 Starting it now..."
Start-ScheduledTask -TaskName $taskName
$port = 4000
$envFile = Join-Path $server ".env"
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -Last 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
for ($i = 0; $i -lt 30; $i++) {
  try {
    $ok = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($ok.ok) { Write-Host "Running: open http://localhost:$port  (log: server\logs\server.log)"; exit 0 }
  } catch {}
  Start-Sleep -Seconds 1
}
Write-Warning "The task is registered but the server did not answer yet. Check server\logs\server.log."
