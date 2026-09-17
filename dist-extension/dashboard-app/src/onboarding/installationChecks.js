/**
 * @module installationChecks
 * Máquina de estados de diagnóstico e validação do fluxo de instalação/onboarding do GatilhoBR.
 */

const InstallationStep = {
  APP_BINARIES: 'APP_BINARIES',
  NATIVE_HOST: 'NATIVE_HOST',
  BROWSER: 'BROWSER',
  EXTENSION: 'EXTENSION',
  HANDSHAKE: 'HANDSHAKE',
  COMPLETED: 'COMPLETED'
};

const StepsList = [
  { id: InstallationStep.APP_BINARIES, title: 'Arquivos do Aplicativo', description: 'Binários locais do GatilhoBR' },
  { id: InstallationStep.NATIVE_HOST, title: 'Host Native Messaging', description: 'Registro do host nativo em HKCU' },
  { id: InstallationStep.BROWSER, title: 'Navegador Compatível', description: 'Detecção de Google Chrome ou Microsoft Edge' },
  { id: InstallationStep.EXTENSION, title: 'Extensão GatilhoBR', description: 'Extensão instalada e ativa no navegador' },
  { id: InstallationStep.HANDSHAKE, title: 'Comunicação Segura', description: 'Ping de integridade sem execução de apostas' },
  { id: InstallationStep.COMPLETED, title: 'Instalação Concluída', description: 'Sistema 100% calibrado e operacional' }
];

/**
 * Normaliza erros brutos de IPC, processo ou porta para mensagens compreensíveis.
 */
function normalizeInstallationError(err) {
  const raw = err ? (err.message || String(err)) : 'Erro desconhecido';

  if (/native host|gatilhobr-host|exit code/i.test(raw)) {
    return {
      code: 'HOST_PROCESS_ERROR',
      userMessage: 'Host nativo não está em execução ou foi encerrado.',
      actionable: 'Clique em "Reparar Integração" para reinstalar os registros.',
      raw
    };
  }

  if (/extension|port disconnected|could not establish/i.test(raw)) {
    return {
      code: 'EXTENSION_DISCONNECTED',
      userMessage: 'Extensão não encontrada ou desabilitada no navegador.',
      actionable: 'Abra a página de extensões e certifique-se de que o GatilhoBR está ativado.',
      raw
    };
  }

  if (/version|incompat/i.test(raw)) {
    return {
      code: 'VERSION_MISMATCH',
      userMessage: 'Versão da extensão incompatível com o aplicativo desktop.',
      actionable: 'Atualize o aplicativo e a extensão para a mesma versão.',
      raw
    };
  }

  return {
    code: 'GENERIC_INSTALL_ERROR',
    userMessage: `Falha na verificação: ${raw}`,
    actionable: 'Tente novamente ou clique em "Reparar Integração".',
    raw
  };
}

/**
 * Calcula o estado consolidado da instalação com base nos diagnósticos do sistema.
 */
function computeInstallationStatus(data = {}) {
  const appVersion = data.appVersion || '4.3.0';
  const expectedExtensionVersion = data.expectedExtensionVersion || appVersion;
  const extensionVersion = data.extensionVersion || null;
  const browsers = data.browsers || { chrome: false, edge: false };
  const nativeHost = data.nativeHost || { registered: false, running: false };
  const extensionActive = Boolean(data.extensionActive || data.extensionInstalled || data.detectedExtension?.installed);
  const completed = Boolean(data.completed);

  const hasBrowser = Boolean(browsers.chrome || browsers.edge);

  // 1. Checar registro do host nativo
  if (!nativeHost.registered) {
    return {
      state: 'missing',
      compatible: false,
      currentStep: StepsList.find(s => s.id === InstallationStep.NATIVE_HOST),
      message: 'Host Native Messaging não está registrado no sistema.',
      actions: ['repair', 'retry-connection'],
      details: { nativeHost, browsers, appVersion }
    };
  }

  // 2. Checar presença de ao menos um navegador
  if (!hasBrowser) {
    return {
      state: 'missing',
      compatible: false,
      currentStep: StepsList.find(s => s.id === InstallationStep.BROWSER),
      message: 'Nenhum navegador compatível (Google Chrome ou Microsoft Edge) foi detectado.',
      actions: ['repair', 'retry-connection'],
      details: { nativeHost, browsers, appVersion }
    };
  }

  // 3. Checar se a extensão está ativa
  if (!extensionActive) {
    return {
      state: 'disabled',
      compatible: false,
      currentStep: StepsList.find(s => s.id === InstallationStep.EXTENSION),
      message: 'A extensão GatilhoBR ainda não foi detectada ou está desativada no navegador.',
      actions: ['open-extension-page', 'repair', 'retry-connection'],
      details: { nativeHost, browsers, appVersion }
    };
  }

  // 4. Checar compatibilidade de versões
  if (extensionVersion && extensionVersion !== expectedExtensionVersion) {
    return {
      state: 'incompatible',
      compatible: false,
      currentStep: StepsList.find(s => s.id === InstallationStep.HANDSHAKE),
      message: `Versão incompatível: Extensão (v${extensionVersion}) e App (v${appVersion}). Atualize para sincronizar.`,
      actions: ['repair', 'retry-connection'],
      details: { nativeHost, browsers, appVersion, extensionVersion, expectedExtensionVersion }
    };
  }

  // 5. Instalação concluída com sucesso
  return {
    state: 'connected',
    compatible: true,
    currentStep: StepsList.find(s => s.id === InstallationStep.COMPLETED),
    message: 'GatilhoBR está conectado e pronto para operação.',
    actions: ['open-dashboard'],
    details: {
      appVersion,
      extensionVersion: extensionVersion || expectedExtensionVersion,
      browsers,
      nativeHost,
      completed: true
    }
  };
}

module.exports = {
  InstallationStep,
  StepsList,
  normalizeInstallationError,
  computeInstallationStatus
};
