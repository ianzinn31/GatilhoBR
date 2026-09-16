<#
.SYNOPSIS
  GatilhoBR - Script empacotado para execução pelo instalador NSIS.
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

# 1. Encerra processo órfão do host nativo
Get-Process -Name 'gatilhobr-host' -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 150

$chromeHostReg = Join-Path $RegistryHiveRoot "Google\Chrome\NativeMessagingHosts\$hostName"
$edgeHostReg   = Join-Path $RegistryHiveRoot "Microsoft\Edge\NativeMessagingHosts\$hostName"
$chromeExtReg  = Join-Path $RegistryHiveRoot "Google\Chrome\Extensions\$extensionId"
$edgeExtReg    = Join-Path $RegistryHiveRoot "Microsoft\Edge\Extensions\$extensionId"

if ($Uninstall) {
  @($chromeHostReg, $edgeHostReg, $chromeExtReg, $edgeExtReg) | ForEach-Object {
    if (Test-Path -Path $_) {
      Remove-Item -Path $_ -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  exit 0
}

$cleanUpdateBaseUrl = $UpdateBaseUrl.TrimEnd('/')
if (-not $cleanUpdateBaseUrl.StartsWith('https://', [System.StringComparison]::OrdinalIgnoreCase)) {
  Write-Error "UpdateBaseUrl inválida. Endpoints de atualização devem usar HTTPS: $UpdateBaseUrl"
  exit 1
}

$updateManifestUrl = "$cleanUpdateBaseUrl/$Channel/updates.xml"
$hostTargetDir = Join-Path $InstallRoot 'native-host'
New-Item -ItemType Directory -Force -Path $hostTargetDir | Out-Null

$hostExeTarget = Join-Path $hostTargetDir 'gatilhobr-host.exe'
$manifestPath = Join-Path $hostTargetDir "$hostName.json"

$manifestObj = [ordered]@{
  name            = $hostName
  description     = 'GatilhoBR Native Messaging host'
  path            = $hostExeTarget
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$extensionId/")
}

$manifestJson = $manifestObj | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.Encoding]::UTF8)

# Registrar Chrome e Edge
@($chromeHostReg, $edgeHostReg) | ForEach-Object {
  if (-not (Test-Path -Path $_)) { New-Item -Path $_ -Force | Out-Null }
  Set-ItemProperty -Path $_ -Name '(default)' -Value $manifestPath -Force
}

@($chromeExtReg, $edgeExtReg) | ForEach-Object {
  if (-not (Test-Path -Path $_)) { New-Item -Path $_ -Force | Out-Null }
  Set-ItemProperty -Path $_ -Name 'update_url' -Value $updateManifestUrl -Force
  if ($ExtensionCrxPath -and (Test-Path -LiteralPath $ExtensionCrxPath)) {
    Set-ItemProperty -Path $_ -Name 'path' -Value $ExtensionCrxPath -Force
  }
}

# 3. Cria marcador de onboarding pendente pós-instalação
$onboardingFlagDir = Join-Path $env:LOCALAPPDATA 'GatilhoBR'
New-Item -ItemType Directory -Force -Path $onboardingFlagDir | Out-Null
$onboardingFlag = Join-Path $onboardingFlagDir 'pending_onboarding.flag'
[System.IO.File]::WriteAllText($onboardingFlag, (Get-Date).ToString("o"), [System.Text.Encoding]::UTF8)

$roamingFlagDir = Join-Path $env:APPDATA 'gatilhobr-desktop'
New-Item -ItemType Directory -Force -Path $roamingFlagDir | Out-Null
$roamingFlag = Join-Path $roamingFlagDir 'pending_onboarding.flag'
[System.IO.File]::WriteAllText($roamingFlag, (Get-Date).ToString("o"), [System.Text.Encoding]::UTF8)


