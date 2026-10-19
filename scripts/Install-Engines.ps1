param([string]$Model = 'qwen3:8b', [switch]$SkipModel)
$ErrorActionPreference = 'Stop'
$taskRuntimeRoot = Join-Path $env:LOCALAPPDATA 'MistakeQuest'
$downloads = Join-Path $taskRuntimeRoot 'downloads'
$runtime = Join-Path $taskRuntimeRoot 'runtime'
New-Item -ItemType Directory -Force -Path $downloads,$runtime | Out-Null

function Get-VerifiedArchive([string]$Url, [string]$Path, [string]$Sha256, [long]$ExpectedSize = 0) {
    $valid = (Test-Path -LiteralPath $Path) -and (($ExpectedSize -eq 0) -or ((Get-Item -LiteralPath $Path).Length -eq $ExpectedSize))
    if ($valid -and $Sha256) { $valid = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -eq $Sha256 }
    if (-not $valid) {
        Write-Output "Descargando $([IO.Path]::GetFileName($Path))..."
        & curl.exe --fail --location --silent --show-error --retry 3 --output $Path $Url
        if ($LASTEXITCODE -ne 0) { throw "La descarga falló: $Url" }
    }
    if ($ExpectedSize -gt 0 -and (Get-Item -LiteralPath $Path).Length -ne $ExpectedSize) { throw 'Descarga incompleta.' }
    if ($Sha256 -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Sha256) { throw 'La suma SHA-256 no coincide; el paquete no se ejecutará.' }
}
function Expand-VerifiedArchive([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $target = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try { foreach ($entry in $zip.Entries) { $entryTarget = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName)); if (-not $entryTarget.StartsWith($target,[StringComparison]::OrdinalIgnoreCase)) { throw 'El archivo contiene una ruta fuera del directorio de instalación.' } } } finally { $zip.Dispose() }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}

$ollamaDir = Join-Path $runtime 'ollama-0.40.4'
if (-not (Test-Path -LiteralPath (Join-Path $ollamaDir 'ollama.exe'))) {
    $archive = Join-Path $downloads 'ollama-0.40.4-windows-amd64.zip'
    Get-VerifiedArchive 'https://github.com/ollama/ollama/releases/download/v0.40.4/ollama-windows-amd64.zip' $archive '7485a1172f8527db4342a63521b9342fc466185ff0855da378cc864ecf6354cf'
    Write-Output 'Instalando Ollama portable...'
    Expand-VerifiedArchive $archive $ollamaDir
}
$ltDir = Join-Path $runtime 'LanguageTool-6.6'
if (-not (Test-Path -LiteralPath (Join-Path $ltDir 'languagetool-server.jar'))) {
    $archive = Join-Path $downloads 'LanguageTool-6.6.zip'
    Get-VerifiedArchive 'https://languagetool.org/download/LanguageTool-6.6.zip' $archive '' 251998221
    Write-Output 'Instalando LanguageTool...'
    Expand-VerifiedArchive $archive $runtime
}
& (Join-Path $PSScriptRoot 'Start-Engines.ps1')
if (-not $SkipModel) {
    $env:OLLAMA_HOST = '127.0.0.1:11434'
    $env:OLLAMA_MODELS = Join-Path $taskRuntimeRoot 'models'
    $installed = (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 10).models | Where-Object { $_.name -eq $Model }
    if ($installed) { Write-Output "El modelo $Model ya está instalado."; return }
    Write-Output "Descargando el modelo local $Model. Puede tardar varios minutos..."
    $pullLog = Join-Path $taskRuntimeRoot 'logs\model-pull.log'
    $pullProcess = Start-Process -FilePath (Join-Path $ollamaDir 'ollama.exe') -ArgumentList @('pull',$Model) -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput $pullLog -RedirectStandardError (Join-Path $taskRuntimeRoot 'logs\model-pull.err.log')
    if ($pullProcess.ExitCode -ne 0) {
        if ($Model -ne 'qwen3:8b') { throw 'No se pudo descargar el modelo.' }
        Write-Output 'El registro de Ollama no respondió. Descargando el mismo modelo del repositorio oficial de Qwen...'
        $gguf = Join-Path $downloads 'Qwen3-8B-Q4_K_M.gguf'
        Get-VerifiedArchive 'https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf' $gguf 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785' 5027783488
        $modelFile = Join-Path $downloads 'Modelfile.qwen3'
        [IO.File]::WriteAllText($modelFile, "FROM ./Qwen3-8B-Q4_K_M.gguf`nPARAMETER num_ctx 8192`nPARAMETER temperature 0`n")
        & (Join-Path $ollamaDir 'ollama.exe') create $Model -f $modelFile
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo importar el modelo oficial.' }
    }
}
Write-Output 'Motores locales preparados.'
