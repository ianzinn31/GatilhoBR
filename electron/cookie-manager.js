// =========================================================================
// GATILHOBR DESKTOP - GERENCIADOR DE COOKIES E SESSÃO (ANTI-DETECÇÃO / EXPORT)
// =========================================================================

const { session, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * Importa um array ou string JSON de cookies para a partição especificada do Electron.
 * Compatível com o formato padrão exportado por extensões como "Cookie-Editor" e "EditThisCookie".
 */
async function importCookiesToPartition(partitionName, cookiesJsonOrArray) {
  let cookiesList = [];

  if (typeof cookiesJsonOrArray === 'string') {
    try {
      cookiesList = JSON.parse(cookiesJsonOrArray.trim());
    } catch (e) {
      return { success: false, error: 'O conteúdo fornecido não é um JSON válido: ' + e.message };
    }
  } else if (Array.isArray(cookiesJsonOrArray)) {
    cookiesList = cookiesJsonOrArray;
  } else {
    return { success: false, error: 'Formato inválido. Esperava-se um array JSON de cookies.' };
  }

  if (!Array.isArray(cookiesList) || cookiesList.length === 0) {
    return { success: false, error: 'Nenhum cookie encontrado no JSON informado.' };
  }

  const ses = session.fromPartition(partitionName);
  let importedCount = 0;
  let errorsCount = 0;

  for (const c of cookiesList) {
    try {
      if (!c || !c.name || c.value === undefined) continue;

      const rawDomain = (c.domain || '').trim();
      const cleanDomain = rawDomain.replace(/^\./, '');
      if (!cleanDomain) continue;

      const isSecure = Boolean(c.secure);
      const scheme = isSecure ? 'https://' : 'http://';
      const cookiePath = c.path || '/';

      // Lista de domínios alvo para garantir que o cookie funcione tanto em .com quanto em .bet.br
      const domainsToSet = [cleanDomain];
      if (cleanDomain.includes('bet365.com')) {
        domainsToSet.push('bet365.bet.br');
        domainsToSet.push('www.bet365.bet.br');
      } else if (cleanDomain.includes('bet365.bet.br')) {
        domainsToSet.push('bet365.com');
        domainsToSet.push('www.bet365.com');
      } else if (cleanDomain.includes('betfair.com')) {
        domainsToSet.push('betfair.bet.br');
      } else if (cleanDomain.includes('betfair.bet.br')) {
        domainsToSet.push('betfair.com');
      } else if (cleanDomain.includes('betano.bet.br')) {
        domainsToSet.push('www.betano.bet.br');
      } else if (cleanDomain.includes('betano.com')) {
        domainsToSet.push('betano.bet.br');
        domainsToSet.push('www.betano.bet.br');
      }

      let anySuccess = false;
      for (const targetDomain of domainsToSet) {
        try {
          const url = `${scheme}${targetDomain}${cookiePath.startsWith('/') ? cookiePath : '/' + cookiePath}`;
          const cookieDetails = {
            url,
            name: c.name,
            value: String(c.value),
            path: cookiePath,
            secure: isSecure,
            httpOnly: Boolean(c.httpOnly),
          };

          if (!c.hostOnly) {
            cookieDetails.domain = targetDomain.startsWith('.') ? targetDomain : `.${targetDomain}`;
          }

          if (c.expirationDate && typeof c.expirationDate === 'number') {
            cookieDetails.expirationDate = c.expirationDate;
          }

          if (c.sameSite) {
            const s = String(c.sameSite).toLowerCase();
            if (s === 'no_restriction' || s === 'none') {
              cookieDetails.sameSite = 'no_restriction';
            } else if (s === 'lax') {
              cookieDetails.sameSite = 'lax';
            } else if (s === 'strict') {
              cookieDetails.sameSite = 'strict';
            }
          }

          await ses.cookies.set(cookieDetails);
          anySuccess = true;
        } catch (subErr) {
          // ignora erro em subdomínio secundário
        }
      }

      if (anySuccess) {
        importedCount++;
      } else {
        errorsCount++;
      }
    } catch (err) {
      errorsCount++;
    }
  }

  // Persiste imediatamente no armazenamento em disco da partição
  try {
    await ses.cookies.flushStore();
  } catch (e) {}

  console.log(`[Cookies] Importados ${importedCount} cookies para ${partitionName} (${errorsCount} ignorados)`);
  return { success: true, count: importedCount, errors: errorsCount };
}

/**
 * Exporta todos os cookies salvos em uma partição no formato compatível com Cookie-Editor.
 */
async function exportCookiesFromPartition(partitionName) {
  const ses = session.fromPartition(partitionName);
  const cookies = await ses.cookies.get({});
  return cookies;
}

/**
 * Limpa todos os cookies e dados de armazenamento de uma partição.
 */
async function clearPartitionSession(partitionName) {
  const ses = session.fromPartition(partitionName);
  await ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cache', 'serviceworkers'],
  });
  try {
    await ses.cookies.flushStore();
  } catch (e) {}
}

/**
 * Ação interativa do Menu: Importar da Área de Transferência
 */
async function handleImportFromClipboard(houseKey, houseConfig, targetWin) {
  const text = clipboard.readText().trim();
  if (!text) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Área de Transferência Vazia',
      message: 'Não há conteúdo copiado na sua área de transferência!\n\nCopie o JSON exportado (ex: via extensão Cookie-Editor no Chrome) e tente novamente.',
    });
    return;
  }

  const result = await importCookiesToPartition(houseConfig.partition, text);
  if (!result.success) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Erro na Importação',
      message: `Falha ao importar cookies para ${houseConfig.name}:\n\n${result.error}`,
    });
    return;
  }

  dialog.showMessageBox({
    type: 'info',
    title: 'Cookies Importados com Sucesso!',
    message: `✅ ${result.count} cookies foram importados e salvos para a ${houseConfig.name}!\n\nA partição está aquecida e salva em disco.\nA janela será recarregada agora.`,
  });

  if (targetWin && !targetWin.isDestroyed()) {
    targetWin.webContents.reload();
  }
}

/**
 * Ação interativa do Menu: Importar de arquivo .json
 */
async function handleImportFromFile(houseKey, houseConfig, targetWin) {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Selecionar Arquivo de Cookies para ${houseConfig.name}`,
    filters: [{ name: 'JSON Cookies (*.json)', extensions: ['json', 'txt'] }],
    properties: ['openFile'],
  });

  if (canceled || !filePaths || filePaths.length === 0) return;

  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const result = await importCookiesToPartition(houseConfig.partition, raw);
    if (!result.success) {
      dialog.showMessageBox({
        type: 'error',
        title: 'Erro na Importação',
        message: result.error,
      });
      return;
    }

    dialog.showMessageBox({
      type: 'info',
      title: 'Cookies Importados!',
      message: `✅ ${result.count} cookies foram importados com sucesso a partir de "${path.basename(filePaths[0])}"!`,
    });

    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.webContents.reload();
    }
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Erro ao Ler Arquivo',
      message: err.message,
    });
  }
}

/**
 * Ação interativa do Menu: Exportar cookies para arquivo .json
 */
async function handleExportToFile(houseKey, houseConfig) {
  const cookies = await exportCookiesFromPartition(houseConfig.partition);

  if (!cookies || cookies.length === 0) {
    dialog.showMessageBox({
      type: 'warning',
      title: 'Sem Cookies Armazenados',
      message: `Não há cookies salvos atualmente na partição da ${houseConfig.name}.`,
    });
    return;
  }

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: `Exportar Cookies de ${houseConfig.name}`,
    defaultPath: `cookies_${houseKey}_${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON (*.json)', extensions: ['json'] }],
  });

  if (canceled || !filePath) return;

  try {
    fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2), 'utf8');
    dialog.showMessageBox({
      type: 'info',
      title: 'Exportação Concluída!',
      message: `✅ ${cookies.length} cookies de ${houseConfig.name} salvos com sucesso em:\n${filePath}`,
    });
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Erro ao Salvar Arquivo',
      message: err.message,
    });
  }
}

/**
 * Ação interativa do Menu: Limpar Sessão da Casa
 */
async function handleClearCookies(houseKey, houseConfig, targetWin) {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancelar', 'Sim, Limpar Tudo'],
    defaultId: 0,
    title: 'Limpar Sessão e Cookies',
    message: `Tem certeza que deseja limpar todos os cookies, tokens e dados locais da ${houseConfig.name}?`,
  });

  if (response !== 1) return;

  await clearPartitionSession(houseConfig.partition);

  dialog.showMessageBox({
    type: 'info',
    title: 'Sessão Limpa',
    message: `Os cookies e o cache da ${houseConfig.name} foram completamente apagados.`,
  });

  if (targetWin && !targetWin.isDestroyed()) {
    targetWin.webContents.reload();
  }
}

module.exports = {
  importCookiesToPartition,
  exportCookiesFromPartition,
  clearPartitionSession,
  handleImportFromClipboard,
  handleImportFromFile,
  handleExportToFile,
  handleClearCookies,
};
