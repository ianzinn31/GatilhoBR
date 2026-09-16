<#
.SYNOPSIS
  GatilhoBR - Script de Smoke Test Automatizado da Matriz de Instalação.

.DESCRIPTION
  Executa validação completa em ambiente Windows:
  1. Instalação limpa
  2. Idempotência / Reparo
  3. Integridade de Manifestos e Registros (Chrome e Edge)
  4. Handshake de diagnóstico (Ping seguro)
  5. Barreira de versão incompatível
  6. Desinstalação limpa
#>

[CmdletBinding()]
param(
  [string]$TestRoot = (Join-Path $env:TEMP ("gbr-smoke-" + [System.Guid]::NewGuid().ToString('N'))),
  [string]$RegistryHive = "HKCU:\Software\GatilhoBRSmokeTest"
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helperScript = Join-Path $projectRoot 'scripts\Register-GatilhoBRIntegration.ps1'

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " GATILHOBR - TESTE DE FUMAÇA DA MATRIZ DE INSTALAÇÃO   " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Raiz temporária: $TestRoot" -ForegroundColor DarkGray
Write-Host "Hive de teste:   $RegistryHive" -ForegroundColor DarkGray
Write-Host ""

$results = [ordered]@{}

try {
  # -------------------------------------------------------------------
  # CENÁRIO 1: INSTALAÇÃO LIMPA
  # -------------------------------------------------------------------
  Write-Host "[Cenário 1] Executando Instalação Limpa..." -ForegroundColor Yellow
  & $helperScript -InstallRoot $TestRoot -Channel "stable" -UpdateBaseUrl "https://releases.gatilhobr.com" -RegistryHiveRoot $RegistryHive

  $manifestPath = Join-Path $TestRoot 'native-host\com.gatilho.native_messaging.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Manifesto do host não encontrado" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne 'com.gatilho.native_messaging') { throw "Nome do manifesto incorreto" }

  $chromeHostReg = Join-Path $RegistryHive 'Google\Chrome\NativeMessagingHosts\com.gatilho.native_messaging'
  $edgeHostReg   = Join-Path $RegistryHive 'Microsoft\Edge\NativeMessagingHosts\com.gatilho.native_messaging'
  $chromeExtReg  = Join-Path $RegistryHive 'Google\Chrome\Extensions\dkchfkmohlejeflkdfhinlfgbeihfegh'
  $edgeExtReg    = Join-Path $RegistryHive 'Microsoft\Edge\Extensions\dkchfkmohlejeflkdfhinlfgbeihfegh'

  if (-not (Test-Path -Path $chromeHostReg) -or -not (Test-Path -Path $edgeHostReg)) {
    throw "Chaves de Native Messaging ausentes no registro."
  }
  if (-not (Test-Path -Path $chromeExtReg) -or -not (Test-Path -Path $edgeExtReg)) {
    throw "Chaves de Extensão Externa ausentes no registro."
  }

  $results["Cenário 1 - Instalação Limpa"] = "PASSOU"
  Write-Host "  -> Cenário 1: SUCESSO" -ForegroundColor Green

  # -------------------------------------------------------------------
  # CENÁRIO 2: IDEMPOTÊNCIA E REPARO
  # -------------------------------------------------------------------
  Write-Host "`n[Cenário 2] Testando Idempotência e Reparo de Registros..." -ForegroundColor Yellow
  & $helperScript -InstallRoot $TestRoot -Channel "stable" -UpdateBaseUrl "https://releases.gatilhobr.com" -RegistryHiveRoot $RegistryHive

  # Conferir se os valores continuam consistentes
  $updateUrl = (Get-ItemProperty -Path $chromeExtReg).'update_url'
  if ($updateUrl -ne "https://releases.gatilhobr.com/stable/updates.xml") {
    throw "update_url divergiu após re-execução."
  }

  $results["Cenário 2 - Idempotência e Reparo"] = "PASSOU"
  Write-Host "  -> Cenário 2: SUCESSO" -ForegroundColor Green

  # -------------------------------------------------------------------
  # CENÁRIO 3: HANDSHAKE SEGURO E DIAGNÓSTICO
  # -------------------------------------------------------------------
  Write-Host "`n[Cenário 3] Validando Handshake Seguro de Diagnóstico..." -ForegroundColor Yellow
  $pingTest = node -e "
    const { handleInstallationPing } = require('./src/installationState');
    const res = handleInstallationPing({ message: { type: 'GBR_INSTALLATION_PING' }, extensionVersion: '4.3.0' });
    if (res.type !== 'GBR_INSTALLATION_PONG' || res.safeMode !== true) process.exit(1);
    console.log(JSON.stringify(res));
  "
  if ($LASTEXITCODE -ne 0) { throw "Falha no handshake seguro do ping." }

  $results["Cenário 3 - Handshake Seguro"] = "PASSOU"
  Write-Host "  -> Cenário 3: SUCESSO" -ForegroundColor Green

  # -------------------------------------------------------------------
  # CENÁRIO 4: BARREIRA DE VERSÃO INCOMPATÍVEL
  # -------------------------------------------------------------------
  Write-Host "`n[Cenário 4] Testando Barreira de Versão Incompatível..." -ForegroundColor Yellow
  $compatTest = node -e "
    const { canExecuteOperationalOrders } = require('./src/installationState');
    const check = canExecuteOperationalOrders({ appVersion: '3.5.0', minAppVersion: '4.0.0' });
    if (check.allowed !== false || check.canDiagnose !== true) process.exit(1);
    console.log('Bloqueio confirmado:', check.reason);
  "
  if ($LASTEXITCODE -ne 0) { throw "Falha na barreira de compatibilidade." }

  $results["Cenário 4 - Barreira de Versão"] = "PASSOU"
  Write-Host "  -> Cenário 4: SUCESSO" -ForegroundColor Green

  # -------------------------------------------------------------------
  # CENÁRIO 5: DESINSTALAÇÃO LIMPA
  # -------------------------------------------------------------------
  Write-Host "`n[Cenário 5] Testando Desinstalação Limpa..." -ForegroundColor Yellow
  # Criar arquivo simulado de configurações de usuário para conferir que não é apagado
  $userConfigFile = Join-Path $TestRoot 'user-settings.json'
  Set-Content -LiteralPath $userConfigFile -Value '{"license":"ACTIVE"}'

  & $helperScript -InstallRoot $TestRoot -RegistryHiveRoot $RegistryHive -Uninstall

  if (Test-Path -Path $chromeHostReg) { throw "Registro Chrome Host não foi removido" }
  if (Test-Path -Path $edgeHostReg) { throw "Registro Edge Host não foi removido" }
  if (Test-Path -Path $chromeExtReg) { throw "Registro Chrome Extensão não foi removido" }
  if (Test-Path -Path $edgeExtReg) { throw "Registro Edge Extensão não foi removido" }
  if (-not (Test-Path -LiteralPath $userConfigFile)) { throw "Dados de usuário foram indevidamente apagados!" }

  $results["Cenário 5 - Desinstalação Limpa"] = "PASSOU"
  Write-Host "  -> Cenário 5: SUCESSO" -ForegroundColor Green

  Write-Host "`n========================================================" -ForegroundColor Green
  Write-Host " MATRIZ DE TESTES CONCLUÍDA COM 100% DE APROVAÇÃO       " -ForegroundColor Green
  Write-Host "========================================================" -ForegroundColor Green
  $results.GetEnumerator() | ForEach-Object {
    Write-Host "  $($_.Key): $($_.Value)" -ForegroundColor DarkGray
  }
} finally {
  if (Test-Path -LiteralPath $TestRoot) {
    Remove-Item -LiteralPath $TestRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -Path $RegistryHive) {
    Remove-Item -Path $RegistryHive -Recurse -Force -ErrorAction SilentlyContinue
  }
}
