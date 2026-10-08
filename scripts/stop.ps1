$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
foreach($taskMode in @('tickets','transcribe')){
 $taskLock=Join-Path $taskRoot "data/$taskMode/server.lock"
 if(-not (Test-Path -LiteralPath $taskLock)){continue}
 $taskPid=[int](Get-Content -LiteralPath $taskLock -Raw)
 $taskProcess=Get-CimInstance Win32_Process -Filter "ProcessId = $taskPid" -ErrorAction SilentlyContinue
 # Verify process ownership before stopping; PID alone is not sufficient.
 if($taskProcess){
  $taskExpected=Join-Path $taskRoot 'server/main.ts'
  if($taskProcess.CommandLine -and $taskProcess.CommandLine.Contains($taskExpected) -and $taskProcess.CommandLine.Contains($taskMode)){
   & taskkill.exe /PID $taskPid /T /F | Out-Null
   if($LASTEXITCODE -ne 0){throw "Unable to stop $taskMode"}
   Write-Host "Stopped $taskMode"
  }else{Write-Warning "PID $taskPid does not belong to this checkout; left untouched.";continue}
 }
 Remove-Item -LiteralPath $taskLock -Force
}
