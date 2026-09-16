# GatilhoBR — Distribuição, Instalação e Atualizações

## Objetivo

Entregar um único instalador Windows que instale o aplicativo GatilhoBR, o
Native Messaging host e a extensão no Chrome/Edge sem depender da Chrome Web
Store, conduzindo o usuário por um onboarding verificável e permitindo releases
frequentes com rollback seguro.

## Decisões

- A distribuição externa usa um CRX assinado com a chave já presente no
  `manifest.json`; o ID da extensão nunca pode mudar entre releases.
- Um `updates.xml` HTTPS e o CRX versionado ficam em um canal próprio (`stable`
  e opcionalmente `beta`).
- O instalador registra a extensão como externa por usuário (`HKCU`) e registra
  o Native Messaging host para Chrome e Edge. Não há escrita em `HKLM` nem
  exigência de administrador para o caminho padrão.
- O instalador é NSIS via electron-builder, não one-click, e é idempotente:
  executar novamente repara arquivos, registros e atalhos sem apagar dados do
  usuário.
- O aplicativo usa `electron-updater` com artefatos publicados; o updater deve
  baixar, validar, instalar e reiniciar o app. O endpoint atual de `version.json`
  continua como compatibilidade/telemetria, não como mecanismo de instalação.
- A extensão é atualizada pelo mecanismo externo do navegador. O app compara
  versões app/extensão e bloqueia operações incompatíveis com uma mensagem
  acionável.

## Fluxo de instalação

1. O usuário executa `GatilhoBR-Setup.exe`.
2. NSIS encerra apenas processos auxiliares do GatilhoBR, preserva o navegador,
   instala o app e o host nativo em `%LOCALAPPDATA%\\GatilhoBR` e cria atalhos.
3. O instalador grava manifestos Native Messaging com caminho absoluto e
   `allowed_origins` para o ID fixo da extensão em:
   - `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\...`
   - `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\...`
4. O instalador registra o CRX/update manifest externo para Chrome e Edge,
   usando o mesmo ID e um endpoint HTTPS configurável por canal.
5. O instalador inicia o app e passa `--onboarding=install`.
6. O app abre a tela de onboarding e executa checks reais, em ordem: arquivos,
   host/registro, navegador detectado, extensão instalada e habilitada,
   conexão Native Messaging, autenticação/licença e teste de comunicação.
7. Cada falha apresenta causa, ação automática possível e botão “Tentar
   novamente”; não há sucesso baseado apenas em arquivo existente.
8. O último passo abre uma casa suportada em modo seguro e envia um ping que não
   executa aposta. O usuário só vê “Concluído” depois de receber a confirmação.

## Onboarding e contrato entre componentes

O app expõe via IPC um diagnóstico tipado (`get-installation-status`) e ações
idempotentes (`repair-browser-integration`, `open-extension-page`,
`retry-native-connection`). O diagnóstico inclui versão do app, versão esperada
da extensão, navegadores detectados, estado do registro, estado do host e último
erro normalizado.

A extensão mantém um estado mínimo em `chrome.storage.local` (`installState`,
`lastSeenAppVersion`, `lastOnboardingStep`) e responde a um ping de diagnóstico.
Em `runtime.onInstalled` e `runtime.onStartup`, ela tenta o host nativo e abre o
onboarding somente quando o estado ainda não está concluído ou há incompatibilidade.

## Atualizações e recuperação

- O pipeline publica, por release, instalador NSIS, `latest.yml`/artefatos do
  electron-updater, CRX e `updates.xml`, com SHA-256 e assinatura Authenticode
  quando o certificado estiver disponível.
- O app verifica atualizações no startup (silencioso) e em intervalo limitado;
  a UI oferece “Baixar e reiniciar” e informa notas, tamanho e versão.
- Atualização obrigatória é reservada a correções críticas e mantém uma janela
  explícita de reinício.
- Antes de substituir o app, o updater mantém a versão anterior; falha de
  instalação ou health-check pós-restart restaura o executável anterior e marca
  o release como falho.
- A extensão valida a versão mínima do app recebida no handshake. Em caso de
  incompatibilidade, desabilita somente a execução e orienta atualizar/reparar;
  não remove dados do usuário.
- O endpoint de atualização tem cache-control curto, JSON/XML versionados e
  monitoramento de disponibilidade; releases antigas permanecem acessíveis para
  rollback.

## Segurança e privacidade

- O instalador valida origem HTTPS, hash e assinatura antes de instalar payloads.
- Caminhos de registro e arquivos são derivados de uma raiz conhecida; nenhuma
  entrada fornecida pela extensão vira comando de shell.
- O host nativo aceita apenas mensagens do protocolo e do ID esperado, limita
  tamanho e registra erros sem vazar cookies/tokens.
- Desinstalação remove registros, atalhos e binários criados pelo produto, mas
  preserva configuração/licença mediante opção explícita de limpeza completa.

## Compatibilidade e testes de aceitação

- Windows 10/11 x64, Chrome estável e Edge estável; ausência de um navegador
  não impede instalação do app e é apresentada como etapa pendente.
- Matriz automatizada cobre instalação limpa, reparo, upgrade, downgrade/rollback,
  extensão ausente/desabilitada, registro corrompido, host indisponível,
  navegador fechado e rede offline.
- Teste manual de fumaça valida onboarding em uma máquina limpa, reinício do
  navegador, atualização do CRX e atualização do app sem perder configuração.

## Fora de escopo do primeiro release

- Publicação na Chrome Web Store.
- Suporte a macOS/Linux.
- Instalação silenciosa sem consentimento do usuário.
- Atualização automática de código da extensão fora do mecanismo de atualização
  do navegador.
