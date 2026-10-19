$ErrorActionPreference = 'Stop'
$taskRunRoot=Join-Path $env:LOCALAPPDATA 'MistakeQuest\run'
foreach ($name in @('app','ollama','languagetool')) {
    $recordPath=Join-Path $taskRunRoot "$name.json"
    if (-not (Test-Path -LiteralPath $recordPath)) { continue }
    $record=Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $owned=Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if ($owned -and $owned.StartTime.ToUniversalTime().Ticks -eq [long]$record.startTicks) { Stop-Process -Id $owned.Id; Write-Output "$name detenido." }
    Remove-Item -LiteralPath $recordPath -Force
}
Write-Output 'Los datos y el modelo siguen guardados.'
