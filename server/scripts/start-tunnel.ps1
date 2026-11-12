# Gives the server an https address through a free Cloudflare Tunnel, so her
# phone can use it (notifications need https). No router changes needed.
#
#   Quick test (random address, changes every time):  npm.cmd run tunnel
#   Permanent address on your own domain: see server\README.md "https address".
#
# Refuses to run without APP_ACCESS_PIN: a tunnel makes the app reachable from
# the internet, and the PIN is what keeps others out.
$ErrorActionPreference = "Stop"
$server = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $server ".env"

function EnvValue($name) {
  if (-not (Test-Path $envFile)) { return "" }
  $line = Select-String -Path $envFile -Pattern "^\s*$name\s*=(.*)$" | Select-Object -Last 1
  if (-not $line) { return "" }
  return $line.Matches[0].Groups[1].Value.Trim().Trim('"')
}

$pin = EnvValue "APP_ACCESS_PIN"
if ($pin.Length -lt 6) {
  Write-Host "Not starting: set APP_ACCESS_PIN (6+ digits) in server\.env first, then run: npm.cmd run service:restart" -ForegroundColor Red
  exit 1
}
$port = EnvValue "PORT"; if (-not $port) { $port = "4000" }
try { $null = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3 } catch {
  Write-Host "The server is not answering on port $port. Start it: npm.cmd run service:install" -ForegroundColor Red
  exit 1
}

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
  foreach ($p in "$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe") {
    if (Test-Path $p) { $cloudflared = $p }
  }
}
if (-not $cloudflared) {
  Write-Host "cloudflared is not installed. Install it once with:" -ForegroundColor Yellow
  Write-Host "  winget install --id Cloudflare.cloudflared"
  Write-Host "then open a new PowerShell and run: npm.cmd run tunnel"
  exit 1
}

Write-Host "Starting the tunnel. Look for the https://....trycloudflare.com address below and open it on her phone."
Write-Host "Keep this window open; closing it closes the address. (Ctrl+C to stop.)"
& $cloudflared tunnel --no-autoupdate --url "http://localhost:$port"
