# GatilhoBR Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um instalador Windows que instale app, Native Messaging e extensão externa em Chrome/Edge, conduza onboarding verificável e atualize app/extensão com rollback.

**Architecture:** NSIS/electron-builder instala um payload versionado e executa um helper PowerShell idempotente para manifestos e registros por usuário. O Electron expõe diagnóstico/repair por IPC e uma tela de onboarding; o navegador atualiza o CRX por `updates.xml`, enquanto `electron-updater` atualiza o app por `latest.yml`.

**Tech Stack:** Electron 33, electron-builder 25, NSIS, Node.js, PowerShell, Chrome/Edge external extension distribution, `electron-updater`, Vitest/Node test runner conforme harness existente.

**Spec:** `docs/superpowers/specs/2026-09-15-gatilhobr-distribution-design.md`

## Global Constraints

- O ID e a chave da extensão definidos em `manifest.json` permanecem imutáveis.
- Instalação padrão usa somente `HKCU` e não exige administrador.
- Nenhuma atualização ou onboarding pode executar uma aposta real.
- Dados de usuário/licença devem sobreviver a reparo, upgrade e rollback.
- Payloads externos só são aceitos via HTTPS e com hash/verificação de assinatura.
- Chrome é o caminho principal; Edge é habilitado quando detectado.

---

### Task 1: Contrato de release e artefatos da extensão

**Files:**
- Modify: `package.json` (scripts e configuração `build`)
- Create: `scripts/build-extension-release.js`
- Create: `release/README.md`
- Test: `tests/release/build-extension-release.test.js`

**Interfaces:**
- Produces `release/<channel>/extension-v<version>.crx`, `updates.xml` e `checksums.txt`.
- Consumes `manifest.json` e a variável `GBR_UPDATE_BASE_URL`.

- [x] **Step 1: Write the failing test** verificando que o builder rejeita versão diferente entre `package.json` e `manifest.json`, preserva o `key` e gera XML com o ID esperado.
- [x] **Step 2: Run test to verify it fails** com `node --test tests/release/build-extension-release.test.js`.
- [x] **Step 3: Implement minimal builder**: validar semver, copiar somente arquivos da extensão, empacotar CRX usando chave de release configurada, gerar `updates.xml` com `codebase` HTTPS, SHA-256 e checksum.
- [x] **Step 4: Add scripts** `build:extension-release` e `build:release` (native host → extension → desktop).
- [x] **Step 5: Run test to verify it passes** e execute o builder contra um diretório temporário.
- [x] **Step 6: Commit** `feat: add signed extension release artifacts`.

### Task 2: Integração externa Chrome/Edge e Native Messaging idempotente

**Files:**
- Modify: `scripts/Install-GatilhoBRChrome.ps1`
- Modify: `native-host/com.gatilho.native_messaging.json`
- Create: `scripts/Register-GatilhoBRIntegration.ps1`
- Create: `tests/install/register-integration.test.ps1`

**Interfaces:**
- `Register-GatilhoBRIntegration.ps1 -InstallRoot -Channel -UpdateBaseUrl -ExtensionCrxPath` registra/remedia tudo e retorna código não zero em erro.
- Registro externo usa o ID fixo e update URL do canal para Chrome e Edge.

- [x] **Step 1: Write the failing PowerShell checks** para HKCU Chrome/Edge, caminhos absolutos, `allowed_origins` e execução repetida sem duplicar estado.
- [x] **Step 2: Run checks against a disposable HKCU-compatible test fixture** e confirme falha antes do helper existir.
- [x] **Step 3: Implement helper** com validação de URL HTTPS, criação de diretórios, cópia atômica, escrita de manifests e limpeza apenas de entradas do produto.
- [x] **Step 4: Atualizar script antigo** para delegar ao helper e manter suporte de desenvolvimento.
- [x] **Step 5: Verify** em máquina Windows limpa: install, rerun, repair e uninstall; documente comandos em `release/README.md`.
- [x] **Step 6: Commit** `feat: register external extension and native host`.

### Task 3: NSIS customizado e fluxo pós-instalação

**Files:**
- Modify: `package.json` (`build.nsis`, `extraResources`, `afterPack`/`afterAllArtifactBuild`)
- Create: `build/installer/register-integration.ps1`
- Create: `build/installer/onboarding-launcher.js`
- Create: `tests/install/installer-config.test.js`

**Interfaces:**
- NSIS chama o helper com `InstallRoot`, canal e URL embutidos; executa `GatilhoBR.exe --onboarding=install` ao concluir.
- Reparar e desinstalar são seguros e não encerram Chrome/Edge.

- [x] **Step 1: Write failing config tests** para targets NSIS/portable, script de instalação, atalho e argumentos de onboarding.
- [x] **Step 2: Run tests** e confirme que a configuração atual não satisfaz os requisitos.
- [x] **Step 3: Implement custom NSIS include/hooks** com `customInstall`, `customUnInstall`, `RunOnce` e cópia dos manifests/CRX necessários.
- [x] **Step 4: Make packaging fail closed** se a extensão não tiver `key`, o host não existir ou URL não for HTTPS.
- [x] **Step 5: Run `npm run pack`** e inspecione `builder-effective-config.yaml` e o conteúdo de `win-unpacked`.
- [x] **Step 6: Commit** `feat: add guided NSIS installer flow`.

### Task 4: Diagnóstico IPC e onboarding no Electron

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload-dashboard.js`
- Modify: `dashboard-app/src/*` (tela/estado de onboarding existente)
- Create: `dashboard-app/src/onboarding/installationChecks.js`
- Test: `tests/onboarding/installationChecks.test.js`

**Interfaces:**
- IPC `gbr:get-installation-status` retorna `{appVersion, extensionVersion, expectedExtensionVersion, browsers, nativeHost, compatible, completed}`.
- IPC `gbr:repair-browser-integration`, `gbr:open-extension-page` e `gbr:retry-native-connection` são idempotentes.

- [x] **Step 1: Write failing unit tests** para estados `missing`, `disabled`, `connected`, `incompatible` e para retry sem efeitos colaterais.
- [x] **Step 2: Run tests** e confirme falha por IPC/checagens ausentes.
- [x] **Step 3: Implement backend checks** lendo apenas caminhos conhecidos, consultando processos/registro e validando handshake Native Messaging.
- [x] **Step 4: Expor APIs no preload** com whitelist explícita.
- [x] **Step 5: Implement onboarding UI** com etapas, mensagens em português, CTA de reparar/abrir extensões/retry e ping seguro.
- [x] **Step 6: Verify** com app sem navegador, host ausente, extensão desabilitada, incompatibilidade e sucesso; commit `feat: add installation onboarding diagnostics`.

### Task 5: Atualizador real do aplicativo e compatibilidade app/extensão

**Files:**
- Modify: `electron/updater.js`
- Modify: `electron/main.js`
- Modify: `dashboard-app/src/*` (banner/modal de atualização)
- Modify: `package.json` (dependências e publish config)
- Create: `tests/update/updater.test.js`

**Interfaces:**
- `checkForUpdates()` mantém retorno compatível e adiciona `download`, `install`, `rollbackAvailable`.
- Handshake nativo inclui `appVersion`, `extensionVersion`, `minAppVersion` e `protocolVersion`.

- [x] **Step 1: Write failing tests** para semver, canal stable/beta, download cancelado, mandatory update e versão incompatível.
- [x] **Step 2: Run tests** e confirme que updater atual apenas consulta JSON.
- [x] **Step 3: Integrate `electron-updater`** com feed HTTPS, eventos de progresso, download/install e logs redigidos.
- [x] **Step 4: Implement health marker**: gravar tentativa antes do restart, confirmar saúde no próximo startup e restaurar versão anterior quando o marker expirar/falhar.
- [x] **Step 5: Implement UI actions** “Baixar e reiniciar”, “Depois” e “Ver detalhes”, respeitando mandatory.
- [x] **Step 6: Verify** offline, servidor indisponível, atualização válida e rollback simulado; commit `feat: ship resilient desktop updater`.

### Task 6: Estado da extensão e handshake de onboarding

**Files:**
- Modify: `background.js`
- Modify: `manifest.json`
- Create: `src/installationState.js`
- Test: `tests/extension/installationState.test.js`

**Interfaces:**
- `getInstallationState()`/`setInstallationState(patch)` persistem em `chrome.storage.local`.
- Mensagem `GBR_INSTALLATION_PING` responde com versão, protocolo, estado e capabilities sem executar ações de aposta.

- [x] **Step 1: Write failing tests** para defaults, migração de estado e ping seguro.
- [x] **Step 2: Run tests** e confirme ausência do contrato.
- [x] **Step 3: Implement state module** e integrar `onInstalled`, `onStartup` e conexão nativa com backoff.
- [x] **Step 4: Add minimum-app-version gate** que bloqueia somente execução incompatível e mantém diagnóstico/reparo.
- [x] **Step 5: Verify** reload da extensão, upgrade, host indisponível e compatibilidade; commit `feat: add extension installation handshake`.

### Task 7: Pipeline de publicação, assinatura e documentação operacional

**Files:**
- Create: `.github/workflows/release.yml` (ou pipeline equivalente detectado no ambiente)
- Create: `release/CHANNELS.md`
- Modify: `release/README.md`
- Create: `tests/release/release-manifest.test.js`

**Interfaces:**
- Cada tag `vX.Y.Z` produz installer, `latest.yml`, CRX, `updates.xml`, checksums e notas no canal escolhido.

- [x] **Step 1: Write failing manifest tests** para artefatos obrigatórios, URLs HTTPS, semver alinhado e retenção de release anterior.
- [x] **Step 2: Implement pipeline** com Node/PowerShell, cache de dependências, segredo opcional de certificado Authenticode e publicação atômica (`staging` → `stable`).
- [x] **Step 3: Add release checklist** incluindo rotação de chave somente com migração explícita, smoke test em máquina limpa e rollback.
- [x] **Step 4: Run pipeline locally in dry-run** e valide todos os manifests.
- [x] **Step 5: Commit** `ci: publish signed desktop and extension releases`.

### Task 8: Verificação final em máquina limpa

**Files:**
- Create: `tests/e2e/install-matrix.md`
- Create: `tests/e2e/run-install-smoke.ps1`

- [x] **Step 1:** Execute instalação limpa em Windows 10/11 x64 com Chrome, Edge, ambos e nenhum navegador.
- [x] **Step 2:** Execute repair, upgrade e uninstall; confira preservação/remoção de dados conforme especificação.
- [x] **Step 3:** Force versão incompatível e host parado; confirme mensagens acionáveis e ausência de execução.
- [x] **Step 4:** Teste atualização do CRX via `updates.xml` e atualização do app via `latest.yml`.
- [x] **Step 5:** Registre evidências, hashes e limitações conhecidas em `tests/e2e/install-matrix.md`.
- [x] **Step 6:** Commit `test: validate clean-machine installation matrix`.

