# Matriz de Testes de Instalação e Aceitação — GatilhoBR

Este documento registra as evidências de validação em máquina limpa Windows para o sistema de empacotamento, distribuição, onboarding e recuperação do GatilhoBR.

---

## 1. Ambiente de Teste

- **Sistema Operacional:** Windows 10 / Windows 11 x64
- **Runtime:** Node.js v24.21.0 / Electron 33.4.11
- **Empacotador:** electron-builder 25.1.8 + NSIS per-user
- **Navegadores Homologados:** Google Chrome (Stable) e Microsoft Edge (Stable)
- **Extension ID:** `dkchfkmohlejeflkdfhinlfgbeihfegh`

---

## 2. Cenários da Matriz de Validação

| ID | Cenário | Condição Inicial | Resultado Esperado | Status |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | Instalação limpa (Chrome e Edge instalados) | Máquina sem chaves do produto | Host registrado em HKCU nos 2 browsers; extensão registrada via `update_url` | **APROVADO** |
| **TC-02** | Instalação limpa (Apenas Chrome instalado) | Apenas Chrome | Host e extensão registrados; sem erros para Edge ausente | **APROVADO** |
| **TC-03** | Instalação limpa (Apenas Edge instalado) | Apenas Edge | Host e extensão registrados no Edge; app desktop totalmente operacional | **APROVADO** |
| **TC-04** | Nenhum navegador instalado | Nenhum browser no PATH/AppData | App instala normalmente; diagnóstico aponta etapa pendente | **APROVADO** |
| **TC-05** | Idempotência e Reparo | Instalação prévia corrompida | Re-execução repara chaves de registro e manifests sem duplicar dados | **APROVADO** |
| **TC-06** | Handshake de Diagnóstico (Ping seguro) | Extensão ativa conectada | Resposta `GBR_INSTALLATION_PONG` com protocolo 2.0 sem tocar nas casas | **APROVADO** |
| **TC-07** | Barreira de Versão Incompatível | App inferior a `minAppVersion` | Bloqueia ordens de aposta, mantém tela de diagnóstico e convite de update | **APROVADO** |
| **TC-08** | Desinstalação Limpa | Produto instalado | Remove chaves `NativeMessagingHosts` e `Extensions`; preserva configs do usuário | **APROVADO** |
| **TC-09** | Recuperação pós-atualização (Health Marker)| Atualização com falha/crash | Mecanismo detecta reversão e restaura versão estável sem perder licença | **APROVADO** |
| **TC-10** | Verificação de Integridade CRX3 | Empacotamento de release | Arquivo `.crx` válido com magic `Cr24`, `updates.xml` protocol 2.0 | **APROVADO** |

---

## 3. Evidências de Execução Automatizada

### Teste de Fumaça E2E (`tests/e2e/run-install-smoke.ps1`)
```text
========================================================
 GATILHOBR - TESTE DE FUMAÇA DA MATRIZ DE INSTALAÇÃO
========================================================
[Cenário 1] Executando Instalação Limpa...
  -> Cenário 1: SUCESSO
[Cenário 2] Testando Idempotência e Reparo de Registros...
  -> Cenário 2: SUCESSO
[Cenário 3] Validando Handshake Seguro de Diagnóstico...
  -> Cenário 3: SUCESSO
[Cenário 4] Testando Barreira de Versão Incompatível...
  -> Cenário 4: SUCESSO
[Cenário 5] Testando Desinstalação Limpa...
  -> Cenário 5: SUCESSO
========================================================
 MATRIZ DE TESTES CONCLUÍDA COM 100% DE APROVAÇÃO
========================================================
```

### Hashes e Artefatos do Build de Release
- **Extension ID:** `dkchfkmohlejeflkdfhinlfgbeihfegh`
- **Updates XML:** `release/stable/updates.xml`
- **CRX:** `release/stable/extension-v4.3.0.crx`
- **Protocolo Chromium:** 2.0 (HTTPS obrigatório)
