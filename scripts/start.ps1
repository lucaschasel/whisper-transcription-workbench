param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath($PSScriptRoot + '\..')
Set-Location -LiteralPath $taskRoot
$taskMode = 'transcribe'
$taskPort = 4320
$taskNodeCandidates = @((Get-Command node.exe -ErrorAction SilentlyContinue).Source, (Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'))
$taskNode = $null
foreach ($taskCandidate in $taskNodeCandidates) { if ($taskCandidate -and (Test-Path -LiteralPath $taskCandidate)) { $taskVersion = & $taskCandidate --version; if ([int]($taskVersion.TrimStart('v').Split('.')[0]) -ge 24) { $taskNode = $taskCandidate; break } } }
if (-not $taskNode) { throw 'Node.js 24+ is required.' }
$taskDeps = Join-Path $taskRoot 'node_modules'
if (-not (Test-Path -LiteralPath (Join-Path $taskDeps 'tsx'))) { throw 'Dependencies missing. Run npm ci in this project folder with Node.js 24+.' }
if (-not (Test-Path -LiteralPath 'dist/index.html')) { & $taskNode (Join-Path $taskDeps 'vite/bin/vite.js') build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' } }
$taskUrl = "http://127.0.0.1:$taskPort"
New-Item -ItemType Directory -Force -Path 'data/logs' | Out-Null
$taskHealthy = $false
try { $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 2; $taskHealthy = ($taskHealth.mode -eq $taskMode -and $taskHealth.ok) } catch {}
if (-not $taskHealthy) {
  $taskServer = Join-Path $taskRoot 'server/main.ts'
$taskArgs = @((Join-Path $taskDeps 'tsx/dist/cli.mjs'), $taskServer, $taskMode)
  $taskProcess = Start-Process -FilePath $taskNode -ArgumentList $taskArgs -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot "data/logs/$taskMode.log") -RedirectStandardError (Join-Path $taskRoot "data/logs/$taskMode.error.log") -PassThru
  for ($taskIndex = 0; $taskIndex -lt 30; $taskIndex++) { Start-Sleep -Milliseconds 300; try { $taskHealth = Invoke-RestMethod "$taskUrl/api/health" -TimeoutSec 1; if ($taskHealth.mode -eq $taskMode -and $taskHealth.ok) { $taskHealthy = $true; break } } catch {}; if ($taskProcess.HasExited) { break } }
  if (-not $taskHealthy) { throw "Could not start $taskMode. See data/logs/$taskMode.error.log" }
}
Write-Host "$taskMode : $taskUrl"
if (-not $NoBrowser) { Start-Process $taskUrl }
Write-Host 'Personal workspace: open the URL directly. No login required.'
