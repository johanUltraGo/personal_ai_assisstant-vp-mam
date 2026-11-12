# Stops the background server and removes the "VP Assistant" startup task.
$taskName = "VP Assistant"
& (Join-Path $PSScriptRoot "stop-server.ps1") -Quiet
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Host "Removed. Start it by hand with: npm run dev"
