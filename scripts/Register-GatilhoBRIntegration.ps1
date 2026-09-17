<#
.SYNOPSIS
  GatilhoBR - Registro assistido e idempotente de Native Messaging e Extensão Externa.

.DESCRIPTION
  Registra o host Native Messaging e a extensão externa nos navegadores Google Chrome e Microsoft Edge
  para o usuário atual (HKCU), sem exigir privilégios de Administrador.
  Pode ser invocado pelo instalador NSIS, pela aplicação Electron em caso de reparo, ou manualmente em desenvolvimento.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'GatilhoBR'),
  [string]$Channel = 'stable',
  [string]$UpdateBaseUrl = 'https://releases.gatilhobr.com',
  [string]$ExtensionCrxPath = '',
  [string]$RegistryHiveRoot = 'HKCU:\Software',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$extensionId = 'dkchfkmohlejeflkdfhinlfgbeihfegh'
$hostName = 'com.gatilho.native_messaging'

# 1. Limpeza de processos auxiliares do host para evitar locks de arquivo
Get-Process -Name 'gatilhobr-host' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 150

# Caminhos no Registro para Chrome e Edge
$chromeHostReg = Join-Path $RegistryHiveRoot "Google\Chrome\NativeMessagingHosts\$hostName"
$edgeHostReg   = Join-Path $RegistryHiveRoot "Microsoft\Edge\NativeMessagingHosts\$hostName"
$chromeExtReg  = Join-Path $RegistryHiveRoot "Google\Chrome\Extensions\$extensionId"
$edgeExtReg    = Join-Path $RegistryHiveRoot "Microsoft\Edge\Extensions\$extensionId"

# -------------------------------------------------------------------------
# MODO DESINSTALAÇÃO
# -------------------------------------------------------------------------
if ($Uninstall) {
  Write-Host "[GatilhoBR] Removendo integrações de navegadores..." -ForegroundColor Cyan

  @($chromeHostReg, $edgeHostReg, $chromeExtReg, $edgeExtReg) | ForEach-Object {
    if (Test-Path -Path $_) {
      Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host "  [-] Registro removido: $_" -ForegroundColor DarkGray
    }
  }

  $hostTargetDir = Join-Path $InstallRoot 'native-host'
  if (Test-Path -LiteralPath $hostTargetDir) {
    Remove-Item -LiteralPath $hostTargetDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  $localExtDir = Join-Path $env:LOCALAPPDATA 'GatilhoBR\chrome-extension'
  if (Test-Path -LiteralPath $localExtDir) {
    Remove-Item -LiteralPath $localExtDir -Recurse -Force -ErrorAction SilentlyContinue
  }

  Write-Host "[GatilhoBR] Desinstalação da integração concluída com sucesso." -ForegroundColor Green
  exit 0
}

# -------------------------------------------------------------------------
# MODO INSTALAÇÃO / REPARO IDEMPOTENTE
# -------------------------------------------------------------------------
$cleanUpdateBaseUrl = $UpdateBaseUrl.TrimEnd('/')
if (-not $cleanUpdateBaseUrl.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Error "UpdateBaseUrl inválida. Endpoints de atualização devem obrigatoriamente usar HTTPS: $UpdateBaseUrl"
  exit 1
}

$updateManifestUrl = "$cleanUpdateBaseUrl/$Channel/updates.xml"

# Criação de pastas da instalação se não existirem
$hostTargetDir = Join-Path $InstallRoot 'native-host'
New-Item -ItemType Directory -Force -Path $hostTargetDir | Out-Null

# Resolução do executável do host
$hostExeTarget = Join-Path $hostTargetDir 'gatilhobr-host.exe'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourceHostExe = Join-Path $projectRoot 'dist-native\gatilhobr-host.exe'

if (-not (Test-Path -LiteralPath $hostExeTarget) -and (Test-Path -LiteralPath $sourceHostExe)) {
  Copy-Item -LiteralPath $sourceHostExe -Destination $hostExeTarget -Force
}

$hostCommand = $hostExeTarget
if (-not (Test-Path -LiteralPath $hostExeTarget)) {
  # Fallback de script cmd para desenvolvimento se o executável ainda não foi empacotado
  $sourceHostJs = Join-Path $projectRoot 'native-host\gatilhobr-host.js'
  if (Test-Path -LiteralPath $sourceHostJs) {
    Copy-Item -LiteralPath $sourceHostJs -Destination (Join-Path $hostTargetDir 'gatilhobr-host.js') -Force
    $cmdPath = Join-Path $hostTargetDir 'gatilhobr-host.cmd'
    Set-Content -LiteralPath $cmdPath -Encoding ASCII -Value "@echo off`r`nnode `"%~dp0gatilhobr-host.js`""
    $hostCommand = $cmdPath
  }
}

# Escrita atômica do manifesto do host com caminho absoluto
$manifestPath = Join-Path $hostTargetDir "$hostName.json"
$manifestObj = [ordered]@{
  name            = $hostName
  description     = 'GatilhoBR Native Messaging host'
  path            = $hostCommand
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
}

$manifestJson = $manifestObj | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.Encoding]::UTF8)

# 1. Registrar Native Messaging Host no Chrome e Edge
@($chromeHostReg, $edgeHostReg) | ForEach-Object {
  if (-not (Test-Path -Path $_)) {
    New-Item -Path $_ -Force | Out-Null
  }
  Set-ItemProperty -Path $_ -Name '(default)' -Value $manifestPath -Force
}

# 2. Registrar Extensão Externa no Chrome e Edge
@($chromeExtReg, $edgeExtReg) | ForEach-Object {
  if (-not (Test-Path -Path $_)) {
    New-Item -Path $_ -Force | Out-Null
  }
  Set-ItemProperty -Path $_ -Name 'update_url' -Value $updateManifestUrl -Force

  if ($ExtensionCrxPath -and (Test-Path -LiteralPath $ExtensionCrxPath)) {
    Set-ItemProperty -Path $_ -Name 'path' -Value $ExtensionCrxPath -Force
  }
}

# 3. Provisionar pasta descompactada da extensão para Chrome/Edge
$sourceExtCandidates = @(
  (Join-Path $InstallRoot 'resources\chrome-extension'),
  (Join-Path $InstallRoot 'chrome-extension'),
  (Join-Path $projectRoot 'dist-extension'),
  (Join-Path $projectRoot 'chrome-extension')
)
$sourceExt = $sourceExtCandidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'manifest.json') } | Select-Object -First 1

$extensionTargetDir = Join-Path $env:LOCALAPPDATA 'GatilhoBR\chrome-extension'
if ($sourceExt) {
  New-Item -ItemType Directory -Force -Path $extensionTargetDir | Out-Null
  Copy-Item -LiteralPath "$sourceExt\*" -Destination $extensionTargetDir -Recurse -Force
  Write-Host "  -> Extension Path: $extensionTargetDir" -ForegroundColor DarkGray
}

Write-Host "[GatilhoBR] Integração externa e Native Messaging registrados com sucesso:" -ForegroundColor Green
Write-Host "  -> Host Manifest: $manifestPath" -ForegroundColor DarkGray
Write-Host "  -> Extension ID:  $extensionId" -ForegroundColor DarkGray
Write-Host "  -> Update URL:    $updateManifestUrl" -ForegroundColor DarkGray
