# Stops the background server: the "VP Assistant" task, its keep-running loop
# and the node process that loop started. Other node programs are not touched.
param([switch]$Quiet)
$taskName = "VP Assistant"
$all = Get-CimInstance Win32_Process
$loops = $all | Where-Object { $_.Name -eq "powershell.exe" -and $_.CommandLine -like "*\server\scripts\run-forever.ps1*" }
$loopIds = @($loops | ForEach-Object { $_.ProcessId })
$children = $all | Where-Object { $loopIds -contains $_.ParentProcessId }

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
foreach ($p in @($loops) + @($children)) {
  if ($p) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
}
if (-not $Quiet) { Write-Host "Stopped." }
