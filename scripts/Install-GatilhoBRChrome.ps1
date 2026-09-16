<#
GatilhoBR – instalação assistida da extensão no Chrome para desenvolvimento.

Delega o registro padronizado do Native Messaging e das extensões ao script
central Register-GatilhoBRIntegration.ps1 e mantém o suporte de conveniência
para carga descompactada em modo desenvolvedor.
#>
[CmdletBinding()]
param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'GatilhoBR'),
  [string]$Channel = 'stable',
  [string]$UpdateBaseUrl = 'https://releases.gatilhobr.com'
)
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$registerScript = Join-Path $PSScriptRoot 'Register-GatilhoBRIntegration.ps1'

# 1. Executar registro padronizado de Native Messaging e Extensão
& $registerScript -InstallRoot $InstallRoot -Channel $Channel -UpdateBaseUrl $UpdateBaseUrl

# 2. Cópia dos arquivos da extensão para perfil local (suporte a desenvolvimento descompactado)
$extensionTarget = Join-Path $InstallRoot 'chrome-extension'
New-Item -ItemType Directory -Force -Path $extensionTarget | Out-Null

$exclude = @('node_modules','dist-desktop','dist-native','release','tests','asar_tmp','.git','scripts','native-host','docs','build')
Get-ChildItem -LiteralPath $projectRoot -Force | Where-Object {
  $exclude -notcontains $_.Name
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $extensionTarget -Recurse -Force
}

Write-Host ''
Write-Host 'Extensão copiada para:' $extensionTarget -ForegroundColor Green
Write-Host 'Host Native Messaging e atualizações registradas no HKCU.' -ForegroundColor Green
Write-Host ''
Write-Host 'No Chrome/Edge: Para modo de desenvolvimento, você pode usar "Carregar sem compactação".' -ForegroundColor Yellow
Start-Process 'chrome.exe' -ArgumentList 'chrome://extensions' -ErrorAction SilentlyContinue
Start-Process 'explorer.exe' -ArgumentList "`"$extensionTarget`""
