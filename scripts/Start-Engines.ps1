$ErrorActionPreference = 'Stop'
$taskRuntimeRoot = Join-Path $env:LOCALAPPDATA 'MistakeQuest'
$logs = Join-Path $taskRuntimeRoot 'logs'
$run = Join-Path $taskRuntimeRoot 'run'
New-Item -ItemType Directory -Force -Path $logs,$run,(Join-Path $taskRuntimeRoot 'models') | Out-Null
function Test-Endpoint([string]$Url) { try { $null=Invoke-RestMethod -Uri $Url -TimeoutSec 2; return $true } catch { return $false } }
function Save-OwnedProcess([string]$Name, $Process) { @{pid=$Process.Id;startTicks=$Process.StartTime.ToUniversalTime().Ticks} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run "$Name.json") -Encoding UTF8 }
$ollamaExe=Join-Path $taskRuntimeRoot 'runtime\ollama-0.40.4\ollama.exe'
if (-not (Test-Endpoint 'http://127.0.0.1:11434/api/tags')) {
    if (-not (Test-Path -LiteralPath $ollamaExe)) { throw 'Ollama falta. Ejecuta npm run setup.' }
    $env:OLLAMA_HOST='127.0.0.1:11434'
    $env:OLLAMA_MODELS=Join-Path $taskRuntimeRoot 'models'
    $env:OLLAMA_NO_CLOUD='1'
    $env:OLLAMA_NUM_PARALLEL='1'
    $env:OLLAMA_MAX_LOADED_MODELS='1'
    $process=Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'ollama.out.log') -RedirectStandardError (Join-Path $logs 'ollama.err.log')
    Save-OwnedProcess 'ollama' $process
}
if (-not (Test-Endpoint 'http://127.0.0.1:8081/v2/languages')) {
    $ltDir=Join-Path $taskRuntimeRoot 'runtime\LanguageTool-6.6'
    if (-not (Test-Path -LiteralPath (Join-Path $ltDir 'languagetool-server.jar'))) { throw 'LanguageTool falta. Ejecuta npm run setup.' }
    $java=(Get-Command java.exe -ErrorAction Stop).Source
    $config=Join-Path $ltDir 'server.properties'
    if (-not (Test-Path -LiteralPath $config)) { [IO.File]::WriteAllText($config,'') }
    $process=Start-Process -FilePath $java -WorkingDirectory $ltDir -ArgumentList '-Xmx1024m -cp languagetool-server.jar org.languagetool.server.HTTPServer --config server.properties --port 8081' -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs 'languagetool.out.log') -RedirectStandardError (Join-Path $logs 'languagetool.err.log')
    Save-OwnedProcess 'languagetool' $process
}
$ready=$false
for ($i=0;$i -lt 60;$i++) {
    if ((Test-Endpoint 'http://127.0.0.1:11434/api/tags') -and (Test-Endpoint 'http://127.0.0.1:8081/v2/languages')) { $ready=$true; break }
    Start-Sleep -Milliseconds 1000
}
if (-not $ready) { throw "Los motores no respondieron. Revisa los logs en $logs" }
Write-Output 'Ollama y LanguageTool responden en loopback.'
