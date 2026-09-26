<#
  Clears what an earlier PlayzAnime Web session can leave behind, before a new one starts.
  Only PlayzAnime's own leftovers are touched: never your browser, editor or other Node apps.
    - servers still holding ports 5310 (API) or 5311 (site)
    - hidden browsers the stream resolver started and never closed
    - their temporary browser profiles
    - old logs and Python caches
#>
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$cleaned = @()

# 1. Leftover servers on our two ports (only if they're Node).
foreach ($port in 5310, 5311) {
  foreach ($conn in Get-NetTCPConnection -LocalPort $port -State Listen) {
    $proc = Get-Process -Id $conn.OwningProcess
    if ($proc -and $proc.ProcessName -eq 'node') {
      Stop-Process -Id $proc.Id -Force
      $cleaned += "stopped an old server on port $port (pid $($proc.Id))"
    }
  }
}

# 2. Hidden browsers from the stream resolver: they run with a Playwright temp profile.
$orphans = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe' OR Name='chrome-headless-shell.exe'" |
  Where-Object { $_.CommandLine -like '*playwright_chromiumdev_profile*' }
foreach ($p in $orphans) { Stop-Process -Id $p.ProcessId -Force }
if ($orphans) { $cleaned += "closed $(@($orphans).Count) hidden browser process(es) left by the stream resolver" }

# 3. Their temporary profiles.
$profiles = Get-ChildItem $env:TEMP -Directory -Filter 'playwright_chromiumdev_profile-*'
foreach ($d in $profiles) { Remove-Item $d.FullName -Recurse -Force }
if ($profiles) { $cleaned += "removed $(@($profiles).Count) temporary browser profile(s)" }

# 4. Logs older than a week, and Python caches from the old backend.
$logs = Get-ChildItem (Join-Path $root 'server\data') -Filter '*.log' -Recurse | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) }
foreach ($f in $logs) { Remove-Item $f.FullName -Force }
if ($logs) { $cleaned += "removed $(@($logs).Count) old log file(s)" }
$pycache = Get-ChildItem (Join-Path $root 'legacy') -Directory -Filter '__pycache__' -Recurse
foreach ($d in $pycache) { Remove-Item $d.FullName -Recurse -Force }
if ($pycache) { $cleaned += "removed Python caches from legacy\" }

if ($cleaned) { $cleaned | ForEach-Object { Write-Host "[cleanup] $_" } } else { Write-Host '[cleanup] nothing to clean' }
exit 0
