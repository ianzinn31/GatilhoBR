<#
.SYNOPSIS
  GatilhoBR - Script de Reset de Onboarding para Gravação de Vídeos e Testes
.DESCRIPTION
  Limpa o estado de conclusão do onboarding, cria as flags de inicialização
  e permite simular um primeiro acesso 100% limpo.
#>
[CmdletBinding()]
param(
  [switch]$Simulate,
  [switch]$LaunchApp
)

$ErrorActionPreference = 'SilentlyContinue'

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host "   GatilhoBR - Reset de Onboarding (Modo Tutorial)   " -ForegroundColor Green
Write-Host "=======================================================`n" -ForegroundColor Cyan

# 1. Pastas do AppData
$roamingApp = Join-Path $env:APPDATA 'gatilhobr-desktop'
$localApp   = Join-Path $env:LOCALAPPDATA 'GatilhoBR'

# 2. Garante pastas
if (-not (Test-Path $localApp)) { New-Item -ItemType Directory -Force -Path $localApp | Out-Null }
if (-not (Test-Path $roamingApp)) { New-Item -ItemType Directory -Force -Path $roamingApp | Out-Null }

# 3. Cria flags de onboarding pendente
$flag1 = Join-Path $localApp 'pending_onboarding.flag'
$flag2 = Join-Path $roamingApp 'pending_onboarding.flag'

[System.IO.File]::WriteAllText($flag1, (Get-Date).ToString("o"), [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($flag2, (Get-Date).ToString("o"), [System.Text.Encoding]::UTF8)

Write-Host "[OK] Flag de Onboarding criada em:" -ForegroundColor Green
Write-Host "     -> $flag1" -ForegroundColor Gray
Write-Host "     -> $flag2" -ForegroundColor Gray

# 4. Limpa Local Storage do Electron para garantir reset da flag 'gbr_onboarding_completed'
$lsDir = Join-Path $roamingApp 'Local Storage\leveldb'
if (Test-Path $lsDir) {
  try {
    # Tenta remover arquivos leveldb se o app não estiver em execução
    Remove-Item -Path "$lsDir\*" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Cache de LocalStorage do Electron limpo com sucesso." -ForegroundColor Green
  } catch {
    Write-Host "[INFO] LocalStorage em uso pelo Electron (o app limpará a flag via script)." -ForegroundColor Yellow
  }
}

Write-Host "`n✅ SISTEMA PRONTO PARA GRAVAÇÃO DO TUTORIAL!" -ForegroundColor Green
Write-Host "-------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "Dicas para o seu vídeo:" -ForegroundColor White
Write-Host "1. Abra o GatilhoBR normalmente (pelo atalho ou 'npm start')." -ForegroundColor Gray
Write-Host "2. O Guia de Instalação (Onboarding) abrirá na tela inicial." -ForegroundColor Gray
Write-Host "3. Se quiser forçar a mensagem 'Extensão Ainda Não Instalada'," -ForegroundColor Gray
Write-Host "   basta clicar no botão '🎥 Modo Vídeo / Novo Usuário' no topo do modal," -ForegroundColor Yellow
Write-Host "   ou pressionar F10 a qualquer momento!" -ForegroundColor Yellow
Write-Host "-------------------------------------------------------`n" -ForegroundColor DarkGray

if ($LaunchApp) {
  $exeInstalled = Join-Path $env:LOCALAPPDATA 'Programs\GatilhoBR\GatilhoBR.exe'
  if (Test-Path $exeInstalled) {
    Write-Host "Iniciando GatilhoBR instalado..." -ForegroundColor Cyan
    Start-Process $exeInstalled -ArgumentList "--onboarding=install"
  } else {
    Write-Host "Iniciando via npm start..." -ForegroundColor Cyan
    Start-Process "npm.cmd" -ArgumentList "start"
  }
}
