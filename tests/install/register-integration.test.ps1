# Teste automatizado para Register-GatilhoBRIntegration.ps1
$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$helperScript = Join-Path $projectRoot 'scripts\Register-GatilhoBRIntegration.ps1'

Write-Host "=== TESTE: Register-GatilhoBRIntegration ===" -ForegroundColor Cyan

# 1. Verificar se o script helper existe
if (-not (Test-Path -LiteralPath $helperScript)) {
  Write-Error "FALHA: $helperScript não foi encontrado."
  exit 1
}

$tempRoot = Join-Path $env:TEMP ("gbr-regtest-" + [System.Guid]::NewGuid().ToString('N'))
$testHive = "HKCU:\Software\GatilhoBRIntegrationTest"
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
  # 2. Teste de rejeição de URL não-HTTPS
  Write-Host "1. Testando rejeição de URL não-HTTPS..."
  $failed = $false
  try {
    & $helperScript -InstallRoot $tempRoot -UpdateBaseUrl "http://insecure.example.com" -RegistryHiveRoot $testHive
  } catch {
    $failed = $true
  }
  if (-not $failed) {
    throw "Helper deveria ter falhado com URL HTTP não segura."
  }
  Write-Host "   -> Rejeição HTTPS OK" -ForegroundColor Green

  # 3. Teste de instalação / registro
  Write-Host "2. Testando registro inicial em hive de teste..."
  & $helperScript -InstallRoot $tempRoot -Channel "stable" -UpdateBaseUrl "https://releases.gatilhobr.com" -RegistryHiveRoot $testHive
  Write-Host "   -> Execução do helper concluída sem erros" -ForegroundColor Green

  # 4. Validar arquivos gerados
  $hostManifestPath = Join-Path $tempRoot 'native-host\com.gatilho.native_messaging.json'
  if (-not (Test-Path -LiteralPath $hostManifestPath)) {
    throw "Manifesto do host não gerado em $hostManifestPath"
  }
  $manifestJson = Get-Content -LiteralPath $hostManifestPath -Raw | ConvertFrom-Json
  if ($manifestJson.allowed_origins -notcontains 'chrome-extension://dkchfkmohlejeflkdfhinlfgbeihfegh/') {
    throw "allowed_origins incorreto: $($manifestJson.allowed_origins)"
  }
  if (-not $manifestJson.path.StartsWith($tempRoot)) {
    throw "Caminho do host não é absoluto para o InstallRoot: $($manifestJson.path)"
  }
  Write-Host "   -> Manifesto do host e allowed_origins OK" -ForegroundColor Green

  # 5. Validar chaves de registro Chrome e Edge
  $chromeHostReg = Join-Path $testHive 'Google\Chrome\NativeMessagingHosts\com.gatilho.native_messaging'
  $edgeHostReg = Join-Path $testHive 'Microsoft\Edge\NativeMessagingHosts\com.gatilho.native_messaging'
  $chromeExtReg = Join-Path $testHive 'Google\Chrome\Extensions\dkchfkmohlejeflkdfhinlfgbeihfegh'
  $edgeExtReg = Join-Path $testHive 'Microsoft\Edge\Extensions\dkchfkmohlejeflkdfhinlfgbeihfegh'

  $chromeVal = (Get-ItemProperty -Path $chromeHostReg -ErrorAction Stop).'(default)'
  $edgeVal = (Get-ItemProperty -Path $edgeHostReg -ErrorAction Stop).'(default)'
  if ($chromeVal -ne $hostManifestPath -or $edgeVal -ne $hostManifestPath) {
    throw "Registro de NativeMessagingHosts incorreto."
  }

  $chromeUpdateUrl = (Get-ItemProperty -Path $chromeExtReg -ErrorAction Stop).'update_url'
  $edgeUpdateUrl = (Get-ItemProperty -Path $edgeExtReg -ErrorAction Stop).'update_url'
  $expectedUpdateUrl = "https://releases.gatilhobr.com/stable/updates.xml"
  if ($chromeUpdateUrl -ne $expectedUpdateUrl -or $edgeUpdateUrl -ne $expectedUpdateUrl) {
    throw "Registro de update_url da extensão incorreto."
  }
  Write-Host "   -> Chaves de registro Chrome e Edge OK" -ForegroundColor Green

  # 6. Teste de Idempotência (execução repetida)
  Write-Host "3. Testando idempotência (re-execução)..."
  & $helperScript -InstallRoot $tempRoot -Channel "stable" -UpdateBaseUrl "https://releases.gatilhobr.com" -RegistryHiveRoot $testHive
  Write-Host "   -> Re-execução concluída sem duplicar ou corromper" -ForegroundColor Green

  # 7. Teste de Desinstalação
  Write-Host "4. Testando desinstalação..."
  & $helperScript -InstallRoot $tempRoot -RegistryHiveRoot $testHive -Uninstall
  if (Test-Path -Path $chromeHostReg) { throw "Chrome host reg ainda existe após uninstall" }
  if (Test-Path -Path $edgeHostReg) { throw "Edge host reg ainda existe após uninstall" }
  if (Test-Path -Path $chromeExtReg) { throw "Chrome ext reg ainda existe após uninstall" }
  if (Test-Path -Path $edgeExtReg) { throw "Edge ext reg ainda existe após uninstall" }
  Write-Host "   -> Desinstalação limpa OK" -ForegroundColor Green

  Write-Host "`n🎉 TODOS OS TESTES DO HELPER DE REGISTRO PASSARAM COM SUCESSO!`n" -ForegroundColor Green
} finally {
  # Limpar fixture
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -Path $testHive) {
    Remove-Item -Path $testHive -Recurse -Force -ErrorAction SilentlyContinue
  }
}
