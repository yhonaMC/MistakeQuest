param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDataRoot = Join-Path $env:LOCALAPPDATA 'MistakeQuest'
$taskRunRoot = Join-Path $taskDataRoot 'run'
$taskLogRoot = Join-Path $taskDataRoot 'logs'
New-Item -ItemType Directory -Force -Path $taskRunRoot,$taskLogRoot | Out-Null
$node = (Get-Command node.exe -ErrorAction Stop).Source
$nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 24) { throw 'MistakeQuest necesita Node.js 24 o superior.' }
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\fastify\package.json'))) {
        Write-Output 'Instalando dependencias de la app...'
        & $npm ci --no-fund --no-audit
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo construir la interfaz.' }
    }
    & (Join-Path $PSScriptRoot 'Start-Engines.ps1')
    $models=(Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10).models
    if (-not ($models | Where-Object { $_.name -eq 'qwen3:8b' })) { throw 'Falta el modelo qwen3:8b. Ejecuta Instalar motores.cmd una vez.' }
    $appReady=$false
    try { $existing=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 5; $appReady=$existing.app -eq 'MistakeQuest' } catch {}
    if (-not $appReady) {
        $env:MQ_DATA_DIR=$taskDataRoot
        $env:MQ_PORT='3210'
        $entry=Join-Path $projectRoot 'service\index.js'
        $process=Start-Process -FilePath $node -ArgumentList @('"'+$entry+'"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskLogRoot 'app.out.log') -RedirectStandardError (Join-Path $taskLogRoot 'app.err.log')
        @{pid=$process.Id;startTicks=$process.StartTime.ToUniversalTime().Ticks} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRunRoot 'app.json') -Encoding UTF8
        for ($i=0;$i -lt 30;$i++) {
            try { $health=Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/health' -TimeoutSec 5; if ($health.app -eq 'MistakeQuest') { $appReady=$true; break } } catch {}
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 1000
        }
    }
    if (-not $appReady) { throw "La app no respondió. Revisa $taskLogRoot\app.err.log" }
    Write-Output 'MistakeQuest listo: http://127.0.0.1:3210'
    if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:3210' }
} finally { Pop-Location }
